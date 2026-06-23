/* ============================================
   BRIGHTLY - Gewoontes (minderen/stoppen)
   Setup → starten → counter + stats (geld, calorieën, dagen).
   ============================================ */

const $ = (id) => document.getElementById(id);
let userId = null;

// Gewoonten met standaard-eenheid en kcal per eenheid (voor caloriebesparing).
const HABIT_TYPES = [
  { key: 'alcohol',     label: 'Alcohol',      unit: 'glazen',     kcal: 110, emoji: '🍺' },
  { key: 'roken',       label: 'Roken',        unit: 'sigaretten', kcal: 0,   emoji: '🚬' },
  { key: 'snoepen',     label: 'Snoepen',      unit: 'porties',    kcal: 150, emoji: '🍫' },
  { key: 'frisdrank',   label: 'Frisdrank',    unit: 'glazen',     kcal: 140, emoji: '🥤' },
  { key: 'koffie',      label: 'Koffie',       unit: 'kopjes',     kcal: 5,   emoji: '☕' },
  { key: 'energydrank', label: 'Energydrank',  unit: 'blikjes',    kcal: 115, emoji: '⚡' },
  { key: 'gokken',      label: 'Gokken',       unit: 'keer',       kcal: 0,   emoji: '🎰' },
  { key: 'social',      label: 'Social media', unit: 'uur',        kcal: 0,   emoji: '📱' },
];
const byKey = (k) => HABIT_TYPES.find(t => t.key === k) || HABIT_TYPES[0];

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function num(v) { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; }
function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysBetween(fromIso) {
  const a = new Date(fromIso + 'T00:00:00');
  const b = new Date(); b.setHours(0, 0, 0, 0);
  return Math.floor((b - a) / 86400000);
}
function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
}
function isoOf(y, mIdx, d) {
  return `${y}-${String(mIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

// Toestand voor de actieve weergave.
let currentHabit = null;
let slips = new Set();           // dagen waarop je toch iets had (YYYY-MM-DD)
let activeView = 'overzicht';    // 'overzicht' | 'kalender'
let calMonth = new Date();

/* ---------- Setup-formulier ---------- */
let selectedType = 'alcohol';

function renderSetup(prefill) {
  selectedType = prefill ? prefill.type : 'alcohol';
  $('subtitle').textContent = prefill ? 'Aanpassen' : 'Minderen of stoppen';
  $('content').innerHTML = `
    <div class="card">
      <div class="card-title">Wat wil je minderen of stoppen?</div>
      <div class="habit-types" id="habitTypes">
        ${HABIT_TYPES.map(t => `<div class="habit-type${t.key === selectedType ? ' active' : ''}" data-key="${t.key}"><span class="ht-emoji">${t.emoji}</span>${t.label}</div>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="field">
        <label for="hbAmount">Hoeveel gebruik je normaal per dag? (<span id="unitLbl">glazen</span>)</label>
        <input class="input" id="hbAmount" type="text" inputmode="decimal" placeholder="bv. 3" value="${prefill ? prefill.baseline_per_day : ''}">
        <div class="hint" id="kcalHint"></div>
      </div>
      <div class="field">
        <label for="hbCost">Hoeveel geef je er per dag aan uit? (€)</label>
        <input class="input" id="hbCost" type="text" inputmode="decimal" placeholder="bv. 6" value="${prefill ? prefill.cost_per_day : ''}">
      </div>
      <div class="field">
        <label for="hbDate">Vanaf welke dag stop je?</label>
        <input class="input" id="hbDate" type="date" value="${prefill ? prefill.quit_date : isoToday()}">
      </div>
      <div class="field">
        <label for="hbReason">Waarom wil je dit? (jouw motivatie)</label>
        <textarea class="input" id="hbReason" rows="3" placeholder="bv. fitter worden en geld besparen">${prefill ? escapeHtml(prefill.reason || '') : ''}</textarea>
      </div>
      <button class="btn" id="startBtn" type="button">${prefill ? 'Opslaan' : 'Starten'}</button>
    </div>`;

  const refreshUnit = () => {
    const t = byKey(selectedType);
    $('unitLbl').textContent = t.unit;
    const amount = num($('hbAmount').value);
    $('kcalHint').textContent = (t.kcal > 0 && amount > 0)
      ? `≈ ${Math.round(amount * t.kcal)} kcal per dag die je straks bespaart.` : '';
  };
  $('habitTypes').querySelectorAll('.habit-type').forEach(el => el.onclick = () => {
    selectedType = el.dataset.key;
    $('habitTypes').querySelectorAll('.habit-type').forEach(x => x.classList.toggle('active', x === el));
    refreshUnit();
  });
  $('hbAmount').addEventListener('input', refreshUnit);
  refreshUnit();
  $('startBtn').onclick = saveHabit;
}

async function saveHabit() {
  const t = byKey(selectedType);
  const baseline = num($('hbAmount').value);
  const cost = num($('hbCost').value);
  const quit = $('hbDate').value || isoToday();
  const reason = $('hbReason').value.trim() || null;
  if (!baseline && !cost) { showAlert('Vul minstens je dagelijkse hoeveelheid of uitgave in.', true); return; }

  const btn = $('startBtn'); btn.disabled = true; btn.textContent = 'Opslaan…';
  const { error } = await supabase.from('habits').upsert({
    user_id: userId, type: t.key, unit: t.unit,
    baseline_per_day: baseline, cost_per_day: cost, kcal_per_unit: t.kcal,
    quit_date: quit, reason, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) { btn.disabled = false; btn.textContent = 'Opslaan'; showAlert('Opslaan mislukt: ' + error.message, true); return; }
  load();
}

/* ---------- Actieve weergave: switch tussen overzicht en kalender ---------- */
function renderActive(h) {
  currentHabit = h;
  const t = byKey(h.type);
  $('subtitle').textContent = `Zonder ${t.label.toLowerCase()}`;
  $('content').innerHTML = `
    <div class="tabs" id="habitTabs">
      <button type="button" data-view="overzicht" class="${activeView === 'overzicht' ? 'active' : ''}">Overzicht</button>
      <button type="button" data-view="kalender" class="${activeView === 'kalender' ? 'active' : ''}">Kalender</button>
    </div>
    <div id="habitView"></div>`;
  $('habitTabs').querySelectorAll('button').forEach(b => b.onclick = () => {
    activeView = b.dataset.view;
    $('habitTabs').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    renderView();
  });
  renderView();
}

function renderView() {
  if (activeView === 'kalender') renderKalender();
  else renderOverzicht();
}

function reasonCard(h) {
  return h.reason ? `<div class="card"><div class="habit-reason">💪 ${escapeHtml(h.reason)}</div></div>` : '';
}
function actionButtons() {
  return `<button class="btn btn-secondary" id="editBtn" type="button">Aanpassen</button>
    <button class="btn-ghost btn btn-sm" id="resetBtn" type="button" style="margin-top:8px;">Stoppen met bijhouden</button>`;
}
function wireActions() {
  $('editBtn').onclick = () => renderSetup(currentHabit);
  $('resetBtn').onclick = async () => {
    if (!confirm('Weet je zeker dat je het bijhouden van deze gewoonte wilt stoppen? Je teller en stats verdwijnen.')) return;
    await supabase.from('habit_slips').delete().eq('user_id', userId);
    await supabase.from('habits').delete().eq('user_id', userId);
    slips = new Set();
    load();
  };
}

/* ---------- Overzicht (counter + stats, slip-dagen tellen niet mee) ---------- */
function renderOverzicht() {
  const h = currentHabit;
  const t = byKey(h.type);
  const view = $('habitView');
  const elapsed = daysBetween(h.quit_date);
  const todayStr = isoToday();

  if (elapsed < 0) {
    view.innerHTML = `
      <div class="card">
        <div class="habit-counter">
          <div class="hc-num">${-elapsed}</div>
          <div class="hc-lbl">${-elapsed === 1 ? 'dag' : 'dagen'} tot je startdatum (${fmtDate(h.quit_date)})</div>
        </div>
      </div>
      ${reasonCard(h)}${actionButtons()}`;
    wireActions();
    return;
  }

  const slipsInRange = [...slips].filter(d => d >= h.quit_date && d <= todayStr).length;
  const clean = Math.max(0, elapsed - slipsInRange);
  const money = Math.round(clean * Number(h.cost_per_day || 0));
  const unitsAvoided = Math.round(clean * Number(h.baseline_per_day || 0));
  const cals = Math.round(unitsAvoided * Number(h.kcal_per_unit || 0));
  const midStat = Number(h.kcal_per_unit) > 0
    ? `<div class="hstat"><div class="hs-num">${cals.toLocaleString('nl-NL')}</div><div class="hs-lbl">kcal niet gehad</div></div>`
    : `<div class="hstat"><div class="hs-num">${unitsAvoided.toLocaleString('nl-NL')}</div><div class="hs-lbl">${t.unit} niet gebruikt</div></div>`;
  const footHint = slipsInRange
    ? `<div class="hint" style="text-align:center;margin-top:12px;">${slipsInRange} ${slipsInRange === 1 ? 'dag' : 'dagen'} toch iets gehad (zie Kalender).</div>`
    : (Number(h.kcal_per_unit) > 0 ? `<div class="hint" style="text-align:center;margin-top:12px;">≈ ${unitsAvoided.toLocaleString('nl-NL')} ${t.unit} niet gebruikt.</div>` : '');

  view.innerHTML = `
    <div class="card">
      <div class="habit-counter">
        <div class="hc-num">${clean}</div>
        <div class="hc-lbl">${clean === 1 ? 'dag' : 'dagen'} zonder ${t.label.toLowerCase()} · sinds ${fmtDate(h.quit_date)}</div>
      </div>
    </div>
    <div class="card">
      <div class="habit-stats">
        <div class="hstat"><div class="hs-num">€ ${money.toLocaleString('nl-NL')}</div><div class="hs-lbl">bespaard</div></div>
        ${midStat}
        <div class="hstat"><div class="hs-num">${clean}</div><div class="hs-lbl">dagen</div></div>
      </div>
      ${footHint}
    </div>
    ${reasonCard(h)}${actionButtons()}`;
  wireActions();
}

/* ---------- Kalender: groene dagen = volgehouden, tik = 'toch gehad' ---------- */
function renderKalender() {
  const h = currentHabit;
  const view = $('habitView');
  const todayStr = isoToday();
  const now = new Date();
  const first = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1);
  const last = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0);
  const lead = (first.getDay() + 6) % 7;
  const nextDisabled = calMonth.getFullYear() === now.getFullYear() && calMonth.getMonth() === now.getMonth();

  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<div class="cal-cell empty"></div>';
  for (let day = 1; day <= last.getDate(); day++) {
    const ds = isoOf(calMonth.getFullYear(), calMonth.getMonth(), day);
    const tracked = ds >= h.quit_date && ds <= todayStr;
    let cls = 'cal-cell';
    if (!tracked) cls += ' future';
    else if (slips.has(ds)) cls += ' over';
    else cls += ' within';
    cells += `<button type="button" class="${cls}"${tracked ? ` data-date="${ds}"` : ' disabled'}><span class="cal-num">${day}</span></button>`;
  }

  view.innerHTML = `
    <div class="card">
      <div class="date-nav" style="margin-bottom:14px;">
        <button class="nav-day" id="hPrev" type="button" aria-label="Vorige maand">‹</button>
        <div class="day-center" style="cursor:default;"><span class="day-title">${MONTHS[calMonth.getMonth()]} ${calMonth.getFullYear()}</span></div>
        <button class="nav-day" id="hNext" type="button" aria-label="Volgende maand"${nextDisabled ? ' disabled' : ''}>›</button>
      </div>
      <div class="cal-dow"><span>ma</span><span>di</span><span>wo</span><span>do</span><span>vr</span><span>za</span><span>zo</span></div>
      <div class="cal-grid">${cells}</div>
      <div class="cal-legend">
        <span class="lg"><i class="dot within"></i> Volgehouden</span>
        <span class="lg"><i class="dot over"></i> Toch gehad</span>
      </div>
      <div class="hint" style="text-align:center;margin-top:10px;">Tik op een dag om aan te geven dat je die dag tóch iets had.</div>
    </div>`;

  $('hPrev').onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderKalender(); };
  $('hNext').onclick = () => { if (nextDisabled) return; calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderKalender(); };
  view.querySelectorAll('.cal-cell[data-date]').forEach(c => c.onclick = () => toggleSlip(c.dataset.date));
}

async function toggleSlip(ds) {
  if (slips.has(ds)) {
    slips.delete(ds);
    await supabase.from('habit_slips').delete().eq('user_id', userId).eq('slip_date', ds);
  } else {
    slips.add(ds);
    await supabase.from('habit_slips').insert({ user_id: userId, slip_date: ds });
  }
  renderKalender();
}

async function loadSlips() {
  const { data } = await supabase.from('habit_slips').select('slip_date').eq('user_id', userId);
  slips = new Set((data || []).map(r => r.slip_date));
}

function showAlert(msg, isError) {
  const a = $('alert');
  a.textContent = msg;
  a.className = 'alert ' + (isError ? 'alert-error' : 'alert-ok');
}

async function load() {
  $('alert').className = 'alert hidden';
  const { data } = await supabase.from('habits').select('*').eq('user_id', userId).maybeSingle();
  if (data) { await loadSlips(); renderActive(data); }
  else renderSetup(null);
}

(async function init() {
  const session = await requireAuth();
  if (!session) return;
  userId = session.user.id;
  await load();
})();
