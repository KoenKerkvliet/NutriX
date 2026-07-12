// ============================================
// BRIGHTLY - Edge Function: chat (AI-coach)
// Een chatbot op Claude Haiku 4.5 (goedkoopste model) met tool use.
// Kan: kletsen, motiveren (gezond eten / minder drinken / meer bewegen),
// voeding loggen en activiteiten loggen — die tellen mee in het dagtotaal.
// De tool-loop draait server-side; inserts gaan via PostgREST met het
// access_token van de user, dus RLS blijft gewoon van kracht.
// Secret: ANTHROPIC_API_KEY. Eigen auth via /auth/v1/user.
// ============================================

const MODEL = "claude-haiku-4-5"; // goedkoopste Claude-model

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

const MEALS = ["ontbijt", "lunch", "diner", "snack", "drinken"];

// --- Tooldefinities voor Claude -------------------------------------------
const TOOLS = [
  {
    name: "log_food",
    description:
      "Log één voedings- of drankitem in het dagboek van de gebruiker. Roep dit meerdere keren aan als er meerdere items zijn. " +
      "Schat realistische voedingswaarden VOOR DE GENOEMDE PORTIE (niet per 100 g) op basis van je algemene kennis; bij benadering is prima.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", description: "Korte, duidelijke productnaam, bv. 'Bruine boterham met kaas' of 'Glas wijn'." },
        meal_type: { type: "string", enum: MEALS, description: "Eetmoment. Drankjes horen bij 'drinken' tenzij duidelijk anders." },
        amount_g: { type: "number", description: "Geschatte hoeveelheid in gram of ml voor deze portie." },
        kcal: { type: "number", description: "Kilocalorieën voor deze portie." },
        protein: { type: "number", description: "Eiwit in gram voor deze portie." },
        carbs: { type: "number", description: "Koolhydraten in gram voor deze portie." },
        fat: { type: "number", description: "Vet in gram voor deze portie." },
        sugar: { type: "number", description: "Suiker in gram voor deze portie." },
        date: { type: "string", description: "Datum YYYY-MM-DD. Laat weg voor vandaag." },
      },
      required: ["name", "meal_type", "amount_g", "kcal"],
    },
  },
  {
    name: "log_activity",
    description:
      "Log een sport-/beweegactiviteit. De verbrande calorieën tellen mee bij het dagdoel. " +
      "Schat de verbranding met MET × gewicht(kg) × uren als de gebruiker die niet noemt (gebruik het gewicht uit de context).",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { type: "string", description: "Soort activiteit, bv. 'hardlopen', 'wandelen', 'krachttraining', 'fietsen'." },
        duration_min: { type: "number", description: "Duur in minuten (indien bekend)." },
        kcal: { type: "number", description: "Geschatte verbrande kilocalorieën." },
        date: { type: "string", description: "Datum YYYY-MM-DD. Laat weg voor vandaag." },
      },
      required: ["type", "kcal"],
    },
  },
  {
    name: "get_day_summary",
    description: "Haal de totalen van een dag op (gegeten kcal, verbrand door beweging, doel, resterend) om vragen over voortgang te beantwoorden.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { date: { type: "string", description: "Datum YYYY-MM-DD. Laat weg voor vandaag." } },
      required: [],
    },
  },
];

function amsterdamToday(): string {
  // en-CA levert YYYY-MM-DD
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "Niet ingelogd." }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const restHeaders = { apikey: ANON, Authorization: `Bearer ${token}`, "content-type": "application/json" };

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: ANON } });
    if (!userRes.ok) return json({ error: "Sessie ongeldig of verlopen." }, 401);
    const user = await userRes.json();
    const userId = user.id as string;

    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_KEY) return json({ error: "ANTHROPIC_API_KEY secret ontbreekt." }, 500);

    const body = await req.json();
    const history = Array.isArray(body.messages) ? body.messages : [];
    if (!history.length) return json({ error: "Geen bericht ontvangen." }, 400);

    const today = amsterdamToday();

    // --- REST-helpers (respecteren RLS via het user-token) ------------------
    async function restGet(path: string): Promise<any[]> {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: restHeaders });
      if (!r.ok) return [];
      return await r.json();
    }
    async function daySummary(date: string) {
      const foods = await restGet(`food_log?select=kcal,qty,meal_type&log_date=eq.${date}`);
      const acts = await restGet(`activity_log?select=kcal&log_date=eq.${date}`);
      const steps = await restGet(`step_log?select=kcal,active_kcal&log_date=eq.${date}`);
      const eaten = foods.reduce((s, f) => s + num(f.kcal) * (num(f.qty) || 1), 0);
      const actKcal = acts.reduce((s, a) => s + num(a.kcal), 0);
      const stepRow = steps[0];
      const stepKcal = stepRow ? (stepRow.active_kcal != null ? num(stepRow.active_kcal) : num(stepRow.kcal)) : 0;
      const burned = Math.round(stepKcal + actKcal);
      return { date, eaten: Math.round(eaten), burned, items: foods.length };
    }

    // Context voor de coach: profiel, gewicht, dagtotaal.
    const [profileRows, weightRows] = await Promise.all([
      restGet(`profiles?select=display_name,goal,target_weight_kg,daily_kcal_goal&id=eq.${userId}`),
      restGet(`weight_log?select=weight_kg&order=log_date.desc&limit=1`),
    ]);
    const profile = profileRows[0] || {};
    const weightKg = weightRows[0] ? num(weightRows[0].weight_kg) : 0;
    const summary = await daySummary(today);
    const goal = profile.daily_kcal_goal ? num(profile.daily_kcal_goal) : 0;
    const netGoal = goal ? goal + summary.burned : 0;
    const remaining = netGoal ? netGoal - summary.eaten : 0;

    const goalNL: Record<string, string> = { lose: "afvallen", maintain: "op gewicht blijven", gain: "aankomen" };
    const ctxLines = [
      profile.display_name ? `Naam: ${profile.display_name}.` : "",
      profile.goal ? `Doel: ${goalNL[profile.goal] || profile.goal}${profile.target_weight_kg ? ` (streefgewicht ${profile.target_weight_kg} kg)` : ""}.` : "",
      weightKg ? `Huidig gewicht: ${weightKg} kg.` : "",
      goal ? `Dagdoel: ${goal} kcal. Vandaag gegeten: ${summary.eaten} kcal, verbrand door beweging: ${summary.burned} kcal, dus nog ${remaining} kcal ruimte (t.o.v. doel + beweging).` : `Vandaag gegeten: ${summary.eaten} kcal, verbrand: ${summary.burned} kcal.`,
    ].filter(Boolean).join(" ");

    const SYSTEM = `Je bent de persoonlijke gezondheidscoach in de app Brightly. Je praat Nederlands, warm, kort en concreet — als een behulpzame maatje, geen preek. Je motiveert de gebruiker om gezond te eten, minder te drinken (alcohol) en meer te bewegen, maar nooit betuttelend of streng.

Vandaag is ${today}.
Context over de gebruiker: ${ctxLines || "nog weinig bekend."}

Je kunt echt dingen vastleggen met tools:
- Zegt de gebruiker wat hij/zij gegeten of gedronken heeft? Roep log_food aan (één keer per item) en schat de voedingswaarden per portie.
- Zegt de gebruiker dat hij/zij een activiteit heeft gedaan (sport, wandeling, fietsen...)? Roep log_activity aan; de verbrande kcal tellen mee in het dagdoel.
- Vraagt de gebruiker naar de stand van vandaag of een andere dag? Gebruik get_day_summary.

Belangrijk:
- Kies het eetmoment slim op basis van wat de gebruiker zegt of het tijdstip; drankjes → 'drinken' tenzij anders.
- Vraag niet onnodig door: bij een normale hoeveelheid schat je gewoon en log je. Vraag alleen als het echt onduidelijk is wát er gegeten is.
- Bevestig na het loggen kort en menselijk wat je hebt toegevoegd (met de kcal), en voeg waar passend één motiverend of gezond zinnetje toe.
- Bij alcohol: log het gewoon, maar je mag vriendelijk een gezonder alternatief of een bemoedigend woordje meegeven — zonder te oordelen.
- Houd antwoorden kort (meestal 1-3 zinnen). Geen opsommingen tenzij handig.`;

    // --- Agentic tool-loop -------------------------------------------------
    const messages = history.map((m: any) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content ?? ""),
    }));

    const logged: any[] = [];
    let finalText = "";

    for (let step = 0; step < 6; step++) {
      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODEL, max_tokens: 1024, system: SYSTEM, tools: TOOLS, messages }),
      });
      if (!claudeRes.ok) {
        const detail = await claudeRes.text();
        return json({ error: "Claude API-fout", detail: detail.slice(0, 300) }, 502);
      }
      const data = await claudeRes.json();
      const content = data.content || [];
      finalText = content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();

      if (data.stop_reason !== "tool_use") break;

      // Voer alle tool-calls uit en verzamel resultaten.
      messages.push({ role: "assistant", content });
      const toolResults: any[] = [];
      for (const block of content) {
        if (block.type !== "tool_use") continue;
        const inp = block.input || {};
        let result = "ok";
        try {
          if (block.name === "log_food") {
            const meal = MEALS.includes(inp.meal_type) ? inp.meal_type : "snack";
            const row = {
              user_id: userId, log_date: inp.date || today, meal_type: meal, source: "ai",
              name: String(inp.name || "Onbekend"), brand: null,
              amount_g: Math.round(num(inp.amount_g)), qty: 1,
              kcal: Math.round(num(inp.kcal)),
              protein: +num(inp.protein).toFixed(1), carbs: +num(inp.carbs).toFixed(1),
              fat: +num(inp.fat).toFixed(1), sugar: +num(inp.sugar).toFixed(1),
            };
            const r = await fetch(`${SUPABASE_URL}/rest/v1/food_log`, {
              method: "POST", headers: { ...restHeaders, Prefer: "return=minimal" }, body: JSON.stringify(row),
            });
            if (!r.ok) { result = "opslaan mislukt: " + (await r.text()).slice(0, 120); }
            else { logged.push({ kind: "food", label: row.name, kcal: row.kcal, meal_type: meal, date: row.log_date }); result = `gelogd: ${row.name}, ${row.kcal} kcal onder ${meal}`; }
          } else if (block.name === "log_activity") {
            const row = {
              user_id: userId, log_date: inp.date || today,
              type: String(inp.type || "overig"),
              duration_min: inp.duration_min != null ? Math.round(num(inp.duration_min)) : null,
              kcal: Math.round(num(inp.kcal)), source: "manual",
            };
            const r = await fetch(`${SUPABASE_URL}/rest/v1/activity_log`, {
              method: "POST", headers: { ...restHeaders, Prefer: "return=minimal" }, body: JSON.stringify(row),
            });
            if (!r.ok) { result = "opslaan mislukt: " + (await r.text()).slice(0, 120); }
            else { logged.push({ kind: "activity", label: row.type, kcal: row.kcal, date: row.log_date }); result = `gelogd: ${row.type}, ${row.kcal} kcal verbrand`; }
          } else if (block.name === "get_day_summary") {
            const s = await daySummary(inp.date || today);
            const g = goal || 0;
            result = JSON.stringify({ ...s, doel: g, resterend: g ? g + s.burned - s.eaten : null });
          } else {
            result = "onbekende tool";
          }
        } catch (e) {
          result = "fout: " + String(e).slice(0, 120);
        }
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }
      messages.push({ role: "user", content: toolResults });
    }

    return json({ reply: finalText || "…", logged });
  } catch (e) {
    return json({ error: "Onverwachte fout", detail: String(e) }, 500);
  }
});
