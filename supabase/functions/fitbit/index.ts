// ============================================
// BRIGHTLY - Edge Function: fitbit (Google Health API)
// Fitbit-stappen via de NIEUWE Google Health API + Google OAuth 2.0.
// Acties: status | auth | sync | disconnect
// - Client Secret zit als Supabase-secret GOOGLE_CLIENT_SECRET (nooit in de frontend).
// - Tokens worden bewaard in tabel fitbit_tokens (alleen via service_role bereikbaar).
// ============================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const REDIRECT_URI = "https://brightlyy.nl/fitbit-callback.html";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const STEPS_URL = "https://health.googleapis.com/v4/users/me/dataTypes/steps/dataPoints";
const SLEEP_URL = "https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints";

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const dbHeaders = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "content-type": "application/json" };

async function dbGet(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: dbHeaders });
  return res.ok ? await res.json() : [];
}
async function dbUpsert(table: string, body: unknown, onConflict: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: { ...dbHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(body),
  });
}
async function dbDelete(table: string, query: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { method: "DELETE", headers: dbHeaders });
}

/** Google OAuth token-uitwisseling/-vernieuwing. */
async function googleToken(form: Record<string, string>) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

/** Begin- en eindgrens (civiele tijd, zonder tijdzone) voor één dag YYYY-MM-DD. */
function dayBounds(d: string) {
  const next = new Date(`${d}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nd = next.toISOString().slice(0, 10);
  return { start: `${d}T00:00:00`, end: `${nd}T00:00:00` };
}
function shiftDay(d: string, delta: number) {
  const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + delta);
  return x.toISOString().slice(0, 10);
}
function pickNum(...vals: unknown[]): number | null {
  for (const v of vals) { const n = Number(v); if (v != null && Number.isFinite(n)) return n; }
  return null;
}

/** Slaap van de nacht die op dag d eindigt → sleep_log. Best-effort; bewaart raw voor finetuning. */
async function syncSleep(accessToken: string, uid: string, d: string) {
  const start = `${shiftDay(d, -1)}T00:00:00`, end = `${shiftDay(d, 1)}T00:00:00`;
  const filter = `sleep.interval.civil_start_time >= "${start}" AND sleep.interval.civil_start_time < "${end}"`;
  const url = new URL(SLEEP_URL);
  url.searchParams.set("filter", filter);
  url.searchParams.set("page_size", "50");
  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  if (!r.ok) return { ok: false, status: r.status, detail: (await r.text()).slice(0, 300) };
  const body = await r.json();
  const dps = body.dataPoints || [];
  if (!dps.length) return { ok: true, none: true };

  // Sessie die op dag d eindigt (anders de laatste).
  let best = dps.find((dp: Record<string, unknown>) => {
    const s = (dp.sleep || dp) as Record<string, unknown>;
    const e = ((s.interval as Record<string, string>) || {}).endTime;
    return e && e.slice(0, 10) === d;
  }) || dps[dps.length - 1];

  const s = (best.sleep || best) as Record<string, unknown>;
  const interval = (s.interval as Record<string, string>) || {};
  const startT = interval.startTime || null;
  const endT = interval.endTime || null;
  const inBed = (startT && endT) ? Math.round((Date.parse(endT) - Date.parse(startT)) / 60000) : null;
  const durMs = pickNum(s.durationMillis, s.totalSleepMillis);
  const duration = durMs != null ? Math.round(durMs / 60000) : pickNum(s.minutesAsleep, s.totalMinutesAsleep, inBed);

  await dbUpsert("sleep_log", {
    user_id: uid, log_date: d,
    duration_min: duration != null ? Math.round(duration) : null,
    in_bed_min: inBed,
    score: pickNum(s.score, s.sleepScore, s.efficiency),
    start_time: startT, end_time: endT,
    raw: best,
    updated_at: new Date().toISOString(),
  }, "user_id,log_date");
  return { ok: true, duration_min: duration != null ? Math.round(duration) : null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "Niet ingelogd." }, 401);

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: ANON } });
    if (!userRes.ok) return json({ error: "Sessie ongeldig of verlopen." }, 401);
    const uid = (await userRes.json()).id as string;

    const SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
    if (!SECRET) return json({ error: "GOOGLE_CLIENT_SECRET secret ontbreekt." }, 500);

    const { action, client_id, code, date } = await req.json();
    if (!client_id) return json({ error: "client_id ontbreekt." }, 400);

    // ---- status ----
    if (action === "status") {
      const rows = await dbGet(`fitbit_tokens?user_id=eq.${uid}&select=user_id`);
      return json({ connected: rows.length > 0 });
    }

    // ---- disconnect ----
    if (action === "disconnect") {
      const rows = await dbGet(`fitbit_tokens?user_id=eq.${uid}&select=refresh_token`);
      if (rows.length) {
        await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(rows[0].refresh_token)}`, { method: "POST" }).catch(() => {});
      }
      await dbDelete("fitbit_tokens", `user_id=eq.${uid}`);
      return json({ connected: false });
    }

    // ---- auth (code → tokens) ----
    if (action === "auth") {
      if (!code) return json({ error: "code ontbreekt." }, 400);
      const { ok, data } = await googleToken({
        grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI,
        client_id, client_secret: SECRET,
      });
      if (!ok || !data.refresh_token) {
        return json({ connected: false, error: "Koppelen mislukt", detail: JSON.stringify(data).slice(0, 400) }, 502);
      }
      await dbUpsert("fitbit_tokens", {
        user_id: uid,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        scope: data.scope || null,
        expires_at: new Date(Date.now() + (Number(data.expires_in) || 3600) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }, "user_id");
      return json({ connected: true });
    }

    // ---- sync (stappen van een dag → step_log) ----
    if (action === "sync") {
      const rows = await dbGet(`fitbit_tokens?user_id=eq.${uid}&select=*`);
      if (!rows.length) return json({ connected: false });
      let tok = rows[0];

      // Access token vernieuwen als die (bijna) verlopen is.
      if (new Date(tok.expires_at).getTime() <= Date.now() + 60000) {
        const { ok, data } = await googleToken({
          grant_type: "refresh_token", refresh_token: tok.refresh_token,
          client_id, client_secret: SECRET,
        });
        if (!ok) { await dbDelete("fitbit_tokens", `user_id=eq.${uid}`); return json({ connected: false, error: "refresh_failed", detail: JSON.stringify(data).slice(0, 300) }); }
        tok.access_token = data.access_token;
        tok.expires_at = new Date(Date.now() + (Number(data.expires_in) || 3600) * 1000).toISOString();
        await dbUpsert("fitbit_tokens", {
          user_id: uid, access_token: tok.access_token, refresh_token: tok.refresh_token,
          expires_at: tok.expires_at, updated_at: new Date().toISOString(),
        }, "user_id");
      }

      const d = (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? date : new Date().toISOString().slice(0, 10);
      const { start, end } = dayBounds(d);
      const filter = `steps.interval.civil_start_time >= "${start}" AND steps.interval.civil_start_time < "${end}"`;

      let steps = 0, pageToken: string | null = null, pages = 0;
      do {
        const url = new URL(STEPS_URL);
        url.searchParams.set("filter", filter);
        url.searchParams.set("page_size", "1000");
        if (pageToken) url.searchParams.set("page_token", pageToken);
        const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${tok.access_token}`, Accept: "application/json" } });
        if (!r.ok) {
          const detail = await r.text();
          return json({ connected: true, error: "fetch_failed", detail: detail.slice(0, 400) }, 502);
        }
        const body = await r.json();
        for (const dp of (body.dataPoints || [])) {
          const c = dp?.steps?.count;
          if (c != null) steps += Number(c) || 0;
        }
        pageToken = body.nextPageToken || null;
        pages++;
      } while (pageToken && pages < 25);
      steps = Math.round(steps);

      const w = await dbGet(`weight_log?user_id=eq.${uid}&select=weight_kg&order=log_date.desc&limit=1`);
      const weight = w.length ? Number(w[0].weight_kg) || 70 : 70;
      const kcal = Math.round(steps * weight * 0.0005);

      await dbUpsert("step_log", { user_id: uid, log_date: d, steps, kcal }, "user_id,log_date");

      // Slaap is optioneel (vereist de sleep-scope); faalt stil als die ontbreekt.
      let sleep: unknown = null;
      try { sleep = await syncSleep(tok.access_token, uid, d); } catch (_e) { sleep = { ok: false, error: "exception" }; }

      return json({ connected: true, steps, kcal, date: d, sleep });
    }

    return json({ error: "Onbekende actie." }, 400);
  } catch (e) {
    return json({ error: "Onverwachte fout", detail: String(e) }, 500);
  }
});
