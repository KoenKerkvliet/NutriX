/* ============================================
   BRIGHTLY - Loggen (zoeken, scannen, toevoegen)
   ============================================ */

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const MEAL_OPTIONS = [
  ['ontbijt', 'Ontbijt'], ['lunch', 'Lunch'], ['diner', 'Diner'],
  ['snack', 'Tussendoor'], ['drinken', 'Drinken'],
];

let userId = null;
let selectedMeal = params.get('meal') || 'ontbijt';
let logDate = params.get('date') || isoToday();
let current = null;        // huidig product in het sheet
let searchTimer = null;

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Zoeken ---------- */
async function searchCustom(term) {
  let q = supabase.from('custom_products').select('*').order('created_at', { ascending: false }).limit(15);
  // hoofdletter-ongevoelig zoeken op naam OF merk
  if (term) q = q.or(`name.ilike.%${term}%,brand.ilike.%${term}%`);
  const { data } = await q;
  return (data || []).map(p => ({
    source: 'custom', ref: p.id, name: p.name, brand: p.brand,
    kcal_per_100: Number(p.kcal_per_100), protein_per_100: Number(p.protein_per_100) || 0,
    carbs_per_100: Number(p.carbs_per_100) || 0, fat_per_100: Number(p.fat_per_100) || 0,
    default_serving_g: p.default_serving_g ? Number(p.default_serving_g) : null,
  }));
}

async function doSearch(term) {
  const list = $('results');
  list.innerHTML = '<div class="loader">Zoeken…</div>';
  try {
    const custom = await searchCustom(term);
    let off = [];
    if (term && term.length >= 2) {
      try { off = await searchOff(term); } catch (e) { /* OFF even niet bereikbaar */ }
    }
    renderResults(custom, off, term);
  } catch (e) {
    list.innerHTML = `<div class="loader">Er ging iets mis bij het zoeken.</div>`;
  }
}

function renderResults(custom, off, term) {
  const list = $('results');
  const FOOD_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4V7Z"/><path d="m3 7 9 4 9-4M12 11v10"/></svg>';
  const card = (p, tag) => `
    <div class="list-item" data-prod='${encodeURIComponent(JSON.stringify(p))}'>
      <div class="meal-icon">${FOOD_ICON}</div>
      <div class="li-main">
        <div class="ttl">${escapeHtml(p.name)}</div>
        <div class="meta">${Math.round(p.kcal_per_100)} kcal/100g${p.brand ? ' · ' + escapeHtml(p.brand) : ''}${tag ? ' · ' + tag : ''}</div>
      </div>
      <span class="meal-add">+</span>
    </div>`;

  let html = '';
  if (custom.length) html += `<div class="card-title" style="margin:14px 4px 6px;">Mijn producten</div>` + custom.map(p => card(p, 'eigen')).join('');
  if (off.length)    html += `<div class="card-title" style="margin:14px 4px 6px;">Open Food Facts</div>` + off.map(p => card(p)).join('');
  if (!custom.length && !off.length) {
    html = `<div class="loader">Geen producten gevonden${term ? ` voor "${escapeHtml(term)}"` : ''}.<br>
      <a href="product.html?meal=${selectedMeal}&date=${logDate}">Maak zelf een product aan →</a></div>`;
  }
  list.innerHTML = html;
  list.querySelectorAll('.list-item').forEach(el => {
    el.onclick = () => openSheet(JSON.parse(decodeURIComponent(el.dataset.prod)));
  });
}

/* ---------- Scannen ---------- */
async function handleScan(code) {
  $('results').innerHTML = '<div class="loader">Product opzoeken…</div>';
  // eerst eigen producten, dan Open Food Facts
  const { data: own } = await supabase.from('custom_products').select('*').eq('barcode', code).limit(1);
  if (own && own.length) {
    const p = own[0];
    return openSheet({ source: 'custom', ref: p.id, name: p.name, brand: p.brand,
      kcal_per_100: Number(p.kcal_per_100), protein_per_100: Number(p.protein_per_100) || 0,
      carbs_per_100: Number(p.carbs_per_100) || 0, fat_per_100: Number(p.fat_per_100) || 0,
      default_serving_g: p.default_serving_g ? Number(p.default_serving_g) : null });
  }
  const off = await getOffByBarcode(code);
  if (off) return openSheet(off);
  // niet gevonden → zelf aanmaken met deze barcode
  if (confirm(`Product met streepjescode ${code} niet gevonden. Wil je het zelf aanmaken?`)) {
    location.href = `product.html?barcode=${encodeURIComponent(code)}&meal=${selectedMeal}&date=${logDate}`;
  } else {
    $('results').innerHTML = '';
  }
}

/* ---------- Hoeveelheid-sheet ---------- */
function openSheet(p) {
  current = p;
  $('sheetTitle').textContent = p.name;
  $('sheetSub').textContent = `${Math.round(p.kcal_per_100)} kcal per 100 g${p.brand ? ' · ' + p.brand : ''}`;
  $('amount').value = p.default_serving_g || 100;

  // maaltijd-chips
  $('mealChips').innerHTML = MEAL_OPTIONS.map(([k, l]) =>
    `<button type="button" class="chip ${k === selectedMeal ? 'active' : ''}" data-meal="${k}">${l}</button>`).join('');
  $('mealChips').querySelectorAll('.chip').forEach(c => c.onclick = () => {
    selectedMeal = c.dataset.meal;
    $('mealChips').querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === c));
  });

  // hoeveelheid-chips
  const presets = [50, 100, 150, 200];
  if (p.default_serving_g) presets.unshift(p.default_serving_g);
  $('amountChips').innerHTML = [...new Set(presets)].map(g =>
    `<button type="button" class="chip" data-g="${g}">${g} g</button>`).join('');
  $('amountChips').querySelectorAll('.chip').forEach(c => c.onclick = () => { $('amount').value = c.dataset.g; updatePreview(); });

  updatePreview();
  $('sheetBackdrop').classList.add('open');
  $('sheet').classList.add('open');
}
function closeSheet() {
  $('sheet').classList.remove('open');
  $('sheetBackdrop').classList.remove('open');
  current = null;
}
function updatePreview() {
  const g = Number($('amount').value) || 0;
  $('kcalPreview').textContent = current ? Math.round(current.kcal_per_100 * g / 100) : 0;
}

async function addToLog() {
  if (!current) return;
  const g = Number($('amount').value);
  if (!g || g <= 0) { alert('Vul een geldige hoeveelheid in.'); return; }
  const f = g / 100;
  const btn = $('addBtn'); btn.disabled = true; btn.textContent = 'Toevoegen…';
  const { error } = await supabase.from('food_log').insert({
    user_id: userId,
    log_date: logDate,
    meal_type: selectedMeal,
    source: current.source,
    source_ref: current.ref ? String(current.ref) : null,
    name: current.name,
    brand: current.brand,
    amount_g: g,
    kcal: Math.round(current.kcal_per_100 * f),
    protein: +(current.protein_per_100 * f).toFixed(1),
    carbs: +(current.carbs_per_100 * f).toFixed(1),
    fat: +(current.fat_per_100 * f).toFixed(1),
  });
  if (error) { alert('Opslaan mislukt: ' + error.message); btn.disabled = false; btn.textContent = 'Toevoegen'; return; }
  location.href = `dashboard.html`;
}

/* ---------- Init ---------- */
(async function init() {
  const session = await requireAuth();
  if (!session) return;
  userId = session.user.id;

  $('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => doSearch(e.target.value.trim()), 350);
  });
  $('scanBtn').onclick = () => startScanner(handleScan);
  $('newProdLink').href = `product.html?meal=${selectedMeal}&date=${logDate}`;
  $('sheetBackdrop').onclick = closeSheet;
  $('sheetClose').onclick = closeSheet;
  $('amount').addEventListener('input', updatePreview);
  $('addBtn').onclick = addToLog;

  doSearch(''); // toon eigen producten als start
})();
