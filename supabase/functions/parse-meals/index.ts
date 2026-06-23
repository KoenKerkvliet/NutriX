// ============================================
// BRIGHTLY - Edge Function: parse-meals
// Zet een transcript (bv. uit een audio-opname) om in voeding-items per maaltijd,
// met geschatte voedingswaarden per portie. Claude structured output.
// Secret: ANTHROPIC_API_KEY. Eigen auth via /auth/v1/user.
// ============================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    meals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          meal: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                amount_g: { type: ["number", "null"] },
                kcal: { type: ["number", "null"] },
                protein: { type: ["number", "null"] },
                carbs: { type: ["number", "null"] },
                fat: { type: ["number", "null"] },
                sugar: { type: ["number", "null"] },
              },
              required: ["name", "amount_g", "kcal", "protein", "carbs", "fat", "sugar"],
            },
          },
        },
        required: ["meal", "items"],
      },
    },
  },
  required: ["meals"],
};

const PROMPT = `Je krijgt een transcript (Nederlands) waarin iemand vertelt wat hij/zij die dag per maaltijd heeft gegeten en gedronken.
Zet dit om in een gestructureerde lijst, gegroepeerd per eetmoment.
Gebruik voor 'meal' EXACT een van: ontbijt, lunch, diner, snack, drinken.
Voor elk item geef je: name (korte, duidelijke productnaam), amount_g (geschatte hoeveelheid in gram of ml),
en de voedingswaarden VOOR DIE PORTIE (dus niet per 100 g): kcal, protein (eiwit), carbs (koolhydraten), fat (vet), sugar (suiker).
Schat realistische gemiddelde waarden op basis van je algemene kennis; het hoeft niet exact te zijn, bij benadering is goed.
Geef getallen zonder eenheden. Drankjes horen bij 'drinken' tenzij duidelijk anders. Laat eetmomenten zonder items weg.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "Niet ingelogd." }, 401);
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: ANON } });
    if (!userRes.ok) return json({ error: "Sessie ongeldig of verlopen." }, 401);

    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_KEY) return json({ error: "ANTHROPIC_API_KEY secret ontbreekt." }, 500);

    const { transcript } = await req.json();
    if (!transcript || !String(transcript).trim()) return json({ error: "Geen tekst ontvangen." }, 400);

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
        messages: [{ role: "user", content: [{ type: "text", text: `${PROMPT}\n\nTranscript:\n${String(transcript).trim()}` }] }],
      }),
    });
    if (!claudeRes.ok) {
      const detail = await claudeRes.text();
      return json({ error: "Claude API-fout", detail: detail.slice(0, 300) }, 502);
    }
    const data = await claudeRes.json();
    const textBlock = (data.content || []).find((b: { type: string }) => b.type === "text");
    if (!textBlock) return json({ error: "Geen resultaat van de AI." }, 502);
    return json(JSON.parse(textBlock.text), 200);
  } catch (e) {
    return json({ error: "Onverwachte fout", detail: String(e) }, 500);
  }
});
