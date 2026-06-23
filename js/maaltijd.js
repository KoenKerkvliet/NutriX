/* ============================================
   BRIGHTLY - Maaltijd-detailpagina
   Toont wat je bij dit eetmoment hebt gegeten; toevoegen + terug naar dashboard.
   ============================================ */

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const MEAL_LABELS = {
  ontbijt: 'Ontbijt', lunch: 'Lunch', diner: 'Diner', snack: 'Tussendoor', drinken: 'Drinken',
};

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const mealKey = MEAL_LABELS[params.get('meal')] ? params.get('meal') : 'ontbijt';
const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : isoToday();

/** Nederlandse datumlabel: Vandaag / Gisteren / volledige datum. */
function dateLabel() {
  const today = isoToday();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  if (dateStr === today) return 'Vandaag';
  if (dateStr === yStr) return 'Gisteren';
  const [yr, mo, da] = dateStr.split('-').map(Number);
  return new Date(yr, mo - 1, da).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
}

async function load() {
  const { data } = await supabase
    .from('food_log')
    .select('*')
    .eq('log_date', dateStr)
    .eq('meal_type', mealKey)
    .order('logged_at', { ascending: true });
  return data || [];
}

function render(items) {
  $('mealTitle').textContent = MEAL_LABELS[mealKey];

  // Snelle stats: totalen voor dit eetmoment (× aantal porties)
  const tot = items.reduce((a, i) => {
    const q = i.qty || 1;
    return {
      kcal: a.kcal + Number(i.kcal || 0) * q,
      carbs: a.carbs + Number(i.carbs || 0) * q,
      protein: a.protein + Number(i.protein || 0) * q,
      fat: a.fat + Number(i.fat || 0) * q,
    };
  }, { kcal: 0, carbs: 0, protein: 0, fat: 0 });

  $('mealSub').textContent = `${dateLabel()} · ${Math.round(tot.kcal)} kcal`;
  $('stKcal').textContent = Math.round(tot.kcal);
  $('stCarb').textContent = `${Math.round(tot.carbs)} g`;
  $('stProtein').textContent = `${Math.round(tot.protein)} g`;
  $('stFat').textContent = `${Math.round(tot.fat)} g`;

  const wrap = $('items');
  if (!items.length) {
    wrap.innerHTML = `<div class="card" style="text-align:center;color:var(--ink-faint);">
      Nog niets gelogd voor ${MEAL_LABELS[mealKey].toLowerCase()}.</div>`;
    return;
  }

  wrap.innerHTML = '<div class="meal">' + items.map(i => {
    const q = i.qty || 1;
    const grams = Math.round(Number(i.amount_g) * q);
    const kcal = Math.round(Number(i.kcal) * q);
    return `
      <div class="meal-item" data-id="${i.id}">
        <div class="mi-main">${escapeHtml(i.name)}<div class="meta">${grams} g${i.brand ? ' · ' + escapeHtml(i.brand) : ''}</div></div>
        <div class="qty">
          <button class="qty-btn" data-id="${i.id}" data-act="dec" aria-label="Minder">−</button>
          <span class="qty-n">${q}</span>
          <button class="qty-btn" data-id="${i.id}" data-act="inc" aria-label="Meer">+</button>
        </div>
        <div class="mi-kcal">${kcal} kcal</div>
        <button class="mi-del" data-id="${i.id}" aria-label="Verwijderen">✕</button>
      </div>`;
  }).join('') + '</div>';

  wrap.querySelectorAll('.qty-btn').forEach(b => b.onclick = () => changeQty(b.dataset.id, b.dataset.act === 'inc' ? 1 : -1));
  wrap.querySelectorAll('.mi-del').forEach(b => b.onclick = () => removeItem(b.dataset.id));
}

async function changeQty(id, delta) {
  const span = document.querySelector(`.meal-item[data-id="${id}"] .qty-n`);
  const q = Math.max(1, (parseInt(span?.textContent) || 1) + delta);
  await supabase.from('food_log').update({ qty: q }).eq('id', id);
  refresh();
}

async function removeItem(id) {
  await supabase.from('food_log').delete().eq('id', id);
  refresh();
}

async function refresh() {
  render(await load());
}

(async function init() {
  const session = await requireAuth();
  if (!session) return;
  $('backLink').href = `dashboard.html?date=${dateStr}`;
  $('addBtn').href = `loggen.html?meal=${mealKey}&date=${dateStr}`;
  await refresh();
})();
