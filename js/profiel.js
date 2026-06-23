/* ============================================
   BRIGHTLY - Profiel, doelen & calorieberekening
   ============================================ */

const $ = (id) => document.getElementById(id);
let userId = null;
let latestWeight = null;

const ACTIVITY = { zittend: 1.2, licht: 1.375, matig: 1.55, actief: 1.725, zeer_actief: 1.9 };
const GOAL_ADJ = { afvallen: -500, onderhoud: 0, aankomen: 400 };

// Eetmoment-sleutel → invoerveld-id voor de percentageverdeling.
const PCT_INPUTS = { ontbijt: 'pctOntbijt', lunch: 'pctLunch', diner: 'pctDiner', snack: 'pctSnack', drinken: 'pctDrinken' };
const MEAL_LABELS = { ontbijt: 'Ontbijt', lunch: 'Lunch', diner: 'Diner', snack: 'Tussendoor', drinken: 'Drinken' };

const GENDER_LABEL = { man: 'Man', vrouw: 'Vrouw', anders: 'Anders' };
const GOAL_LABEL = { afvallen: 'Afvallen', onderhoud: 'Op gewicht blijven', aankomen: 'Aankomen' };
const ACTIVITY_LABEL = { zittend: 'Zittend', licht: 'Licht actief', matig: 'Matig actief', actief: 'Actief', zeer_actief: 'Zeer actief' };

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '–';
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

/** Hero-kaart bovenaan bijwerken. */
function updateHero() {
  const name = $('name').value.trim();
  $('phAvatar').textContent = initials(name);
  $('phName').textContent = name || 'Mijn profiel';
  const goalLabel = GOAL_LABEL[$('goal').value] || '';
  const target = $('target').value;
  let sub = goalLabel;
  if (latestWeight != null && target) sub += `${goalLabel ? ' · ' : ''}${latestWeight} → ${target} kg`;
  else if (target) sub += `${goalLabel ? ' · ' : ''}doel ${target} kg`;
  $('phGoalSummary').textContent = sub;
}

/** Korte samenvatting per ingeklapte sectie. */
function updateSummaries() {
  const pers = [$('name').value.trim(), GENDER_LABEL[$('gender').value], $('height').value ? $('height').value + ' cm' : ''].filter(Boolean);
  $('subPersoonlijk').textContent = pers.join(' · ') || 'Vul je gegevens in';
  const da = [GOAL_LABEL[$('goal').value], ACTIVITY_LABEL[$('activity').value]].filter(Boolean);
  $('subDoel').textContent = da.join(' · ') || '—';
  const kc = $('kcalGoal').value, pr = $('proteinGoal').value;
  $('subDagdoelen').textContent = kc ? `${Number(kc).toLocaleString('nl-NL')} kcal${pr ? ` · ${pr} g eiwit` : ''}` : 'Nog niet ingesteld';
  $('subSplit').textContent = Object.values(PCT_INPUTS).map(id => $(id).value || 0).join('/') + '%';
  $('subModules').textContent = $('modGewoontes').checked ? 'Gewoontes aan' : 'Niets aan';
}

/** Live voorbeeld: kcal per maaltijd + totaal-percentage (oranje als ≠ 100%). */
function updateSplitHint() {
  const goal = Number($('kcalGoal').value) || 0;
  $('splitGoal').textContent = goal || '—';
  let sum = 0;
  const parts = Object.keys(PCT_INPUTS).map(k => {
    const pct = Number($(PCT_INPUTS[k]).value) || 0;
    sum += pct;
    return `${MEAL_LABELS[k]} ${goal ? Math.round(goal * pct / 100) : 0}`;
  });
  const hint = $('splitHint');
  hint.textContent = (goal ? parts.join(' · ') + ' kcal' : 'Vul eerst je dagdoel in.') + ` — totaal ${sum}%`;
  hint.style.color = sum === 100 ? '' : 'var(--orange)';
}

/** Waarde uit een percentageveld, of de standaard als het leeg is (0 blijft 0). */
function pctOrDefault(id, def) {
  const raw = $(id).value;
  if (raw === '' || raw == null) return def;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : def;
}

function ageFrom(birth) {
  if (!birth) return null;
  const b = new Date(birth), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a;
}

/** Mifflin-St Jeor BMR -> TDEE -> doel. Geeft {kcal,protein,carbs,fat} of null. */
function calcGoals() {
  const w = latestWeight, h = parseNum($('height').value), age = ageFrom($('birth').value);
  const gender = $('gender').value, activity = $('activity').value, goal = $('goal').value;
  if (!w || !h || !age) return null;
  let bmr = 10 * w + 6.25 * h - 5 * age;
  bmr += gender === 'man' ? 5 : gender === 'vrouw' ? -161 : -78;
  const tdee = bmr * (ACTIVITY[activity] || 1.2);
  const kcal = Math.max(1200, Math.round(tdee + (GOAL_ADJ[goal] ?? 0)));
  return {
    kcal,
    protein: Math.round(kcal * 0.30 / 4),
    carbs: Math.round(kcal * 0.40 / 4),
    fat: Math.round(kcal * 0.30 / 9),
  };
}

function applyCalc() {
  const g = calcGoals();
  if (!g) {
    alert('Vul je geslacht, geboortedatum, lengte en activiteit in. Log ook minimaal één keer je gewicht.');
    return;
  }
  $('kcalGoal').value = g.kcal;
  $('proteinGoal').value = g.protein;
  $('carbsGoal').value = g.carbs;
  $('fatGoal').value = g.fat;
  updateSplitHint();
}

async function load() {
  const { data: prof } = await supabase.from('profiles').select('*').single();
  const { data: w } = await supabase.from('weight_log').select('weight_kg').order('log_date', { ascending: false }).limit(1);
  latestWeight = w && w.length ? Number(w[0].weight_kg) : null;
  $('weightHint').textContent = latestWeight ? `Huidig gewicht: ${latestWeight} kg` : 'Nog geen gewicht gelogd — doe dat eerst op de Gewicht-pagina.';

  if (prof) {
    $('name').value = prof.display_name || '';
    if (prof.gender) $('gender').value = prof.gender;
    $('birth').value = prof.birth_date || '';
    $('height').value = prof.height_cm || '';
    if (prof.activity_level) $('activity').value = prof.activity_level;
    if (prof.goal) $('goal').value = prof.goal;
    $('target').value = prof.target_weight_kg || '';
    $('kcalGoal').value = prof.daily_kcal_goal || '';
    $('proteinGoal').value = prof.daily_protein_goal || '';
    $('carbsGoal').value = prof.daily_carbs_goal || '';
    $('fatGoal').value = prof.daily_fat_goal || '';
  }

  // Maaltijdverdeling (percentages), terugvallend op de standaard.
  Object.keys(PCT_INPUTS).forEach(k => {
    const v = prof && prof[MEAL_PCT_COLS[k]] != null ? prof[MEAL_PCT_COLS[k]] : DEFAULT_MEAL_PCT[k];
    $(PCT_INPUTS[k]).value = v;
  });

  // Modules + cache voor de onderbalk (nav.js leest deze cache).
  const mods = (prof && prof.modules) || {};
  $('modGewoontes').checked = !!mods.gewoontes;
  try { localStorage.setItem('brightly_modules', JSON.stringify(mods)); } catch (e) {}

  updateSplitHint();
  updateHero();
  updateSummaries();
}

async function save(e) {
  e.preventDefault();
  const a = $('alert'); a.className = 'alert hidden';
  const payload = {
    id: userId,
    display_name: $('name').value.trim() || null,
    gender: $('gender').value || null,
    birth_date: $('birth').value || null,
    height_cm: $('height').value ? parseNum($('height').value) : null,
    activity_level: $('activity').value || null,
    goal: $('goal').value || null,
    target_weight_kg: $('target').value ? parseNum($('target').value) : null,
    daily_kcal_goal: $('kcalGoal').value ? Number($('kcalGoal').value) : null,
    daily_protein_goal: $('proteinGoal').value ? Number($('proteinGoal').value) : null,
    daily_carbs_goal: $('carbsGoal').value ? Number($('carbsGoal').value) : null,
    daily_fat_goal: $('fatGoal').value ? Number($('fatGoal').value) : null,
    meal_pct_ontbijt: pctOrDefault('pctOntbijt', DEFAULT_MEAL_PCT.ontbijt),
    meal_pct_lunch: pctOrDefault('pctLunch', DEFAULT_MEAL_PCT.lunch),
    meal_pct_diner: pctOrDefault('pctDiner', DEFAULT_MEAL_PCT.diner),
    meal_pct_snack: pctOrDefault('pctSnack', DEFAULT_MEAL_PCT.snack),
    meal_pct_drinken: pctOrDefault('pctDrinken', DEFAULT_MEAL_PCT.drinken),
    modules: { gewoontes: $('modGewoontes').checked },
    updated_at: new Date().toISOString(),
  };
  const btn = $('saveBtn'); btn.disabled = true; btn.textContent = 'Opslaan…';
  const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' });
  btn.disabled = false; btn.textContent = 'Opslaan';
  if (error) { a.textContent = 'Opslaan mislukt: ' + error.message; a.className = 'alert alert-error'; return; }
  try { localStorage.setItem('brightly_modules', JSON.stringify(payload.modules)); } catch (e) {}
  a.textContent = 'Profiel opgeslagen.'; a.className = 'alert alert-ok';
  updateHero();
  updateSummaries();
}

(async function init() {
  const session = await requireAuth();
  if (!session) return;
  userId = session.user.id;
  await load();
  $('profileForm').addEventListener('submit', save);
  $('calcBtn').onclick = applyCalc;
  $('logoutBtn').onclick = signOut;
  // Live voorbeeld bijwerken bij wijzigen van dagdoel of de percentages.
  ['kcalGoal', ...Object.values(PCT_INPUTS)].forEach(id => $(id).addEventListener('input', updateSplitHint));
  // Hero + sectiesamenvattingen live meelopen.
  $('profileForm').addEventListener('input', () => { updateHero(); updateSummaries(); });

  // Inklapbare secties (standaard allemaal dicht).
  document.querySelectorAll('.collapsible .sec-head').forEach(h => {
    h.addEventListener('click', () => h.closest('.collapsible').classList.toggle('open'));
  });

  // Module 'Gewoontes' direct toepassen (zonder dat 'Opslaan' nodig is).
  $('modGewoontes').addEventListener('change', async () => {
    const mods = { gewoontes: $('modGewoontes').checked };
    try { localStorage.setItem('brightly_modules', JSON.stringify(mods)); } catch (e) {}
    await supabase.from('profiles').update({ modules: mods }).eq('id', userId);
    updateSummaries();
  });
})();
