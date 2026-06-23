/* ============================================
   BRIGHTLY - Activiteit (stappen + sport)
   ============================================ */

const $ = (id) => document.getElementById(id);

// [key, label, MET] — MET = intensiteit voor calorieschatting
const ACTIVITIES = [
  ['wandelen', 'Wandelen', 3.5],
  ['hardlopen', 'Hardlopen', 9.8],
  ['fietsen', 'Fietsen (buiten)', 7.5],
  ['hometrainer', 'Hometrainer', 7.0],
  ['tennis', 'Tennis', 7.3],
  ['zwemmen', 'Zwemmen', 7.0],
  ['krachttraining', 'Krachttraining', 5.0],
  ['voetbal', 'Voetbal', 7.0],
  ['wielrennen', 'Wielrennen', 8.5],
  ['overig', 'Overig', 5.0],
];
const ACT_LABEL = Object.fromEntries(ACTIVITIES.map(([k, l]) => [k, l]));
const ACT_MET = Object.fromEntries(ACTIVITIES.map(([k, , m]) => [k, m]));

let userId = null;
let weightKg = 70;        // valt terug op 70 kg als er nog geen gewicht is
let currentDate = new Date();

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isToday(d) { return isoDate(d) === isoDate(new Date()); }
function dutchLabel(d) {
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (isToday(d)) return 'Vandaag';
  if (isoDate(d) === isoDate(y)) return 'Gisteren';
  return d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function stepsToKcal(steps) { return Math.round(steps * weightKg * 0.0005); }
function activityKcal(metKey, minutes) { return Math.round((ACT_MET[metKey] || 5) * weightKg * (minutes / 60)); }

async function loadWeight() {
  const { data } = await supabase.from('weight_log').select('weight_kg').order('log_date', { ascending: false }).limit(1);
  if (data && data.length) weightKg = Number(data[0].weight_kg) || 70;
}

async function refresh() {
  const dateStr = isoDate(currentDate);
  $('greeting').textContent = dutchLabel(currentDate);
  $('dateLabel').textContent = currentDate.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
  $('dayNext').disabled = isToday(currentDate);

  // Stappen van de dag
  const { data: stepRow } = await supabase.from('step_log').select('*').eq('log_date', dateStr).maybeSingle();
  const stepKcal = stepRow ? Number(stepRow.kcal) : 0;
  $('steps').value = stepRow ? stepRow.steps : '';
  $('stepsKcal').value = stepKcal || '';

  // Activiteiten van de dag
  const { data: acts } = await supabase.from('activity_log').select('*').eq('log_date', dateStr).order('created_at', { ascending: true });
  const list = acts || [];
  const actKcal = list.reduce((s, a) => s + Number(a.kcal || 0), 0);

  $('burnTotal').textContent = Math.round(stepKcal + actKcal);

  $('actList').innerHTML = list.length
    ? list.map(a => `
        <div class="meal-item">
          <div>${escapeHtml(ACT_LABEL[a.type] || a.type)}<div class="meta">${a.duration_min ? Math.round(a.duration_min) + ' min' : ''}</div></div>
          <div style="display:flex;align-items:center;gap:12px;">
            <b>${Math.round(a.kcal)} kcal</b>
            <button class="act-del" data-id="${a.id}" aria-label="Verwijderen">✕</button>
          </div>
        </div>`).join('')
    : '<div class="meal-empty">Nog geen sport gelogd.</div>';

  $('actList').querySelectorAll('.act-del').forEach(b => b.onclick = () => deleteActivity(b.dataset.id));
}

function updateStepsKcal() {
  const s = parseNum($('steps').value) || 0;
  $('stepsKcal').value = s ? stepsToKcal(s) : '';
}

function updateActHint() {
  const min = parseNum($('actDur').value);
  const type = $('actType').value;
  if (min > 0) $('actHint').textContent = `Schatting: ≈ ${activityKcal(type, min)} kcal (pas aan indien gewenst).`;
  else $('actHint').textContent = 'Laat verbranding leeg voor een automatische schatting.';
}

async function saveSteps() {
  const steps = Math.round(parseNum($('steps').value));
  if (!steps || steps < 0) { alert('Vul een geldig aantal stappen in.'); return; }
  const btn = $('saveSteps'); btn.disabled = true; btn.textContent = 'Opslaan…';
  const { error } = await supabase.from('step_log')
    .upsert({ user_id: userId, log_date: isoDate(currentDate), steps, kcal: stepsToKcal(steps) }, { onConflict: 'user_id,log_date' });
  btn.disabled = false; btn.textContent = 'Stappen opslaan';
  if (error) { alert('Opslaan mislukt: ' + error.message); return; }
  refresh();
}

async function addActivity() {
  const type = $('actType').value;
  const min = parseNum($('actDur').value);
  let kcal = parseNum($('actKcal').value);
  if (!min && !kcal) { alert('Vul een duur of een verbranding in.'); return; }
  if (!kcal || isNaN(kcal)) kcal = activityKcal(type, min || 0);

  const btn = $('addAct'); btn.disabled = true; btn.textContent = 'Toevoegen…';
  const { error } = await supabase.from('activity_log').insert({
    user_id: userId,
    log_date: isoDate(currentDate),
    type,
    duration_min: min || null,
    kcal: Math.round(kcal),
  });
  btn.disabled = false; btn.textContent = 'Toevoegen';
  if (error) { alert('Opslaan mislukt: ' + error.message); return; }
  $('actDur').value = ''; $('actKcal').value = ''; updateActHint();
  refresh();
}

async function deleteActivity(id) {
  const { error } = await supabase.from('activity_log').delete().eq('id', id);
  if (error) { alert('Verwijderen mislukt: ' + error.message); return; }
  refresh();
}

(async function init() {
  const session = await requireAuth();
  if (!session) return;
  userId = session.user.id;

  $('actType').innerHTML = ACTIVITIES.map(([k, l]) => `<option value="${k}">${l}</option>`).join('');

  await loadWeight();

  $('steps').addEventListener('input', updateStepsKcal);
  $('actDur').addEventListener('input', updateActHint);
  $('actType').addEventListener('change', updateActHint);
  $('saveSteps').onclick = saveSteps;
  $('addAct').onclick = addActivity;
  $('dayPrev').onclick = () => { currentDate.setDate(currentDate.getDate() - 1); refresh(); };
  $('dayNext').onclick = () => { if (!isToday(currentDate)) { currentDate.setDate(currentDate.getDate() + 1); refresh(); } };
  $('dayToday').onclick = () => { if (!isToday(currentDate)) { currentDate = new Date(); refresh(); } };

  await refresh();
  if (window.hideLoader) hideLoader();

  // Fitbit-koppeling (knoppen + automatische import bij openen).
  if (typeof initFitbitUI === 'function') initFitbitUI(() => { if (isToday(currentDate)) refresh(); });
})();
