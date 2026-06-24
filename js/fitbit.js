/* ============================================
   BRIGHTLY - Fitbit-stappen via de Google Health API (Google OAuth 2.0)
   Stappen importeren via edge function 'fitbit'.
   ============================================ */

// ▼▼▼ VUL HIER JE GOOGLE OAUTH CLIENT ID IN (eindigt op .apps.googleusercontent.com — niet geheim) ▼▼▼
const GOOGLE_CLIENT_ID = '630834399693-gv393vseie6cgdrdionuhddkdhe9mh42.apps.googleusercontent.com';
// ▲▲▲ De Client SECRET hoort NIET hier, maar als Supabase-secret GOOGLE_CLIENT_SECRET ▲▲▲

const FITBIT_REDIRECT_URI = 'https://brightlyy.nl/fitbit-callback.html';
const GOOGLE_HEALTH_SCOPE = 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly https://www.googleapis.com/auth/googlehealth.sleep.readonly';

function fitbitConfigured() { return GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.startsWith('__'); }

function fitbitIsoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** URL waar de gebruiker naartoe gaat om Brightly toegang tot de stappen te geven (Google-toestemming). */
function fitbitAuthorizeUrl() {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_HEALTH_SCOPE,
    redirect_uri: FITBIT_REDIRECT_URI,
    access_type: 'offline',     // nodig voor een refresh-token
    prompt: 'consent',          // forceert een refresh-token
    include_granted_scopes: 'true',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

/** Roept de 'fitbit' edge function aan met het toegangstoken van de ingelogde gebruiker. */
async function fitbitCall(action, extra = {}) {
  const { data } = await supabase.auth.getSession();
  const session = data && data.session;
  if (!session) return { error: 'not_authenticated' };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/fitbit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ action, client_id: GOOGLE_CLIENT_ID, ...extra }),
    });
    return await res.json();
  } catch (e) {
    return { error: String(e) };
  }
}

/** Stille dagsync (bv. bij openen van het dashboard). Doet niets als niet ingesteld. */
async function fitbitAutoSync(date) {
  if (!fitbitConfigured()) return { connected: false };
  return fitbitCall('sync', { date: date || fitbitIsoToday() });
}

/** Koppel/sync-knoppen op de Activiteit-pagina opzetten (#fitbitCard). */
async function initFitbitUI(onSynced) {
  const card = document.getElementById('fitbitCard');
  if (!card) return;
  const status = document.getElementById('fitbitStatus');
  const connectBtn = document.getElementById('fitbitConnect');
  const syncBtn = document.getElementById('fitbitSync');
  const disBtn = document.getElementById('fitbitDisconnect');

  if (!fitbitConfigured()) {
    status.textContent = 'Fitbit is nog niet ingesteld (Client ID ontbreekt).';
    connectBtn.disabled = true;
    return;
  }

  const setState = (connected, info) => {
    connectBtn.style.display = connected ? 'none' : '';
    syncBtn.style.display = connected ? '' : 'none';
    disBtn.style.display = connected ? '' : 'none';
    status.textContent = info || (connected ? 'Gekoppeld met Fitbit.' : 'Nog niet gekoppeld.');
  };

  connectBtn.onclick = () => { location.href = fitbitAuthorizeUrl(); };

  disBtn.onclick = async () => {
    disBtn.disabled = true;
    await fitbitCall('disconnect');
    disBtn.disabled = false;
    setState(false);
  };

  const doSync = async () => {
    syncBtn.disabled = true; syncBtn.textContent = 'Importeren…';
    const r = await fitbitCall('sync', { date: fitbitIsoToday() });
    syncBtn.disabled = false; syncBtn.textContent = 'Stappen importeren';
    if (r && r.connected) {
      let extra = '';
      if (r.active_kcal != null) extra += ` · ${r.active_kcal} kcal actief`;
      const wk = r.workouts;
      if (wk) {
        if (wk.ok && wk.count) extra += ` · ${wk.count} workout(s)`;
        else if (wk.status) extra += ` · workout-fout ${wk.status}: ${String(wk.detail || '').slice(0, 80)}`;
      }
      const ac = r.active;
      if (ac && ac.status) extra += ` · actief-fout ${ac.status}: ${String(ac.detail || '').slice(0, 80)}`;
      const bt = r.battery;
      if (bt) {
        if (bt.ok && bt.level != null) extra += ` · batterij ${bt.level}%`;
        else if (bt.status) extra += ` · batterij-fout ${bt.status}`;
      }
      const sl = r.sleep;
      if (sl) {
        if (sl.ok && sl.duration_min) extra += ` · slaap ${sl.duration_min} min`;
        else if (sl.none) extra += ' · geen slaap';
        else if (sl.status) extra += ` · slaap-fout ${sl.status}`;
      }
      setState(true, `Gekoppeld · ${r.steps ?? 0} stappen${extra}`);
      if (typeof onSynced === 'function') onSynced(r);
    } else {
      setState(false, 'Sessie verlopen — koppel opnieuw.');
    }
    return r;
  };
  syncBtn.onclick = doSync;

  // Status ophalen; bij koppeling meteen stille sync.
  status.textContent = 'Controleren…';
  const st = await fitbitCall('status');
  const connected = !!(st && st.connected);
  setState(connected);
  if (connected) doSync();
}
