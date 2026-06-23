/* ============================================
   BRIGHTLY - Fitbit-koppeling (legacy Fitbit Web API)
   Stappen importeren via OAuth + edge function 'fitbit'.
   LET OP: legacy API stopt sep 2026 → later migreren naar Google Health API.
   ============================================ */

// ▼▼▼ VUL HIER JE FITBIT CLIENT ID IN (van dev.fitbit.com — niet geheim) ▼▼▼
const FITBIT_CLIENT_ID = '__FITBIT_CLIENT_ID__';
// ▲▲▲ De Client SECRET hoort NIET hier, maar als Supabase-secret FITBIT_CLIENT_SECRET ▲▲▲

const FITBIT_REDIRECT_URI = 'https://brightlyy.nl/fitbit-callback.html';
const FITBIT_SCOPE = 'activity';

function fitbitConfigured() { return FITBIT_CLIENT_ID && !FITBIT_CLIENT_ID.startsWith('__'); }

function fitbitIsoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** URL waar de gebruiker naartoe gaat om Brightly toegang tot Fitbit te geven. */
function fitbitAuthorizeUrl() {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: FITBIT_CLIENT_ID,
    scope: FITBIT_SCOPE,
    redirect_uri: FITBIT_REDIRECT_URI,
    expires_in: '604800',
  });
  return `https://www.fitbit.com/oauth2/authorize?${p.toString()}`;
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
      body: JSON.stringify({ action, client_id: FITBIT_CLIENT_ID, ...extra }),
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
      setState(true, `Gekoppeld · ${r.steps ?? 0} stappen vandaag geïmporteerd.`);
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
