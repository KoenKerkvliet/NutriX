/* ============================================
   BRIGHTLY - Dashboard (dagoverzicht)
   ============================================ */

const MEALS = [
  { key: 'ontbijt',  label: 'Ontbijt',      emoji: '🌅' },
  { key: 'lunch',    label: 'Lunch',        emoji: '🥪' },
  { key: 'diner',    label: 'Diner',        emoji: '🍽️' },
  { key: 'snack',    label: 'Tussendoor',   emoji: '🍎' },
  { key: 'drinken',  label: 'Drinken',      emoji: '🥤' },
];

const RING_CIRC = 2 * Math.PI * 52; // omtrek van de ring (r=52)
let currentDate = new Date();

const $ = (id) => document.getElementById(id);

/** Lokale datum als YYYY-MM-DD (zonder tijdzone-verschuiving). */
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dutchDateLabel(d) {
  const today = isoDate(new Date());
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (isoDate(d) === today) return 'Vandaag';
  if (isoDate(d) === isoDate(y)) return 'Gisteren';
  return d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
}

async function loadProfile() {
  const { data } = await supabase.from('profiles').select('*').single();
  return data || {};
}

async function loadDay(dateStr) {
  const { data } = await supabase
    .from('food_log')
    .select('*')
    .eq('log_date', dateStr)
    .order('logged_at', { ascending: true });
  return data || [];
}

function render(profile, items) {
  $('dateLabel').textContent = currentDate.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
  $('greeting').textContent = dutchDateLabel(currentDate);

  // Totalen
  const tot = items.reduce((a, i) => ({
    kcal: a.kcal + Number(i.kcal || 0),
    carbs: a.carbs + Number(i.carbs || 0),
    protein: a.protein + Number(i.protein || 0),
    fat: a.fat + Number(i.fat || 0),
  }), { kcal: 0, carbs: 0, protein: 0, fat: 0 });

  const goal = profile.daily_kcal_goal || 2000;
  const left = Math.max(0, Math.round(goal - tot.kcal));
  $('kcalLeft').textContent = left;
  $('kcalEaten').textContent = Math.round(tot.kcal);
  $('kcalGoal').textContent = goal;

  // Ring
  const pct = Math.min(1, goal ? tot.kcal / goal : 0);
  $('ringFg').style.strokeDasharray = RING_CIRC;
  $('ringFg').style.strokeDashoffset = RING_CIRC * (1 - pct);

  // Macro's
  const pGoal = profile.daily_protein_goal || Math.round(goal * 0.30 / 4);
  const cGoal = profile.daily_carbs_goal   || Math.round(goal * 0.40 / 4);
  const fGoal = profile.daily_fat_goal     || Math.round(goal * 0.30 / 9);
  const setMacro = (bar, val, amount, mGoal) => {
    $(val).textContent = `${Math.round(amount)} g`;
    $(bar).style.width = Math.min(100, mGoal ? (amount / mGoal) * 100 : 0) + '%';
  };
  setMacro('barCarb', 'valCarb', tot.carbs, cGoal);
  setMacro('barProtein', 'valProtein', tot.protein, pGoal);
  setMacro('barFat', 'valFat', tot.fat, fGoal);

  // Maaltijden
  const dateStr = isoDate(currentDate);
  const wrap = $('meals');
  wrap.innerHTML = MEALS.map(m => {
    const mealItems = items.filter(i => i.meal_type === m.key);
    const mealKcal = Math.round(mealItems.reduce((s, i) => s + Number(i.kcal || 0), 0));
    const rows = mealItems.length
      ? mealItems.map(i => `
          <div class="meal-item">
            <div>${escapeHtml(i.name)}<div class="meta">${Math.round(i.amount_g)} g${i.brand ? ' · ' + escapeHtml(i.brand) : ''}</div></div>
            <div>${Math.round(i.kcal)} kcal</div>
          </div>`).join('')
      : `<div class="meal-empty">Nog niets gelogd</div>`;
    return `
      <div class="meal">
        <div class="meal-head">
          <div class="name"><span class="emoji">${m.emoji}</span>${m.label}<span class="kcal">· ${mealKcal} kcal</span></div>
          <a class="meal-add" href="loggen.html?meal=${m.key}&date=${dateStr}" aria-label="Toevoegen aan ${m.label}">+</a>
        </div>
        ${rows}
      </div>`;
  }).join('');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function refresh() {
  const [profile, items] = await Promise.all([loadProfile(), loadDay(isoDate(currentDate))]);
  render(profile, items);
}

$('dayPrev').addEventListener('click', () => {
  currentDate.setDate(currentDate.getDate() - 1);
  refresh();
});

(async function init() {
  const session = await requireAuth();
  if (!session) return;
  await refresh();
})();
