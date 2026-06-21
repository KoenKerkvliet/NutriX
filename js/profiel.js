/* ============================================
   NUTRIX - Profiel, doelen & calorieberekening
   ============================================ */

const $ = (id) => document.getElementById(id);
let userId = null;
let latestWeight = null;

const ACTIVITY = { zittend: 1.2, licht: 1.375, matig: 1.55, actief: 1.725, zeer_actief: 1.9 };
const GOAL_ADJ = { afvallen: -500, onderhoud: 0, aankomen: 400 };

function ageFrom(birth) {
  if (!birth) return null;
  const b = new Date(birth), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a;
}

/** Mifflin-St Jeor BMR -> TDEE -> doel. Geeft {kcal,protein,carbs,fat} of null. */
function calcGoals() {
  const w = latestWeight, h = Number($('height').value), age = ageFrom($('birth').value);
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
}

async function save(e) {
  e.preventDefault();
  const a = $('alert'); a.className = 'alert hidden';
  const payload = {
    id: userId,
    display_name: $('name').value.trim() || null,
    gender: $('gender').value || null,
    birth_date: $('birth').value || null,
    height_cm: $('height').value ? Number($('height').value) : null,
    activity_level: $('activity').value || null,
    goal: $('goal').value || null,
    target_weight_kg: $('target').value ? Number($('target').value) : null,
    daily_kcal_goal: $('kcalGoal').value ? Number($('kcalGoal').value) : null,
    daily_protein_goal: $('proteinGoal').value ? Number($('proteinGoal').value) : null,
    daily_carbs_goal: $('carbsGoal').value ? Number($('carbsGoal').value) : null,
    daily_fat_goal: $('fatGoal').value ? Number($('fatGoal').value) : null,
    updated_at: new Date().toISOString(),
  };
  const btn = $('saveBtn'); btn.disabled = true; btn.textContent = 'Opslaan…';
  const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' });
  btn.disabled = false; btn.textContent = 'Opslaan';
  if (error) { a.textContent = 'Opslaan mislukt: ' + error.message; a.className = 'alert alert-error'; return; }
  a.textContent = 'Profiel opgeslagen.'; a.className = 'alert alert-ok';
}

(async function init() {
  const session = await requireAuth();
  if (!session) return;
  userId = session.user.id;
  await load();
  $('profileForm').addEventListener('submit', save);
  $('calcBtn').onclick = applyCalc;
  $('logoutBtn').onclick = signOut;
})();
