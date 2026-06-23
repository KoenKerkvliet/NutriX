// ============================================
// BRIGHTLY - Edge Function: emails
// Drie mails: daily (avond-herinnering), weekly (zondag-update), habit (vrijdag-gewoonte).
// Twee modi:
//  - CRON: header x-cron-token == vault 'cron_token' -> verwerk alle gebruikers die 'due' zijn
//          (op basis van Amsterdamse lokale tijd) en hun email_prefs.
//  - TEST: Authorization (user JWT) + ?type=daily|weekly|habit -> stuur die mail naar jezelf.
// Secrets: EMAILIT_API_KEY, EMAILIT_FROM, EMAILIT_REPLY_TO (optioneel). Service role auto.
// ============================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP = "https://brightlyy.nl";
const dbHeaders = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "content-type": "application/json" };

async function dbGet(path: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: dbHeaders });
  return res.ok ? await res.json() : [];
}
async function adminEmail(userId: string): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
  if (!res.ok) return null;
  return (await res.json()).email || null;
}
async function cronToken(): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_app_secret`, {
    method: "POST", headers: dbHeaders, body: JSON.stringify({ p_name: "cron_token" }),
  });
  return res.ok ? await res.json() : null;
}

async function sendEmail(to: string, subject: string, html: string, text: string) {
  const apiKey = Deno.env.get("EMAILIT_API_KEY")!;
  const from = Deno.env.get("EMAILIT_FROM")!;
  const body: Record<string, unknown> = {
    from, to, subject, html, text,
    headers: { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All", "X-Entity-Ref-ID": crypto.randomUUID() },
  };
  const replyTo = Deno.env.get("EMAILIT_REPLY_TO") || "";
  if (replyTo) body.reply_to = replyTo;
  const res = await fetch("https://api.emailit.com/v2/emails", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`emailit ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/* ---------- helpers ---------- */
function wrap(heading: string, inner: string): string {
  const DARK = "#1E5C3A";
  return `<!DOCTYPE html><html lang='nl'><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1.0'><meta name='x-apple-disable-message-reformatting'><meta name='color-scheme' content='light'><title>Brightly</title></head><body style='margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;'><table width='100%' cellpadding='0' cellspacing='0' role='presentation' style='background:#f5f5f5;'><tr><td align='center' style='padding:24px 12px;'><table width='600' cellpadding='0' cellspacing='0' role='presentation' style='max-width:600px;width:100%;background:#fff;border-radius:10px;overflow:hidden;'><tr><td bgcolor='${DARK}' style='background:${DARK};padding:24px 32px;text-align:center;'><span style='color:#fff;font-size:22px;font-weight:700;'>Brightly</span></td></tr><tr><td style='padding:32px;color:#2C2A26;line-height:1.6;font-size:15px;'><h2 style='margin:0 0 16px;color:${DARK};'>${heading}</h2>${inner}<p style='margin:24px 0 0;'><a href='${APP}/dashboard.html' style='background:#2FA45F;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;'>Open Brightly</a></p></td></tr><tr><td bgcolor='#f9f9f9' style='background:#f9f9f9;padding:16px 32px;text-align:center;color:#999;font-size:12px;'>(c) ${new Date().getFullYear()} Brightly &middot; brightlyy.nl</td></tr></table></td></tr></table></body></html>`;
}
function p(s: string): string { return `<p style='margin:0 0 14px;'>${s}</p>`; }
function iso(d: Date): string { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`; }
function dateLabel(isoStr: string): string {
  const [y, m, dd] = isoStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}
function amsterdam(): { dateStr: string; hour: number; dow: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(now);
  const g = (t: string) => parts.find((x) => x.type === t)?.value || "";
  const dateStr = `${g("year")}-${g("month")}-${g("day")}`;
  let hour = Number(g("hour")); if (hour === 24) hour = 0;
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=zo
  return { dateStr, hour, dow };
}

/* ---------- mail-inhoud ---------- */
async function dailyContent(userId: string, profile: Record<string, unknown>, dateStr: string) {
  const logs = await dbGet(`food_log?user_id=eq.${userId}&select=log_date`);
  const days = new Set(logs.map((r) => r.log_date as string));
  let streak = 0;
  const d = new Date(`${dateStr}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1);
  while (days.has(iso(d))) { streak++; d.setUTCDate(d.getUTCDate() - 1); }
  const streakLine = streak > 0
    ? p(`Je houdt al <b>${streak} ${streak === 1 ? "dag" : "dagen"}</b> op rij je voeding bij. Laat je streak vanavond niet verdwijnen!`)
    : p("Begin vanavond een nieuwe streak door te loggen wat je vandaag at.");
  const inner = p("Hoi,") + p("Je hebt vandaag nog niets gelogd in Brightly. Even bijwerken wat je hebt gegeten houdt je inzicht (en je streak) op peil.") + streakLine + p("Met vriendelijke groet,<br>Brightly");
  const text = `Hoi,\n\nJe hebt vandaag nog niets gelogd in Brightly.${streak > 0 ? ` Je houdt al ${streak} dagen op rij je voeding bij - laat je streak niet verdwijnen!` : ""}\n\nLog even wat je vandaag at: ${APP}/dashboard.html\n\nMet vriendelijke groet,\nBrightly`;
  return { subject: "Nog niets gelogd vandaag", html: wrap("Vergeet je vandaag niet te loggen?", inner), text };
}

async function weeklyContent(userId: string, profile: Record<string, unknown>, todayStr: string) {
  const goal = Number(profile.daily_kcal_goal) || 2000;
  const dates: string[] = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(`${todayStr}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - i); dates.push(iso(d)); }
  const start = dates[0];
  const foods = await dbGet(`food_log?user_id=eq.${userId}&log_date=gte.${start}&log_date=lte.${todayStr}&select=log_date,kcal,qty`);
  const steps = await dbGet(`step_log?user_id=eq.${userId}&log_date=gte.${start}&log_date=lte.${todayStr}&select=log_date,kcal`);
  const acts = await dbGet(`activity_log?user_id=eq.${userId}&log_date=gte.${start}&log_date=lte.${todayStr}&select=log_date,kcal`);
  const eaten: Record<string, number> = {}, burned: Record<string, number> = {}, logged = new Set<string>();
  foods.forEach((r) => { const k = r.log_date as string; logged.add(k); eaten[k] = (eaten[k] || 0) + Number(r.kcal || 0) * (Number(r.qty) || 1); });
  steps.forEach((r) => { const k = r.log_date as string; burned[k] = (burned[k] || 0) + Number(r.kcal || 0); });
  acts.forEach((r) => { const k = r.log_date as string; burned[k] = (burned[k] || 0) + Number(r.kcal || 0); });
  const under: string[] = [], over: string[] = [];
  for (const ds of dates) {
    if (!logged.has(ds)) continue;
    (eaten[ds] <= goal + (burned[ds] || 0) ? under : over).push(dateLabel(ds));
  }

  // Gewicht
  const wAll = await dbGet(`weight_log?user_id=eq.${userId}&order=log_date.asc&select=log_date,weight_kg`);
  const firstW = wAll.length ? Number(wAll[0].weight_kg) : null;
  const latestW = wAll.length ? Number(wAll[wAll.length - 1].weight_kg) : null;
  const startOfWeek = wAll.filter((r) => (r.log_date as string) <= start).pop();
  const weekStartW = startOfWeek ? Number(startOfWeek.weight_kg) : firstW;
  const target = profile.target_weight_kg != null ? Number(profile.target_weight_kg) : null;

  let weightLine = "Nog geen gewicht gelogd deze week.";
  if (latestW != null && weekStartW != null) {
    const delta = +(latestW - weekStartW).toFixed(1);
    const txt = delta === 0 ? "gelijk gebleven" : (delta < 0 ? `${Math.abs(delta)} kg afgevallen` : `${delta} kg aangekomen`);
    weightLine = `Je gewicht is deze week <b>${txt}</b> (nu ${latestW} kg).`;
  }
  let goalLine = "";
  if (latestW != null && firstW != null && target != null && firstW !== target) {
    let pct = Math.round(((latestW - firstW) / (target - firstW)) * 100);
    pct = Math.max(0, Math.min(100, pct));
    goalLine = p(`Je bent <b>${pct}%</b> onderweg naar je doelgewicht van ${target} kg.`);
  }

  const listHtml = (title: string, arr: string[], color: string) =>
    `<p style='margin:0 0 6px;font-weight:600;color:${color};'>${title}</p>` +
    (arr.length ? `<ul style='margin:0 0 14px;padding-left:18px;'>${arr.map((x) => `<li>${x}</li>`).join("")}</ul>` : p("<span style='color:#999;'>geen</span>"));

  const inner = p("Hoi,") + p("Hier is je weekoverzicht in Brightly:")
    + listHtml("Binnen je caloriedoel:", under, "#1E5C3A")
    + listHtml("Eroverheen gegaan:", over, "#B5601A")
    + p(weightLine) + goalLine + p("Met vriendelijke groet,<br>Brightly");
  const text = `Hoi,\n\nJe weekoverzicht in Brightly:\n\nBinnen je doel: ${under.join(", ") || "geen"}\nEroverheen: ${over.join(", ") || "geen"}\n\n${weightLine.replace(/<[^>]+>/g, "")}\n${goalLine ? goalLine.replace(/<[^>]+>/g, "") : ""}\n\n${APP}/dashboard.html\n\nMet vriendelijke groet,\nBrightly`;
  return { subject: "Je weekoverzicht", html: wrap("Je week in het kort", inner), text };
}

async function habitContent(userId: string) {
  const rows = await dbGet(`habits?user_id=eq.${userId}&select=*`);
  if (!rows.length) return null;
  const h = rows[0];
  const slipRows = await dbGet(`habit_slips?user_id=eq.${userId}&select=slip_date`);
  const slips = new Set(slipRows.map((r) => r.slip_date as string));
  const today = iso(new Date());
  const quit = h.quit_date as string;
  const elapsed = Math.max(0, Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${quit}T00:00:00Z`)) / 86400000));
  const slipsInRange = [...slips].filter((d) => d >= quit && d <= today).length;
  const clean = Math.max(0, elapsed - slipsInRange);
  const money = Math.round(clean * Number(h.cost_per_day || 0));
  const cals = Math.round(clean * Number(h.baseline_per_day || 0) * Number(h.kcal_per_unit || 0));
  const type = String(h.type || "gewoonte");

  const inner = p("Hoi,") + p(`Je statusupdate voor het stoppen met <b>${type}</b>:`)
    + `<ul style='margin:0 0 14px;padding-left:18px;'><li><b>${clean}</b> ${clean === 1 ? "dag" : "dagen"} volgehouden</li><li><b>&euro; ${money}</b> bespaard</li>${Number(h.kcal_per_unit) > 0 ? `<li><b>${cals.toLocaleString("nl-NL")} kcal</b> niet gehad</li>` : ""}</ul>`
    + p("Goed bezig, hou vol!") + p("Met vriendelijke groet,<br>Brightly");
  const text = `Hoi,\n\nStatusupdate stoppen met ${type}:\n- ${clean} dagen volgehouden\n- EUR ${money} bespaard${Number(h.kcal_per_unit) > 0 ? `\n- ${cals} kcal niet gehad` : ""}\n\nHou vol!\n\n${APP}/gewoontes.html\n\nMet vriendelijke groet,\nBrightly`;
  return { subject: "Je gewoonte-update", html: wrap(`${clean} ${clean === 1 ? "dag" : "dagen"} volgehouden`, inner), text };
}

/* ---------- verwerking ---------- */
async function processType(type: string): Promise<number> {
  const profiles = await dbGet("profiles?select=id,daily_kcal_goal,target_weight_kg,email_prefs,modules");
  const todayStr = amsterdam().dateStr;
  let sent = 0;
  for (const prof of profiles) {
    const prefs = (prof.email_prefs as Record<string, boolean>) || {};
    const mods = (prof.modules as Record<string, boolean>) || {};
    const uid = prof.id as string;
    try {
      if (type === "daily") {
        if (prefs.daily === false) continue;
        const logs = await dbGet(`food_log?user_id=eq.${uid}&log_date=eq.${todayStr}&select=id&limit=1`);
        if (logs.length) continue; // al gelogd vandaag
        const c = await dailyContent(uid, prof, todayStr);
        const email = await adminEmail(uid); if (!email) continue;
        await sendEmail(email, c.subject, c.html, c.text); sent++;
      } else if (type === "weekly") {
        if (prefs.weekly === false) continue;
        const c = await weeklyContent(uid, prof, todayStr);
        const email = await adminEmail(uid); if (!email) continue;
        await sendEmail(email, c.subject, c.html, c.text); sent++;
      } else if (type === "habit") {
        if (prefs.habit === false || !mods.gewoontes) continue;
        const c = await habitContent(uid); if (!c) continue;
        const email = await adminEmail(uid); if (!email) continue;
        await sendEmail(email, c.subject, c.html, c.text); sent++;
      }
    } catch (_e) { /* ga door met de volgende gebruiker */ }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // CRON-modus: geldig x-cron-token
  const incoming = req.headers.get("x-cron-token");
  if (incoming) {
    const expected = await cronToken();
    if (!expected || incoming !== expected) return json({ error: "Forbidden" }, 403);
    const { hour, dow } = amsterdam();
    const due: string[] = [];
    if (hour === 20) due.push("daily");
    if (dow === 0 && hour === 18) due.push("weekly");
    if (dow === 5 && hour === 19) due.push("habit");
    const result: Record<string, number> = {};
    for (const t of due) result[t] = await processType(t);
    return json({ ok: true, due, result });
  }

  // TEST-modus: ingelogde gebruiker stuurt een mail naar zichzelf (negeert tijd/condities)
  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
  if (!token) return json({ error: "Niet ingelogd." }, 401);
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: ANON } });
  if (!userRes.ok) return json({ error: "Sessie ongeldig of verlopen." }, 401);
  const u = await userRes.json();
  const uid = u.id as string, email = u.email as string;
  const type = new URL(req.url).searchParams.get("type") || "daily";

  try {
    const profs = await dbGet(`profiles?id=eq.${uid}&select=id,daily_kcal_goal,target_weight_kg,email_prefs,modules`);
    const prof = profs[0] || { id: uid };
    const todayStr = amsterdam().dateStr;
    let c: { subject: string; html: string; text: string } | null = null;
    if (type === "weekly") c = await weeklyContent(uid, prof, todayStr);
    else if (type === "habit") c = await habitContent(uid);
    else c = await dailyContent(uid, prof, todayStr);
    if (!c) return json({ success: false, error: "Geen gewoonte ingesteld om over te mailen." });
    await sendEmail(email, `[Test] ${c.subject}`, c.html, c.text);
    return json({ success: true, to: email, type });
  } catch (e) {
    return json({ success: false, error: String((e as Error).message || e) });
  }
});
