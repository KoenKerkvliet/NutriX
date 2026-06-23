// ============================================
// BRIGHTLY - Edge Function: extract-label
// Schat voedingswaarden uit (a) een etiket-foto of (b) een tekst-beschrijving,
// met Claude. Geeft gestructureerde JSON terug (per 100 g + portie).
// Anthropic API-key zit veilig als secret (ANTHROPIC_API_KEY).
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
    name: { type: "string" },
    brand: { type: ["string", "null"] },
    kcal_per_100: { type: ["number", "null"] },
    protein_per_100: { type: ["number", "null"] },
    carbs_per_100: { type: ["number", "null"] },
    sugar_per_100: { type: ["number", "null"] },
    fat_per_100: { type: ["number", "null"] },
    default_serving_g: { type: ["number", "null"] },
    category: { type: ["string", "null"] },
  },
  required: ["name", "brand", "kcal_per_100", "protein_per_100", "carbs_per_100", "sugar_per_100", "fat_per_100", "default_serving_g", "category"],
};

const CAT_HINT = `Kies category uit precies deze lijst (of null bij twijfel): "Zuivel & eieren", "Brood & granen", "Vlees & vis", "Groente & fruit", "Snacks & zoet", "Dranken", "Maaltijden", "Sauzen & smeersels", "Overig".`;

const IMG_PROMPT = `Je krijgt een foto van een voedingswaarde-etiket (meestal Nederlands).
Haal de voedingswaarden eruit en geef ze ALTIJD per 100 g of 100 ml.
Als de tabel alleen per portie geeft maar ook de portiegrootte vermeldt, reken dan om naar per 100 g.
Velden: name (productnaam), brand (merk), kcal_per_100, protein_per_100 (eiwit),
carbs_per_100 (koolhydraten), sugar_per_100 (waarvan suikers), fat_per_100 (vet),
default_serving_g (portiegrootte in gram indien vermeld), category (productcategorie).
${CAT_HINT}
Gebruik null voor waarden die je niet betrouwbaar kunt aflezen. Geef getallen, geen tekst met eenheden.`;

const TEXT_PROMPT = `Je krijgt een korte beschrijving van een voedingsmiddel of gerecht (Nederlands).
Schat realistische gemiddelde voedingswaarden op basis van je algemene kennis. Het hoeft niet exact te zijn.
Geef de waarden ALTIJD per 100 g of 100 ml, plus default_serving_g = een realistische portiegrootte in gram
voor wat beschreven is (bv. een hele maaltijd kan 400-600 g zijn).
Velden: name (korte, duidelijke productnaam), brand (merk indien genoemd, anders null),
kcal_per_100, protein_per_100 (eiwit), carbs_per_100 (koolhydraten), sugar_per_100 (waarvan suikers),
fat_per_100 (vet), default_serving_g, category (productcategorie).
${CAT_HINT}
Geef getallen, geen tekst met eenheden.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "Niet ingelogd." }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: ANON },
    });
    if (!userRes.ok) return json({ error: "Sessie ongeldig of verlopen." }, 401);

    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_KEY) return json({ error: "ANTHROPIC_API_KEY secret ontbreekt." }, 500);

    const { image, mediaType, text } = await req.json();

    let content;
    if (text && String(text).trim()) {
      content = [{ type: "text", text: `${TEXT_PROMPT}\n\nBeschrijving: ${String(text).trim()}` }];
    } else if (image) {
      content = [
        { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: image } },
        { type: "text", text: IMG_PROMPT },
      ];
    } else {
      return json({ error: "Geen afbeelding of beschrijving ontvangen." }, 400);
    }

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
        messages: [{ role: "user", content }],
      }),
    });

    if (!claudeRes.ok) {
      const detail = await claudeRes.text();
      return json({ error: "Claude API-fout", detail }, 502);
    }

    const data = await claudeRes.json();
    const textBlock = (data.content || []).find((b: { type: string }) => b.type === "text");
    if (!textBlock) return json({ error: "Geen resultaat van de AI." }, 502);

    return json(JSON.parse(textBlock.text), 200);
  } catch (e) {
    return json({ error: "Onverwachte fout", detail: String(e) }, 500);
  }
});
