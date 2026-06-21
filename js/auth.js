/* ============================================
   BRIGHTLY - Authenticatie helpers
   Gebruikt de globale `supabase` uit supabase-config.js
   ============================================ */

/** Stuur niet-ingelogde bezoekers naar de loginpagina. Geef het sessie-object terug. */
async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  return session;
}

/** Stuur al-ingelogde bezoekers door naar het dashboard (voor de loginpagina). */
async function redirectIfLoggedIn() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) window.location.href = 'dashboard.html';
}

async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signUp(email, password, displayName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } }
  });
  if (error) throw error;
  return data;
}

async function signOut() {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
}

async function resetPassword(email) {
  const redirectTo = window.location.origin + '/wachtwoord-resetten.html';
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

/** Nederlandse foutmeldingen voor veelvoorkomende Supabase Auth-fouten. */
function authErrorNL(error) {
  const msg = (error && error.message ? error.message : '').toLowerCase();
  if (msg.includes('invalid login')) return 'Onjuist e-mailadres of wachtwoord.';
  if (msg.includes('already registered')) return 'Dit e-mailadres is al in gebruik.';
  if (msg.includes('email not confirmed')) return 'Bevestig eerst je e-mailadres via de mail die we stuurden.';
  if (msg.includes('password should be at least')) return 'Wachtwoord moet minimaal 6 tekens zijn.';
  if (msg.includes('unable to validate email')) return 'Vul een geldig e-mailadres in.';
  return error && error.message ? error.message : 'Er ging iets mis. Probeer het opnieuw.';
}
