// ============================================
// BRIGHTLY - Edge Function: send-test-email (emailit)
// Stuurt een testmail naar de ingelogde gebruiker. Als emailit "Domain not verified"
// geeft, triggert de functie eenmalig de domein-verificatie en probeert opnieuw.
// Secrets: EMAILIT_API_KEY, EMAILIT_FROM, EMAILIT_REPLY_TO (optioneel).
// ============================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

const EMAILIT_URL = "https://api.emailit.com/v2/emails";

async function sendEmail(opts: { to: string; subject: string; html: string; text: string }) {
  const apiKey = Deno.env.get("EMAILIT_API_KEY");
  if (!apiKey) throw new Error("EMAILIT_API_KEY secret ontbreekt.");
  const from = Deno.env.get("EMAILIT_FROM");
  if (!from) throw new Error("EMAILIT_FROM secret ontbreekt (zet bv. 'Brightly <noreply@brightlyy.nl>').");

  const body: Record<string, unknown> = {
    from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text,
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
      "X-Entity-Ref-ID": crypto.randomUUID(),
    },
  };
  const replyTo = Deno.env.get("EMAILIT_REPLY_TO") || "";
  if (replyTo) body.reply_to = replyTo;

  const res = await fetch(EMAILIT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`emailit ${res.status} (from: ${from}): ${(await res.text()).slice(0, 300)}`);
}

function testHtml(): string {
  const DARK = "#1E5C3A";
  return `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><title>Testmail Brightly</title></head><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;"><div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f5f5f5;opacity:0;">Je e-mailkoppeling met emailit werkt.</div><table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f5f5f5;"><tr><td align="center" style="padding:24px 12px;"><table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;"><tr><td bgcolor="${DARK}" style="background:${DARK};padding:28px 32px;text-align:center;"><span style="color:#ffffff;font-size:22px;font-weight:700;">Brightly</span></td></tr><tr><td style="padding:32px;color:#2C2A26;line-height:1.6;font-size:15px;"><h2 style="margin:0 0 12px;color:${DARK};">Het werkt!</h2><p style="margin:0 0 16px;">Hoi,</p><p style="margin:0 0 16px;">Dit is een testmail van Brightly. Als je deze ziet, dan staat de koppeling met emailit goed en kunnen we e-mails versturen.</p><p style="margin:0;">Met vriendelijke groet,<br>Brightly</p></td></tr><tr><td bgcolor="#f9f9f9" style="background:#f9f9f9;padding:16px 32px;text-align:center;color:#999;font-size:12px;">(c) ${new Date().getFullYear()} Brightly &middot; brightlyy.nl</td></tr></table></td></tr></table></body></html>`;
}

function testText(): string {
  return `Hoi,\n\nDit is een testmail van Brightly. Als je deze ziet, dan staat de koppeling met emailit goed en kunnen we e-mails versturen.\n\nMet vriendelijke groet,\nBrightly\n\n--\n(c) ${new Date().getFullYear()} Brightly | brightlyy.nl`;
}

function emailDomain(from: string): string {
  const m = String(from).match(/<([^>]+)>/);
  const addr = (m ? m[1] : String(from)).trim();
  const at = addr.lastIndexOf("@");
  return (at >= 0 ? addr.slice(at + 1) : addr).trim().toLowerCase();
}

async function findDomainId(apiKey: string, fromDomain: string): Promise<string | null> {
  const res = await fetch("https://api.emailit.com/v2/domains", { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) return null;
  const data = await res.json();
  const arr = Array.isArray(data) ? data : (data.data || data.domains || []);
  const m = arr.find((d: Record<string, unknown>) => String(d.name || d.domain || "").toLowerCase() === fromDomain);
  return m ? String(m.id || m.uuid) : null;
}

/** Trigger emailit's domeinverificatie (zet verified_at als de records kloppen). */
async function verifyDomain(apiKey: string, id: string): Promise<{ verified: boolean; raw: string }> {
  const res = await fetch(`https://api.emailit.com/v2/domains/${id}/verify`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = await res.json().catch(() => ({}));
  const dom = (data as Record<string, unknown>).data || data;
  return { verified: !!(dom as Record<string, unknown>).verified_at, raw: JSON.stringify(data).slice(0, 500) };
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

  const apiKey = Deno.env.get("EMAILIT_API_KEY") || "";
  const from = Deno.env.get("EMAILIT_FROM") || "";
  const doSend = () => sendEmail({ to: email, subject: "Testmail Brightly", html: testHtml(), text: testText() });

  try {
    await doSend();
    return json({ success: true, to: email });
  } catch (e) {
    const msg = String((e as Error).message || e);
    // Bij "Domain not verified": eenmalig verificatie triggeren en opnieuw proberen.
    if (apiKey && from && msg.includes("Domain not verified")) {
      try {
        const id = await findDomainId(apiKey, emailDomain(from));
        if (id) {
          const v = await verifyDomain(apiKey, id);
          if (v.verified) {
            await doSend();
            return json({ success: true, to: email, note: "Domein zojuist geverifieerd en mail verstuurd." });
          }
          return json({ success: false, error: `Verificatie getriggerd maar emailit zet 'verified' nog niet — emailit zegt: ${v.raw}` });
        }
        return json({ success: false, error: `${msg} -- domein '${emailDomain(from)}' niet gevonden bij deze key.` });
      } catch (e2) {
        return json({ success: false, error: "Verify/herzend-fout: " + String((e2 as Error).message || e2) });
      }
    }
    return json({ success: false, error: msg });
  }
});
