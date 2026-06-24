/* ============================================
   BRIGHTLY - Snel loggen (transcript -> AI -> items per maaltijd)
   ============================================ */

const $ = (id) => document.getElementById(id);
const MEAL_KEYS = ['ontbijt', 'lunch', 'diner', 'snack', 'drinken'];
const MEAL_LABELS = { ontbijt: 'Ontbijt', lunch: 'Lunch', diner: 'Diner', snack: 'Tussendoor', drinken: 'Drinken' };

let userId = null;
let parsed = [];   // [{ meal, item }]

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function showAlert(msg, isError) {
  const a = $('alert'); a.textContent = msg; a.className = 'alert ' + (isError ? 'alert-error' : 'alert-ok');
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

async function parse() {
  const text = $('transcript').value.trim();
  if (!text) { $('transcript').focus(); return; }
  $('alert').className = 'alert hidden';
  const btn = $('parseBtn'); btn.disabled = true; btn.textContent = '🤖 Bezig met verwerken…';
  $('results').innerHTML = '';
  $('logBtn').classList.add('hidden');

  let data;
  try {
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/parse-meals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sess.session.access_token}` },
      body: JSON.stringify({ transcript: text }),
    });
    data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || ('status ' + res.status));
  } catch (e) {
    btn.disabled = false; btn.textContent = '✨ Verwerk met AI';
    showAlert('Mislukt: ' + String(e.message || e), true);
    return;
  }
  btn.disabled = false; btn.textContent = '✨ Verwerk met AI';

  // Platte lijst met (meal, item), alleen geldige eetmomenten.
  parsed = [];
  (data.meals || []).forEach(m => {
    const meal = MEAL_KEYS.includes(m.meal) ? m.meal : 'snack';
    (m.items || []).forEach(it => { if (it && it.name) parsed.push({ meal, item: it }); });
  });

  if (!parsed.length) { showAlert('Geen items herkend. Probeer wat duidelijker te beschrijven.', true); return; }
  renderPreview();
}

function renderPreview() {
  const byMeal = {};
  parsed.forEach((p, i) => { (byMeal[p.meal] = byMeal[p.meal] || []).push({ ...p, i }); });

  let html = '';
  MEAL_KEYS.forEach(meal => {
    const rows = byMeal[meal];
    if (!rows || !rows.length) return;
    html += `<div class="card"><div class="card-title">${MEAL_LABELS[meal]}</div>`;
    rows.forEach(({ item, i }) => {
      const g = item.amount_g != null ? `${Math.round(item.amount_g)} g · ` : '';
      const kcal = item.kcal != null ? `${Math.round(item.kcal)} kcal` : '';
      html += `<label class="ai-item">
        <input type="checkbox" class="ai-check" data-idx="${i}" checked>
        <span class="ai-main"><span class="ai-name">${escapeHtml(item.name)}</span><span class="ai-meta">${g}${kcal}</span></span>
      </label>`;
    });
    html += `</div>`;
  });
  $('results').innerHTML = html;
  $('logBtn').classList.remove('hidden');
}

async function logAll() {
  const checks = [...document.querySelectorAll('.ai-check:checked')];
  if (!checks.length) { showAlert('Vink minstens één item aan.', true); return; }
  const logDate = $('logDate').value || isoToday();

  const rows = checks.map(c => {
    const { meal, item } = parsed[Number(c.dataset.idx)];
    return {
      user_id: userId, log_date: logDate, meal_type: meal,
      source: 'ai', name: item.name, brand: null,
      amount_g: item.amount_g != null ? Math.round(item.amount_g) : 0, qty: 1,
      kcal: Math.round(num(item.kcal)),
      protein: +num(item.protein).toFixed(1),
      carbs: +num(item.carbs).toFixed(1),
      sugar: +num(item.sugar).toFixed(1),
      fat: +num(item.fat).toFixed(1),
    };
  });

  const btn = $('logBtn'); btn.disabled = true; btn.textContent = 'Toevoegen…';
  const { error } = await supabase.from('food_log').insert(rows);
  if (error) { btn.disabled = false; btn.textContent = 'Toevoegen aan dagboek'; showAlert('Opslaan mislukt: ' + error.message, true); return; }
  location.href = `dashboard.html?date=${logDate}`;
}

/* ---------- Inspreken (browser-spraakherkenning, geen AI-credits) ---------- */
function initRecording() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;                      // niet ondersteund → knop blijft verborgen
  const btn = $('recBtn');
  btn.style.display = '';
  let rec = null, recording = false, baseText = '';

  btn.onclick = () => {
    if (recording) { recording = false; rec && rec.stop(); return; }
    rec = new SR();
    rec.lang = 'nl-NL'; rec.continuous = true; rec.interimResults = true;
    baseText = $('transcript').value.trim();
    if (baseText) baseText += ' ';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) baseText += t + ' ';
        else interim += t;
      }
      $('transcript').value = (baseText + interim).trimStart();
    };
    rec.onend = () => {
      if (recording) { try { rec.start(); } catch (_e) { /* opnieuw starten na stilte */ } }
      else { btn.textContent = '🎙️ Inspreken'; }
    };
    rec.onerror = (e) => { if (e.error === 'not-allowed') { recording = false; showAlert('Geen toegang tot de microfoon.', true); } };
    recording = true;
    btn.textContent = '⏹ Stop opname';
    try { rec.start(); } catch (_e) { recording = false; }
  };
}

(async function init() {
  const session = await requireAuth();
  if (!session) return;
  userId = session.user.id;
  $('logDate').value = isoToday();
  $('logDate').max = isoToday();
  $('parseBtn').onclick = parse;
  $('logBtn').onclick = logAll;
  initRecording();
  if (window.hideLoader) hideLoader();
})();
