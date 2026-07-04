/* ============================================
   BRIGHTLY - Loggen (zoeken, scannen, toevoegen)
   ============================================ */

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const MEAL_OPTIONS = [
  ['ontbijt', 'Ontbijt'], ['lunch', 'Lunch'], ['diner', 'Diner'],
  ['snack', 'Tussendoor'], ['drinken', 'Drinken'],
];

/** Slim standaard-eetmoment op basis van het tijdstip (als er geen meal in de URL staat). */
function defaultMealForNow() {
  const h = new Date().getHours();
  if (h < 11) return 'ontbijt';
  if (h < 15) return 'lunch';
  if (h < 17) return 'snack';
  if (h < 21) return 'diner';
  return 'snack';
}

let userId = null;
const MEAL_KEYS = ['ontbijt', 'lunch', 'diner', 'snack', 'drinken'];
let selectedMeal = MEAL_KEYS.includes(params.get('meal')) ? params.get('meal') : defaultMealForNow();
let logDate = params.get('date') || isoToday();
let addedCount = 0;        // aantal items dat deze sessie is toegevoegd (voor de Klaar-teller)
let recentAll = [];        // recent gelogde rijen (voor 'Vaak gegeten')
let current = null;        // huidig product in het sheet
let sheetQty = 1;          // aantal porties in het sheet
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
  let q = supabase.from('custom_products').select('*').order('created_at', { ascending: false }).limit(50);
  // hoofdletter-ongevoelig zoeken op naam OF merk
  if (term) q = q.or(`name.ilike.%${term}%,brand.ilike.%${term}%`);
  const { data } = await q;
  return (data || []).map(p => ({
    source: 'custom', ref: p.id, name: p.name, brand: p.brand, category: p.category,
    kcal_per_100: Number(p.kcal_per_100), protein_per_100: Number(p.protein_per_100) || 0,
    carbs_per_100: Number(p.carbs_per_100) || 0, sugar_per_100: Number(p.sugar_per_100) || 0,
    fat_per_100: Number(p.fat_per_100) || 0,
    default_serving_g: p.default_serving_g ? Number(p.default_serving_g) : null,
  }));
}

/** Maaltijd-filterchips: bepalen waar je logt én tonen je geschiedenis voor dat moment. */
function buildMealFilter() {
  const bar = $('mealFilter');
  bar.innerHTML = MEAL_OPTIONS.map(([k, l]) =>
    `<button type="button" class="chip ${k === selectedMeal ? 'active' : ''}" data-meal="${k}">${l}</button>`).join('');
  bar.querySelectorAll('.chip').forEach(c => c.onclick = () => {
    selectedMeal = c.dataset.meal;
    bar.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === c));
    renderRecent($('searchInput').value.trim());   // geschiedenis van het gekozen moment tonen
  });
}

/** Zet de actieve maaltijd-chip gelijk aan selectedMeal (bv. na wijzigen in het sheet). */
function syncMealFilter() {
  $('mealFilter').querySelectorAll('.chip').forEach(x =>
    x.classList.toggle('active', x.dataset.meal === selectedMeal));
}

async function doSearch(term) {
  const list = $('results');
  list.innerHTML = '<div class="loader">Zoeken…</div>';
  renderRecent(term);      // 'Vaak gegeten' alleen tonen zonder zoekterm
  renderFavorites(term);   // favorieten alleen tonen zonder zoekterm
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
      carbs_per_100: Number(p.carbs_per_100) || 0, sugar_per_100: Number(p.sugar_per_100) || 0,
      fat_per_100: Number(p.fat_per_100) || 0,
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
  sheetQty = 1; $('qtyN').textContent = '1';

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
  // Maaltijd kan in de sheet zijn gewijzigd → chips + 'Vaak gegeten' bijwerken.
  syncMealFilter();
  if (!$('searchInput').value.trim()) renderRecent('');
}
function updatePreview() {
  const g = parseNum($('amount').value) || 0;
  $('kcalPreview').textContent = current ? Math.round(current.kcal_per_100 * g / 100 * sheetQty) : 0;
}

async function addToLog() {
  if (!current) return;
  const g = parseNum($('amount').value);
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
    qty: sheetQty,
    kcal: Math.round(current.kcal_per_100 * f),
    protein: +(current.protein_per_100 * f).toFixed(1),
    carbs: +(current.carbs_per_100 * f).toFixed(1),
    sugar: +((current.sugar_per_100 || 0) * f).toFixed(1),
    fat: +(current.fat_per_100 * f).toFixed(1),
  });
  if (error) { alert('Opslaan mislukt: ' + error.message); btn.disabled = false; btn.textContent = 'Toevoegen'; return; }
  btn.disabled = false; btn.textContent = 'Toevoegen';
  const addedKcal = current.kcal_per_100 * f * sheetQty;
  const addedName = current.name;
  closeSheet();
  afterAdd(addedName, addedKcal);
  await loadRecent();          // 'Vaak gegeten' bijwerken met wat je net logde
  renderRecent($('searchInput').value.trim());
}

/* ---------- Toast + Klaar-teller (op de pagina blijven bij toevoegen) ---------- */
let toastTimer = null;
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1900);
}

/** Registreer een toevoeging: teller ophogen, Klaar-knop bijwerken, toast tonen. */
function afterAdd(name, kcal) {
  addedCount++;
  const done = $('doneBtn');
  if (done) done.textContent = `Klaar (${addedCount})`;
  toast(`✓ ${name} toegevoegd · ${Math.round(kcal)} kcal`);
}

/* ---------- Recent & vaak gegeten ---------- */
async function loadRecent() {
  const { data } = await supabase.from('food_log')
    .select('*').order('logged_at', { ascending: false }).limit(400);
  recentAll = data || [];
}

/** Meest gelogde items voor dít eetmoment (gededupliceerd; nieuwste portie wint). */
function recentForMeal(meal) {
  const seen = new Map();  // key -> { row, count }  (rijen staan nieuw→oud)
  for (const r of recentAll) {
    if (r.meal_type !== meal) continue;
    const key = r.source_ref ? `${r.source}:${r.source_ref}` : `n:${(r.name || '').toLowerCase()}`;
    if (seen.has(key)) seen.get(key).count++;
    else seen.set(key, { row: r, count: 1 });
  }
  return [...seen.values()].sort((a, b) => b.count - a.count).slice(0, 25);
}

function renderRecent(term) {
  const box = $('recent');
  if (term) { box.innerHTML = ''; return; }
  const mealLabel = MEAL_OPTIONS.find(m => m[0] === selectedMeal)[1];
  const rows = recentForMeal(selectedMeal);
  if (!rows.length) {
    box.innerHTML = `<div class="loader" style="padding:18px 4px;">Nog niets gelogd voor ${mealLabel.toLowerCase()}.<br>Zoek hierboven een product om toe te voegen.</div>`;
    return;
  }
  const CLOCK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  box.innerHTML = `<div class="card-title" style="margin:14px 4px 6px;">Vaak gegeten · ${mealLabel}</div>` +
    rows.map(({ row }, idx) => {
      const q = row.qty || 1;
      const g = Math.round(Number(row.amount_g) || 0);
      const kcal = Math.round(Number(row.kcal || 0) * q);
      const meta = g > 0 ? `${g} g${q > 1 ? ` × ${q}` : ''}` : 'snelle invoer';
      const editable = g > 0 && row.source !== 'quick';
      return `
      <div class="list-item recent" data-idx="${idx}">
        <div class="meal-icon">${CLOCK}</div>
        <div class="li-main">
          <div class="ttl">${escapeHtml(row.name)}</div>
          <div class="meta">${kcal} kcal · ${meta}${row.brand ? ' · ' + escapeHtml(row.brand) : ''}</div>
        </div>
        ${editable ? '<button class="mini-edit" data-edit="' + idx + '" type="button" aria-label="Aanpassen">✎</button>' : ''}
        <span class="meal-add">+</span>
      </div>`;
    }).join('');

  const list = rows.map(r => r.row);
  box.querySelectorAll('.list-item').forEach(el => {
    el.onclick = () => quickAddRecent(list[Number(el.dataset.idx)]);
  });
  box.querySelectorAll('.mini-edit').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    openSheetFromRow(list[Number(b.dataset.edit)]);
  });
}

/** Log een recent item direct opnieuw (zelfde hoeveelheid als de vorige keer). */
async function quickAddRecent(row) {
  const { error } = await supabase.from('food_log').insert({
    user_id: userId, log_date: logDate, meal_type: selectedMeal,
    source: row.source, source_ref: row.source_ref || null,
    name: row.name, brand: row.brand || null,
    amount_g: Number(row.amount_g) || 0, qty: row.qty || 1,
    kcal: Math.round(Number(row.kcal) || 0),
    protein: Number(row.protein) || 0, carbs: Number(row.carbs) || 0,
    sugar: Number(row.sugar) || 0, fat: Number(row.fat) || 0,
  });
  if (error) { toast('Opslaan mislukt'); return; }
  afterAdd(row.name, Number(row.kcal || 0) * (row.qty || 1));
}

/** Open de hoeveelheid-sheet met een recent item, om de portie aan te passen. */
function openSheetFromRow(row) {
  const g = Number(row.amount_g) || 100;
  const per100 = (v) => +((Number(v) || 0) / g * 100).toFixed(2);
  openSheet({
    source: row.source, ref: row.source_ref || null,
    name: row.name, brand: row.brand || null,
    kcal_per_100: per100(row.kcal), protein_per_100: per100(row.protein),
    carbs_per_100: per100(row.carbs), sugar_per_100: per100(row.sugar),
    fat_per_100: per100(row.fat), default_serving_g: g,
  });
}

/* ---------- Favorieten / standaardmaaltijden ---------- */
let favorites = [];        // geladen favorieten
let currentFav = null;     // favoriet in het apply-sheet

async function loadFavorites() {
  const { data } = await supabase.from('favorite_meals')
    .select('*').order('created_at', { ascending: false });
  favorites = data || [];
}

/** Toon de favorieten-sectie; alleen als er geen zoekterm actief is. */
function renderFavorites(term) {
  const box = $('favorites');
  if (term || !favorites.length) { box.innerHTML = ''; return; }
  const STAR = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L3.3 9.4l6-.9z"/></svg>';
  box.innerHTML = `<div class="card-title" style="margin:14px 4px 6px;">Mijn maaltijden</div>` +
    favorites.map(f => {
      const items = Array.isArray(f.items) ? f.items : [];
      const kcal = Math.round(items.reduce((a, i) => a + Number(i.kcal || 0) * (i.qty || 1), 0));
      const names = items.map(i => i.name).join(', ');
      return `
      <div class="list-item" data-fav="${f.id}">
        <div class="meal-icon">${STAR}</div>
        <div class="li-main">
          <div class="ttl">${escapeHtml(f.name)}</div>
          <div class="meta">${kcal} kcal · ${escapeHtml(names || 'leeg')}</div>
        </div>
        <span class="meal-add">+</span>
      </div>`;
    }).join('');
  box.querySelectorAll('.list-item').forEach(el => {
    el.onclick = () => openFav(favorites.find(f => f.id === el.dataset.fav));
  });
}

function openFav(fav) {
  if (!fav) return;
  currentFav = fav;
  const items = Array.isArray(fav.items) ? fav.items : [];
  const kcal = Math.round(items.reduce((a, i) => a + Number(i.kcal || 0) * (i.qty || 1), 0));
  $('favTitle').textContent = fav.name;
  $('favSub').textContent = `${items.length} ${items.length === 1 ? 'product' : 'producten'}`;
  $('favKcal').textContent = kcal;
  $('favItems').innerHTML = items.map(i => {
    const q = i.qty || 1;
    const g = Math.round(Number(i.amount_g) || 0);
    const meta = g > 0 ? `${g} g${q > 1 ? ` × ${q}` : ''}` : 'snelle invoer';
    return `<div class="flex-between" style="padding:4px 2px;font-size:.9rem;">
      <span>${escapeHtml(i.name)}<span style="color:var(--ink-faint);"> · ${meta}</span></span>
      <span style="color:var(--ink-faint);">${Math.round(Number(i.kcal || 0) * q)} kcal</span>
    </div>`;
  }).join('') || '<div class="sub">Deze favoriet is leeg.</div>';

  $('favMealChips').innerHTML = MEAL_OPTIONS.map(([k, l]) =>
    `<button type="button" class="chip ${k === selectedMeal ? 'active' : ''}" data-meal="${k}">${l}</button>`).join('');
  $('favMealChips').querySelectorAll('.chip').forEach(c => c.onclick = () => {
    selectedMeal = c.dataset.meal;
    $('favMealChips').querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === c));
  });

  $('favBackdrop').classList.add('open');
  $('favSheet').classList.add('open');
}
function closeFav() {
  $('favSheet').classList.remove('open');
  $('favBackdrop').classList.remove('open');
  currentFav = null;
}

async function addFav() {
  if (!currentFav) return;
  const items = Array.isArray(currentFav.items) ? currentFav.items : [];
  if (!items.length) { alert('Deze favoriet is leeg.'); return; }
  const btn = $('favAddBtn'); btn.disabled = true; btn.textContent = 'Toevoegen…';
  const rows = items.map(i => ({
    user_id: userId, log_date: logDate, meal_type: selectedMeal,
    source: i.source || 'custom', source_ref: i.source_ref || null,
    name: i.name, brand: i.brand || null,
    amount_g: Number(i.amount_g) || 0, qty: i.qty || 1,
    kcal: Math.round(Number(i.kcal) || 0),
    protein: +(Number(i.protein) || 0).toFixed(1),
    carbs: +(Number(i.carbs) || 0).toFixed(1),
    sugar: +(Number(i.sugar) || 0).toFixed(1),
    fat: +(Number(i.fat) || 0).toFixed(1),
  }));
  const { error } = await supabase.from('food_log').insert(rows);
  if (error) { alert('Opslaan mislukt: ' + error.message); btn.disabled = false; btn.textContent = 'Toevoegen aan dag'; return; }
  location.href = `maaltijd.html?meal=${selectedMeal}&date=${logDate}`;
}

async function deleteFav() {
  if (!currentFav) return;
  if (!confirm(`Favoriet "${currentFav.name}" verwijderen?`)) return;
  await supabase.from('favorite_meals').delete().eq('id', currentFav.id);
  closeFav();
  await loadFavorites();
  renderFavorites($('searchInput').value.trim());
}

/* ---------- Snelle calorieën (alleen kcal, geen producten) ---------- */
function openQuick() {
  $('quickKcal').value = '';
  $('quickName').value = '';
  $('quickMealChips').innerHTML = MEAL_OPTIONS.map(([k, l]) =>
    `<button type="button" class="chip ${k === selectedMeal ? 'active' : ''}" data-meal="${k}">${l}</button>`).join('');
  $('quickMealChips').querySelectorAll('.chip').forEach(c => c.onclick = () => {
    selectedMeal = c.dataset.meal;
    $('quickMealChips').querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === c));
  });
  $('quickBackdrop').classList.add('open');
  $('quickSheet').classList.add('open');
  setTimeout(() => $('quickKcal').focus(), 50);
}
function closeQuick() {
  $('quickSheet').classList.remove('open');
  $('quickBackdrop').classList.remove('open');
}
async function addQuick() {
  const kcal = Math.round(parseNum($('quickKcal').value));
  if (!kcal || kcal <= 0) { alert('Vul een geldig aantal calorieën in.'); return; }
  const name = $('quickName').value.trim() || 'Snelle invoer';
  const btn = $('quickAddBtn'); btn.disabled = true; btn.textContent = 'Toevoegen…';
  const { error } = await supabase.from('food_log').insert({
    user_id: userId, log_date: logDate, meal_type: selectedMeal,
    source: 'quick', source_ref: null, name, brand: null,
    amount_g: 0, qty: 1, kcal, protein: 0, carbs: 0, sugar: 0, fat: 0,
  });
  if (error) { alert('Opslaan mislukt: ' + error.message); btn.disabled = false; btn.textContent = 'Toevoegen'; return; }
  btn.disabled = false; btn.textContent = 'Toevoegen';
  closeQuick();
  afterAdd(name, kcal);
  await loadRecent();
  renderRecent($('searchInput').value.trim());
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
  $('qtyInc').onclick = () => { sheetQty++; $('qtyN').textContent = sheetQty; updatePreview(); };
  $('qtyDec').onclick = () => { if (sheetQty > 1) { sheetQty--; $('qtyN').textContent = sheetQty; updatePreview(); } };
  $('addBtn').onclick = addToLog;
  $('quickKcalBtn').onclick = openQuick;
  $('quickBackdrop').onclick = closeQuick;
  $('quickClose').onclick = closeQuick;
  $('quickAddBtn').onclick = addQuick;
  $('favBackdrop').onclick = closeFav;
  $('favClose').onclick = closeFav;
  $('favAddBtn').onclick = addFav;
  $('favDelBtn').onclick = deleteFav;

  $('doneBtn').href = `dashboard.html?date=${logDate}`;

  buildMealFilter();             // maaltijd-filterchips (Ontbijt/Lunch/…)
  await Promise.all([loadFavorites(), loadRecent()]);  // favorieten + 'Vaak gegeten'
  if (window.hideLoader) hideLoader();
  doSearch(''); // toon 'Vaak gegeten' + favorieten + eigen producten als start
})();
