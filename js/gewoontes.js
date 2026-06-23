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

/* ---------- Actieve weergave (counter + stats) ---------- */
function renderActive(h) {
  const t = byKey(h.type);
  const days = daysBetween(h.quit_date);
  $('subtitle').textContent = `Zonder ${t.label.toLowerCase()}`;

  if (days < 0) {
    // Startdatum ligt in de toekomst → aftellen.
    $('content').innerHTML = `
      <div class="card">
        <div class="habit-counter">
          <div class="hc-num">${-days}</div>
          <div class="hc-lbl">${-days === 1 ? 'dag' : 'dagen'} tot je startdatum (${fmtDate(h.quit_date)})</div>
        </div>
      </div>
      ${h.reason ? `<div class="card"><div class="habit-reason">💪 ${escapeHtml(h.reason)}</div></div>` : ''}
      <button class="btn btn-secondary" id="editBtn" type="button">Aanpassen</button>
      <button class="btn-ghost btn btn-sm" id="resetBtn" type="button" style="margin-top:8px;">Stoppen met bijhouden</button>`;
  } else {
    const money = Math.round(days * Number(h.cost_per_day || 0));
    const unitsAvoided = Math.round(days * Number(h.baseline_per_day || 0));
    const cals = Math.round(unitsAvoided * Number(h.kcal_per_unit || 0));
    const midStat = Number(h.kcal_per_unit) > 0
      ? `<div class="hstat"><div class="hs-num">${cals.toLocaleString('nl-NL')}</div><div class="hs-lbl">kcal niet gehad</div></div>`
      : `<div class="hstat"><div class="hs-num">${unitsAvoided.toLocaleString('nl-NL')}</div><div class="hs-lbl">${t.unit} niet gebruikt</div></div>`;

    $('content').innerHTML = `
      <div class="card">
        <div class="habit-counter">
          <div class="hc-num">${days}</div>
          <div class="hc-lbl">${days === 1 ? 'dag' : 'dagen'} zonder ${t.label.toLowerCase()} · sinds ${fmtDate(h.quit_date)}</div>
        </div>
      </div>
      <div class="card">
        <div class="habit-stats">
          <div class="hstat"><div class="hs-num">€ ${money.toLocaleString('nl-NL')}</div><div class="hs-lbl">bespaard</div></div>
          ${midStat}
          <div class="hstat"><div class="hs-num">${days}</div><div class="hs-lbl">dagen</div></div>
        </div>
        ${Number(h.kcal_per_unit) > 0 ? `<div class="hint" style="text-align:center;margin-top:12px;">≈ ${unitsAvoided.toLocaleString('nl-NL')} ${t.unit} niet gebruikt.</div>` : ''}
      </div>
      ${h.reason ? `<div class="card"><div class="habit-reason">💪 ${escapeHtml(h.reason)}</div></div>` : ''}
      <button class="btn btn-secondary" id="editBtn" type="button">Aanpassen</button>
      <button class="btn-ghost btn btn-sm" id="resetBtn" type="button" style="margin-top:8px;">Stoppen met bijhouden</button>`;
  }

  $('editBtn').onclick = () => renderSetup(h);
  $('resetBtn').onclick = async () => {
    if (!confirm('Weet je zeker dat je het bijhouden van deze gewoonte wilt stoppen? Je teller en stats verdwijnen.')) return;
    await supabase.from('habits').delete().eq('user_id', userId);
    load();
  };
}

function showAlert(msg, isError) {
  const a = $('alert');
  a.textContent = msg;
  a.className = 'alert ' + (isError ? 'alert-error' : 'alert-ok');
}

async function load() {
  $('alert').className = 'alert hidden';
  const { data } = await supabase.from('habits').select('*').eq('user_id', userId).maybeSingle();
  if (data) renderActive(data);
  else renderSetup(null);
}

(async function init() {
  const session = await requireAuth();
  if (!session) return;
  userId = session.user.id;
  await load();
})();
