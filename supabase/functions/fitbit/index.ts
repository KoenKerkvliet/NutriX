// ============================================
// BRIGHTLY - Edge Function: fitbit (legacy Fitbit Web API)
// Acties: status | auth | sync | disconnect
// - auth: wisselt de OAuth-code in voor tokens en bewaart ze
// - sync: haalt stappen van een dag op en zet ze in step_log (kcal = stappen×gewicht×0.0005)
// - Client Secret zit als Supabase-secret FITBIT_CLIENT_SECRET (nooit in de frontend).
// LET OP: legacy Fitbit Web API wordt sep 2026 uitgefaseerd → later migreren naar Google Health API.
// ============================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const REDIRECT_URI = "https://brightlyy.nl/fitbit-callback.html";
const FITBIT_TOKEN_URL = "https://api.fitbit.com/oauth2/token";

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

/** Token-uitwisseling of -vernieuwing bij Fitbit. */
async function fitbitToken(basic: string, form: Record<string, string>) {
  const res = await fetch(FITBIT_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "Niet ingelogd." }, 401);

    // Gebruiker valideren via Supabase Auth.
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: ANON } });
    if (!userRes.ok) return json({ error: "Sessie ongeldig of verlopen." }, 401);
    const uid = (await userRes.json()).id as string;

    const SECRET = Deno.env.get("FITBIT_CLIENT_SECRET");
    if (!SECRET) return json({ error: "FITBIT_CLIENT_SECRET secret ontbreekt." }, 500);

    const { action, client_id, code, date } = await req.json();
    if (!client_id) return json({ error: "client_id ontbreekt." }, 400);
    const basic = btoa(`${client_id}:${SECRET}`);

    // ---- status ----
    if (action === "status") {
      const rows = await dbGet(`fitbit_tokens?user_id=eq.${uid}&select=user_id`);
      return json({ connected: rows.length > 0 });
    }

    // ---- disconnect ----
    if (action === "disconnect") {
      const rows = await dbGet(`fitbit_tokens?user_id=eq.${uid}&select=refresh_token`);
      if (rows.length) {
        await fetch("https://api.fitbit.com/oauth2/revoke", {
          method: "POST",
          headers: { Authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: rows[0].refresh_token }).toString(),
        }).catch(() => {});
      }
      await dbDelete("fitbit_tokens", `user_id=eq.${uid}`);
      return json({ connected: false });
    }

    // ---- auth (code → tokens) ----
    if (action === "auth") {
      if (!code) return json({ error: "code ontbreekt." }, 400);
      const { ok, data } = await fitbitToken(basic, {
        grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, client_id,
      });
      if (!ok) return json({ connected: false, error: "Koppelen mislukt", detail: JSON.stringify(data) }, 502);
      await dbUpsert("fitbit_tokens", {
        user_id: uid,
        fitbit_user_id: data.user_id || null,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        scope: data.scope || null,
        expires_at: new Date(Date.now() + (Number(data.expires_in) || 28800) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }, "user_id");
      return json({ connected: true });
    }

    // ---- sync (stappen van een dag → step_log) ----
    if (action === "sync") {
      const rows = await dbGet(`fitbit_tokens?user_id=eq.${uid}&select=*`);
      if (!rows.length) return json({ connected: false });
      let tok = rows[0];

      // Token vernieuwen als die (bijna) verlopen is.
      if (new Date(tok.expires_at).getTime() <= Date.now() + 60000) {
        const { ok, data } = await fitbitToken(basic, { grant_type: "refresh_token", refresh_token: tok.refresh_token });
        if (!ok) { await dbDelete("fitbit_tokens", `user_id=eq.${uid}`); return json({ connected: false, error: "refresh_failed" }); }
        tok = {
          ...tok,
          access_token: data.access_token,
          refresh_token: data.refresh_token || tok.refresh_token,
          expires_at: new Date(Date.now() + (Number(data.expires_in) || 28800) * 1000).toISOString(),
        };
        await dbUpsert("fitbit_tokens", {
          user_id: uid, access_token: tok.access_token, refresh_token: tok.refresh_token,
          expires_at: tok.expires_at, updated_at: new Date().toISOString(),
        }, "user_id");
      }

      const d = (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? date : new Date().toISOString().slice(0, 10);
      const actRes = await fetch(`https://api.fitbit.com/1/user/-/activities/date/${d}.json`, {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      });
      if (!actRes.ok) {
        const detail = await actRes.text();
        return json({ connected: true, error: "fetch_failed", detail: detail.slice(0, 300) }, 502);
      }
      const summary = (await actRes.json()).summary || {};
      const steps = Math.round(Number(summary.steps) || 0);

      const w = await dbGet(`weight_log?user_id=eq.${uid}&select=weight_kg&order=log_date.desc&limit=1`);
      const weight = w.length ? Number(w[0].weight_kg) || 70 : 70;
      const kcal = Math.round(steps * weight * 0.0005);

      await dbUpsert("step_log", { user_id: uid, log_date: d, steps, kcal }, "user_id,log_date");
      return json({ connected: true, steps, kcal, date: d });
    }

    return json({ error: "Onbekende actie." }, 400);
  } catch (e) {
    return json({ error: "Onverwachte fout", detail: String(e) }, 500);
  }
});
