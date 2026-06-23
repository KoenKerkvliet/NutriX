// ============================================
// BRIGHTLY - Edge Function: send-test-email (emailit)
// Stuurt een testmail naar de ingelogde gebruiker. Puur versturen — werkt met een
// sending-only API key. Secrets: EMAILIT_API_KEY, EMAILIT_FROM, EMAILIT_REPLY_TO (optioneel).
// ============================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

async function sendEmail(opts: { to: string; subject: string; html: string; text: string }) {
  const apiKey = Deno.env.get("EMAILIT_API_KEY");
  if (!apiKey) throw new Error("EMAILIT_API_KEY secret ontbreekt.");
  const from = Deno.env.get("EMAILIT_FROM");
  if (!from) throw new Error("EMAILIT_FROM secret ontbreekt.");
  const body: Record<string, unknown> = {
    from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text,
    headers: { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All", "X-Entity-Ref-ID": crypto.randomUUID() },
  };
  const replyTo = Deno.env.get("EMAILIT_REPLY_TO") || "";
  if (replyTo) body.reply_to = replyTo;
  const res = await fetch("https://api.emailit.com/v2/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`emailit ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

function testHtml(): string {
  const DARK = "#1E5C3A";
  return `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><title>Testmail Brightly</title></head><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f5f5f5;"><tr><td align="center" style="padding:24px 12px;"><table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;"><tr><td bgcolor="${DARK}" style="background:${DARK};padding:28px 32px;text-align:center;"><span style="color:#ffffff;font-size:22px;font-weight:700;">Brightly</span></td></tr><tr><td style="padding:32px;color:#2C2A26;line-height:1.6;font-size:15px;"><h2 style="margin:0 0 12px;color:${DARK};">Het werkt!</h2><p style="margin:0 0 16px;">Hoi,</p><p style="margin:0 0 16px;">Dit is een testmail van Brightly. De koppeling met emailit staat goed.</p><p style="margin:0;">Met vriendelijke groet,<br>Brightly</p></td></tr><tr><td bgcolor="#f9f9f9" style="background:#f9f9f9;padding:16px 32px;text-align:center;color:#999;font-size:12px;">(c) ${new Date().getFullYear()} Brightly &middot; brightlyy.nl</td></tr></table></td></tr></table></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
  if (!token) return json({ success: false, error: "Niet ingelogd." }, 401);
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: ANON } });
  if (!userRes.ok) return json({ success: false, error: "Sessie ongeldig of verlopen." }, 401);
  const email = (await userRes.json()).email as string;
  if (!email) return json({ success: false, error: "Geen e-mailadres op je account." });

  try {
    await sendEmail({ to: email, subject: "Testmail Brightly", html: testHtml(), text: "Dit is een testmail van Brightly. De koppeling met emailit staat goed." });
    return json({ success: true, to: email });
  } catch (e) {
    return json({ success: false, error: String((e as Error).message || e) });
  }
});
