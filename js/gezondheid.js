/* ============================================
   BRIGHTLY - Gezondheid (slaap & herstel)
   ============================================ */

const $ = (id) => document.getElementById(id);
const DOW = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function hm(min) {
  const m = Math.round(min);
  return `${Math.floor(m / 60)}u ${String(m % 60).padStart(2, '0')}m`;
}

async function load() {
  const dates = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); dates.push(isoDate(d)); }
  const { data } = await supabase.from('sleep_log')
    .select('log_date,duration_min,score').gte('log_date', dates[0]).order('log_date', { ascending: true });
  const map = {};
  (data || []).forEach(r => { map[r.log_date] = r; });
  render(dates, map);
}

function render(dates, map) {
  const durs = dates.map(d => (map[d] && map[d].duration_min) || 0);
  const max = Math.max(...durs, 480); // schaal op minimaal 8 uur

  $('sleepChart').innerHTML = dates.map(d => {
    const min = (map[d] && map[d].duration_min) || 0;
    const h = max ? Math.round(min / max * 100) : 0;
    const wd = DOW[new Date(`${d}T00:00:00`).getDay()];
    const label = min ? `${Math.floor(min / 60)}u${String(min % 60).padStart(2, '0')}` : '–';
    return `<div class="slb">
      <div class="slb-h">${label}</div>
      <div class="slb-bar"><div class="slb-fill" style="height:${h}%"></div></div>
      <div class="slb-d">${wd}</div>
    </div>`;
  }).join('');

  const logged = durs.filter(x => x > 0);
  const avg = logged.length ? Math.round(logged.reduce((a, b) => a + b, 0) / logged.length) : 0;
  $('sleepAvg').textContent = avg
    ? `Gemiddeld ${hm(avg)} per nacht (${logged.length} ${logged.length === 1 ? 'nacht' : 'nachten'}).`
    : 'Nog geen slaapdata. Koppel Fitbit opnieuw en geef toestemming voor slaap (op de Activiteit-pagina).';
}

(async function init() {
  const session = await requireAuth();
  if (!session) return;
  await load();
})();
