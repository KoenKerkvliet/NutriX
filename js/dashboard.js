/* ============================================
   BRIGHTLY - Dashboard (dagoverzicht)
   ============================================ */

const SVG = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

const MEALS = [
  { key: 'ontbijt',  label: 'Ontbijt',    icon: SVG('<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" y1="2" x2="6" y2="4.5"/><line x1="10" y1="2" x2="10" y2="4.5"/><line x1="14" y1="2" x2="14" y2="4.5"/>') },
  { key: 'lunch',    label: 'Lunch',      icon: SVG('<path d="M4 11h16a8 8 0 0 1-16 0Z"/><path d="M12 3v3M9 4.5v1.5M15 4.5v1.5"/>') },
  { key: 'diner',    label: 'Diner',      icon: SVG('<path d="M3 2v7c0 1.1.9 2 2 2a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>') },
  { key: 'snack',    label: 'Tussendoor', icon: SVG('<path d="M12 8c-1-1-2.6-1.4-4-1-2 .7-3 3-3 5.5C5 16 8 21 10 21c.8 0 1.2-.4 2-.4s1.2.4 2 .4c2 0 5-5 5-8.5 0-2.5-1-4.8-3-5.5-1.4-.4-3 0-4 1Z"/><path d="M12 8c0-2 1-3.6 3-4"/>') },
  { key: 'drinken',  label: 'Drinken',    icon: SVG('<path d="M6 4h12l-1.4 15.2a2 2 0 0 1-2 1.8H9.4a2 2 0 0 1-2-1.8L6 4Z"/><path d="M5 4h14M7.6 10h8.8"/>') },
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
    const rows = mealItems.map(i => `
      <div class="meal-item">
        <div>${escapeHtml(i.name)}<div class="meta">${Math.round(i.amount_g)} g${i.brand ? ' · ' + escapeHtml(i.brand) : ''}</div></div>
        <div>${Math.round(i.kcal)} kcal</div>
      </div>`).join('');
    return `
      <div class="meal">
        <div class="meal-head">
          <div class="meal-icon">${m.icon}</div>
          <div class="meal-info">
            <div class="name">${m.label}</div>
            ${mealItems.length ? '' : '<div class="sub">Nog niets gelogd</div>'}
          </div>
          <div class="meal-kcal">${mealKcal} kcal</div>
          <a class="meal-add" href="loggen.html?meal=${m.key}&date=${dateStr}" aria-label="Toevoegen aan ${m.label}">+</a>
        </div>
        ${rows}
      </div>`;
  }).join('');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function isToday(d) { return isoDate(d) === isoDate(new Date()); }

function updateNav() {
  // niet vooruit naar de toekomst
  $('dayNext').disabled = isToday(currentDate);
}

async function refresh() {
  updateNav();
  const [profile, items] = await Promise.all([loadProfile(), loadDay(isoDate(currentDate))]);
  render(profile, items);
}

$('dayPrev').addEventListener('click', () => {
  currentDate.setDate(currentDate.getDate() - 1);
  refresh();
});

$('dayNext').addEventListener('click', () => {
  if (isToday(currentDate)) return;          // geen toekomst
  currentDate.setDate(currentDate.getDate() + 1);
  refresh();
});

$('dayToday').addEventListener('click', () => {
  if (isToday(currentDate)) return;
  currentDate = new Date();
  refresh();
});

(async function init() {
  const session = await requireAuth();
  if (!session) return;
  await refresh();
})();
