/* ============================================
   BRIGHTLY - Gewicht bijhouden + grafiek
   ============================================ */

const $ = (id) => document.getElementById(id);
let userId = null;

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dmy(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

async function loadEntries() {
  const { data } = await supabase
    .from('weight_log')
    .select('*')
    .order('log_date', { ascending: true })
    .limit(90);
  return data || [];
}

function renderChart(entries) {
  const box = $('chart');
  const pts = entries.slice(-30);
  if (pts.length < 2) { box.innerHTML = '<div class="muted center" style="padding:24px 0;">Log minimaal 2 dagen voor een grafiek.</div>'; return; }

  const W = 320, H = 140, pad = 22;
  const weights = pts.map(p => Number(p.weight_kg));
  const min = Math.min(...weights), max = Math.max(...weights);
  const range = (max - min) || 1;
  const x = i => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const y = w => pad + (1 - (w - min) / range) * (H - pad * 2);

  const line = weights.map((w, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(w).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  const dots = weights.map((w, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(w).toFixed(1)}" r="2.5" fill="#2FA45F"/>`).join('');

  box.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">
      <path d="${area}" fill="#EBF6EF"/>
      <path d="${line}" fill="none" stroke="#2FA45F" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
      <text x="${pad}" y="14" font-size="10" fill="#A29D8F">${max.toFixed(1)} kg</text>
      <text x="${pad}" y="${H - 6}" font-size="10" fill="#A29D8F">${min.toFixed(1)} kg</text>
    </svg>`;
}

function renderList(entries) {
  const recent = [...entries].reverse().slice(0, 14);
  $('list').innerHTML = recent.length
    ? recent.map(e => `
        <div class="meal-item">
          <div>${dmy(e.log_date)}</div>
          <div><b>${Number(e.weight_kg).toFixed(1)} kg</b></div>
        </div>`).join('')
    : '<div class="meal-empty">Nog geen gewicht gelogd.</div>';
}

async function refresh() {
  const entries = await loadEntries();
  renderChart(entries);
  renderList(entries);
  const dEl = $('heroDelta');
  if (entries.length) {
    const last = entries[entries.length - 1];
    $('heroWeight').textContent = Number(last.weight_kg).toFixed(1);
    const prev = entries[entries.length - 2];
    if (prev) {
      const d = Number(last.weight_kg) - Number(prev.weight_kg);
      const abs = Math.abs(d).toFixed(1);
      if (Math.abs(d) < 0.05) { dEl.textContent = 'gelijk'; dEl.className = 'wh-delta flat'; }
      else if (d < 0)         { dEl.textContent = `▼ ${abs} kg`; dEl.className = 'wh-delta down'; }
      else                    { dEl.textContent = `▲ ${abs} kg`; dEl.className = 'wh-delta up'; }
    } else { dEl.textContent = ''; dEl.className = 'wh-delta'; }
  } else {
    $('heroWeight').textContent = '—';
    dEl.textContent = '';
  }
}

async function save(e) {
  e.preventDefault();
  const w = parseNum($('weight').value);
  const date = $('date').value || isoToday();
  if (!w || w <= 0) { alert('Vul een geldig gewicht in.'); return; }
  const btn = $('saveBtn'); btn.disabled = true; btn.textContent = 'Opslaan…';
  const { error } = await supabase.from('weight_log')
    .upsert({ user_id: userId, log_date: date, weight_kg: w }, { onConflict: 'user_id,log_date' });
  btn.disabled = false; btn.textContent = 'Opslaan';
  if (error) { alert('Opslaan mislukt: ' + error.message); return; }
  $('weight').value = '';
  refresh();
}

(async function init() {
  const session = await requireAuth();
  if (!session) return;
  userId = session.user.id;
  $('date').value = isoToday();
  $('date').max = isoToday();
  $('weightForm').addEventListener('submit', save);
  refresh();
})();
