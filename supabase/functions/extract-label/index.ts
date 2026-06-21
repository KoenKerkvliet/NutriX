// ============================================
// BRIGHTLY - Edge Function: extract-label
// Leest een etiket-foto met Claude (vision) en geeft
// gestructureerde voedingswaarden per 100 g terug.
// De Anthropic API-key zit veilig als secret (ANTHROPIC_API_KEY).
// ============================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", description: "Productnaam" },
    brand: { type: ["string", "null"], description: "Merk, of null als onbekend" },
    kcal_per_100: { type: ["number", "null"], description: "Calorieën (kcal) per 100 g/ml" },
    protein_per_100: { type: ["number", "null"], description: "Eiwit (g) per 100 g/ml" },
    carbs_per_100: { type: ["number", "null"], description: "Koolhydraten (g) per 100 g/ml" },
    fat_per_100: { type: ["number", "null"], description: "Vet (g) per 100 g/ml" },
    default_serving_g: { type: ["number", "null"], description: "Portiegrootte in gram indien vermeld, anders null" },
  },
  required: ["name", "brand", "kcal_per_100", "protein_per_100", "carbs_per_100", "fat_per_100", "default_serving_g"],
};

const PROMPT = `Je krijgt een foto van een voedingswaarde-etiket (meestal Nederlands).
Haal de voedingswaarden eruit en geef ze ALTIJD per 100 g of 100 ml.
Als de tabel alleen per portie geeft maar ook de portiegrootte vermeldt, reken dan om naar per 100 g.
Velden: name (productnaam), brand (merk), kcal_per_100, protein_per_100 (eiwit),
carbs_per_100 (koolhydraten), fat_per_100 (vet), default_serving_g (portiegrootte in gram indien vermeld).
Gebruik null voor waarden die je niet betrouwbaar kunt aflezen. Geef getallen, geen tekst met eenheden.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // --- Auth: alleen ingelogde gebruikers ---
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "Niet ingelogd." }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: ANON },
    });
    if (!userRes.ok) return json({ error: "Sessie ongeldig of verlopen." }, 401);

    // --- Claude key ---
    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_KEY) return json({ error: "ANTHROPIC_API_KEY secret ontbreekt." }, 500);

    // --- Invoer ---
    const { image, mediaType } = await req.json();
    if (!image) return json({ error: "Geen afbeelding ontvangen." }, 400);

    // --- Claude vision + structured output ---
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: image } },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const detail = await claudeRes.text();
      return json({ error: "Claude API-fout", detail }, 502);
    }

    const data = await claudeRes.json();
    const textBlock = (data.content || []).find((b: { type: string }) => b.type === "text");
    if (!textBlock) return json({ error: "Geen resultaat van de AI." }, 502);

    const parsed = JSON.parse(textBlock.text);
    return json(parsed, 200);
  } catch (e) {
    return json({ error: "Onverwachte fout", detail: String(e) }, 500);
  }
});
