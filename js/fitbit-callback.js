/* ============================================
   BRIGHTLY - Fitbit OAuth-callback
   Fitbit stuurt hierheen terug met ?code=… → inwisselen voor tokens.
   ============================================ */

(async function () {
  const status = document.getElementById('cbStatus');
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const error = params.get('error');

  if (error) {
    status.textContent = 'Koppelen geannuleerd of geweigerd. Je kunt het terugsturen.';
    setTimeout(() => location.href = 'activiteit.html', 2500);
    return;
  }
  if (!code) {
    status.textContent = 'Geen autorisatiecode ontvangen.';
    setTimeout(() => location.href = 'activiteit.html', 2500);
    return;
  }

  // Moet ingelogd zijn (zelfde sessie als de app) om aan de juiste gebruiker te koppelen.
  const session = await requireAuth();
  if (!session) return;

  const res = await fitbitCall('auth', { code });
  if (res && res.connected) {
    status.textContent = '✓ Fitbit gekoppeld! Stappen worden nu opgehaald…';
    await fitbitCall('sync', { date: fitbitIsoToday() }).catch(() => {});
    setTimeout(() => location.href = 'activiteit.html', 1200);
  } else {
    status.textContent = 'Koppelen mislukt: ' + (res && (res.detail || res.error) ? String(res.detail || res.error).slice(0, 200) : 'onbekende fout');
    setTimeout(() => location.href = 'activiteit.html', 4000);
  }
})();
