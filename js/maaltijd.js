/* ============================================
   BRIGHTLY - Maaltijd-detailpagina
   Toont wat je bij dit eetmoment hebt gegeten; toevoegen + terug naar dashboard.
   ============================================ */

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let profile = null;   // voor de maaltijd-streefwaarde
let userId = null;

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

let currentItems = [];   // laatst geladen items van dit eetmoment

async function load() {
  const { data } = await supabase
    .from('food_log')
    .select('*')
    .eq('log_date', dateStr)
    .eq('meal_type', mealKey)
    .order('logged_at', { ascending: true });
  currentItems = data || [];
  return currentItems;
}

/** Bewaar de huidige items van dit eetmoment als een favoriete maaltijd. */
async function saveFavorite() {
  if (!currentItems.length) return;
  const suggested = MEAL_LABELS[mealKey];
  const name = (prompt('Naam voor deze favoriete maaltijd:', suggested) || '').trim();
  if (!name) return;
  const items = currentItems.map(i => ({
    name: i.name, brand: i.brand || null,
    source: i.source, source_ref: i.source_ref || null,
    amount_g: Number(i.amount_g) || 0, qty: i.qty || 1,
    kcal: Number(i.kcal) || 0,
    protein: Number(i.protein) || 0, carbs: Number(i.carbs) || 0,
    fat: Number(i.fat) || 0, sugar: Number(i.sugar) || 0,
  }));
  const btn = $('favSaveBtn'); btn.disabled = true; btn.textContent = 'Opslaan…';
  const { data: sess } = await supabase.auth.getUser();
  const { error } = await supabase.from('favorite_meals').insert({
    user_id: sess?.user?.id, name, items,
  });
  btn.disabled = false; btn.textContent = '⭐ Opslaan als favoriet';
  if (error) { alert('Opslaan mislukt: ' + error.message); return; }
  alert(`"${name}" is opgeslagen. Je vindt 'm terug bij Zoeken → Mijn maaltijden.`);
}

function render(items) {
  $('mealTitle').textContent = MEAL_LABELS[mealKey];
  $('favSaveBtn').style.display = items.length ? '' : 'none';

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

  const eaten = Math.round(tot.kcal);
  const target = mealTarget(profile, mealKey);
  $('mealSub').textContent = `${dateLabel()} · ${eaten} / ${target} kcal`;
  $('stKcal').textContent = `${eaten} / ${target}`;
  // Kleur de kcal-stat: groen onder de streefwaarde, oranje eroverheen, neutraal bij leeg.
  $('stKcal').style.color = items.length ? (eaten <= target ? 'var(--green)' : 'var(--orange)') : '';
  $('stCarb').textContent = `${Math.round(tot.carbs)} g`;
  $('stProtein').textContent = `${Math.round(tot.protein)} g`;
  $('stFat').textContent = `${Math.round(tot.fat)} g`;

  const wrap = $('items');
  if (!items.length) {
    wrap.innerHTML = `<div class="card" style="text-align:center;color:var(--ink-faint);">
      Nog niets gelogd voor ${MEAL_LABELS[mealKey].toLowerCase()}.
      <div style="margin-top:12px;"><button class="btn btn-ghost btn-sm repeat-yesterday" id="repeatBtn" type="button">↺ Zelfde als gisteren</button></div>
    </div>`;
    $('repeatBtn').onclick = copyYesterday;
    return;
  }

  wrap.innerHTML = '<div class="meal">' + items.map(i => {
    const q = i.qty || 1;
    const grams = Math.round(Number(i.amount_g) * q);
    const kcal = Math.round(Number(i.kcal) * q);
    const metaLeft = grams > 0 ? `${grams} g` : 'snelle invoer';
    return `
      <div class="meal-item" data-id="${i.id}">
        <div class="mi-main">${escapeHtml(i.name)}<div class="meta">${metaLeft}${i.brand ? ' · ' + escapeHtml(i.brand) : ''}</div></div>
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

/** Kopieer de items van dit eetmoment van de dag ervoor naar de huidige dag. */
async function copyYesterday() {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const p = new Date(y, mo - 1, d - 1);
  const prevStr = `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}-${String(p.getDate()).padStart(2, '0')}`;
  const btn = $('repeatBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Bezig…'; }
  const { data } = await supabase.from('food_log').select('*')
    .eq('log_date', prevStr).eq('meal_type', mealKey);
  if (!data || !data.length) {
    if (btn) { btn.disabled = false; btn.textContent = '↺ Zelfde als gisteren'; }
    alert(`Gisteren was er niets gelogd voor ${MEAL_LABELS[mealKey].toLowerCase()}.`);
    return;
  }
  const rows = data.map(i => ({
    user_id: userId, log_date: dateStr, meal_type: mealKey,
    source: i.source, source_ref: i.source_ref || null,
    name: i.name, brand: i.brand || null,
    amount_g: Number(i.amount_g) || 0, qty: i.qty || 1,
    kcal: Number(i.kcal) || 0, protein: Number(i.protein) || 0,
    carbs: Number(i.carbs) || 0, sugar: Number(i.sugar) || 0, fat: Number(i.fat) || 0,
  }));
  const { error } = await supabase.from('food_log').insert(rows);
  if (error) { alert('Kopiëren mislukt: ' + error.message); return; }
  refresh();
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
  userId = session.user.id;
  $('backLink').href = `dashboard.html?date=${dateStr}`;
  $('addBtn').href = `loggen.html?meal=${mealKey}&date=${dateStr}`;
  $('favSaveBtn').onclick = saveFavorite;
  const { data } = await supabase.from('profiles').select('daily_kcal_goal,meal_pct_ontbijt,meal_pct_lunch,meal_pct_diner,meal_pct_snack,meal_pct_drinken').single();
  profile = data || null;
  await refresh();
  if (window.hideLoader) hideLoader();
})();
