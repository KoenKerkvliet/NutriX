/* ============================================
   BRIGHTLY - Kalender (maandoverzicht)
   Groene rand = binnen je caloriedoel gebleven, oranje = eroverheen.
   ============================================ */

const $ = (id) => document.getElementById(id);
const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

let viewMonth = new Date();
viewMonth.setDate(1);
let dailyGoal = 2000;

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Eerste van de maand op huidige niveau (dag 1, lokale tijd). */
function monthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function monthEnd(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }

async function loadProfileGoal() {
  const { data } = await supabase.from('profiles').select('daily_kcal_goal').single();
  return (data && data.daily_kcal_goal) || 2000;
}

/** Haal voor de zichtbare maand het gegeten + verbrand per dag op. */
async function loadMonth(startStr, endStr) {
  const [foodRes, stepRes, actRes] = await Promise.all([
    supabase.from('food_log').select('log_date,kcal,qty').gte('log_date', startStr).lte('log_date', endStr),
    supabase.from('step_log').select('log_date,kcal').gte('log_date', startStr).lte('log_date', endStr),
    supabase.from('activity_log').select('log_date,kcal').gte('log_date', startStr).lte('log_date', endStr),
  ]);

  const eaten = {};   // datum -> kcal gegeten
  const logged = new Set();
  (foodRes.data || []).forEach(r => {
    logged.add(r.log_date);
    eaten[r.log_date] = (eaten[r.log_date] || 0) + Number(r.kcal || 0) * (r.qty || 1);
  });

  const burned = {};  // datum -> kcal verbrand (stappen + sport)
  (stepRes.data || []).forEach(r => { burned[r.log_date] = (burned[r.log_date] || 0) + Number(r.kcal || 0); });
  (actRes.data || []).forEach(r => { burned[r.log_date] = (burned[r.log_date] || 0) + Number(r.kcal || 0); });

  return { eaten, burned, logged };
}

function render(data) {
  $('monthLabel').textContent = `${MONTHS[viewMonth.getMonth()]} ${viewMonth.getFullYear()}`;

  const todayStr = isoDate(new Date());
  // 'Volgende maand' uitschakelen zodra we in de huidige maand zitten (geen toekomst).
  const now = new Date();
  $('monthNext').disabled = viewMonth.getFullYear() === now.getFullYear() && viewMonth.getMonth() === now.getMonth();

  const first = monthStart(viewMonth);
  const last = monthEnd(viewMonth);
  const lead = (first.getDay() + 6) % 7;   // maandag = 0

  const grid = $('calGrid');
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<div class="cal-cell empty"></div>';

  for (let day = 1; day <= last.getDate(); day++) {
    const d = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day);
    const ds = isoDate(d);
    const future = ds > todayStr;
    const isToday = ds === todayStr;

    let status = '';
    if (!future && data.logged.has(ds)) {
      const budget = dailyGoal + (data.burned[ds] || 0);
      status = (data.eaten[ds] || 0) <= budget ? 'within' : 'over';
    }

    const cls = ['cal-cell', status, future ? 'future' : '', isToday ? 'today' : '']
      .filter(Boolean).join(' ');
    const clickable = !future;
    cells += `<button type="button" class="${cls}"${clickable ? ` data-date="${ds}"` : ' disabled'}>
      <span class="cal-num">${day}</span>
    </button>`;
  }

  grid.innerHTML = cells;
  grid.querySelectorAll('.cal-cell[data-date]').forEach(c => {
    c.onclick = () => { location.href = `dashboard.html?date=${c.dataset.date}`; };
  });
}

async function refresh() {
  const data = await loadMonth(isoDate(monthStart(viewMonth)), isoDate(monthEnd(viewMonth)));
  render(data);
}

$('monthPrev').addEventListener('click', () => {
  viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
  refresh();
});
$('monthNext').addEventListener('click', () => {
  const now = new Date();
  if (viewMonth.getFullYear() === now.getFullYear() && viewMonth.getMonth() === now.getMonth()) return;
  viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);
  refresh();
});
$('monthToday').addEventListener('click', () => {
  viewMonth = monthStart(new Date());
  refresh();
});

(async function init() {
  const session = await requireAuth();
  if (!session) return;
  dailyGoal = await loadProfileGoal();
  await refresh();
})();
