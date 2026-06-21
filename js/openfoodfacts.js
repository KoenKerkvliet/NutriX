/* ============================================
   NUTRIX - Open Food Facts API-wrapper
   Geeft producten terug in een uniforme vorm:
   { source:'off', ref, name, brand, kcal_per_100,
     protein_per_100, carbs_per_100, fat_per_100,
     default_serving_g, image }
   ============================================ */

const OFF_BASE = 'https://world.openfoodfacts.org';
const OFF_FIELDS = 'code,product_name,product_name_nl,brands,nutriments,serving_quantity,image_small_url';

function offEnergyKcal(n) {
  if (!n) return null;
  if (n['energy-kcal_100g'] != null) return Number(n['energy-kcal_100g']);
  if (n['energy_100g'] != null) return Math.round(Number(n['energy_100g']) / 4.184); // kJ -> kcal
  return null;
}

function normalizeOff(p) {
  const n = p.nutriments || {};
  const kcal = offEnergyKcal(n);
  if (kcal == null) return null; // zonder calorieën heeft loggen geen zin
  return {
    source: 'off',
    ref: p.code || null,
    name: (p.product_name_nl || p.product_name || '').trim() || 'Onbekend product',
    brand: (p.brands || '').split(',')[0].trim() || null,
    kcal_per_100: kcal,
    protein_per_100: Number(n.proteins_100g) || 0,
    carbs_per_100: Number(n.carbohydrates_100g) || 0,
    fat_per_100: Number(n.fat_100g) || 0,
    default_serving_g: p.serving_quantity ? Number(p.serving_quantity) : null,
    image: p.image_small_url || null,
  };
}

/** Zoek producten op tekst. Geeft een array genormaliseerde producten terug. */
async function searchOff(term, pageSize = 25) {
  const url = `${OFF_BASE}/cgi/search.pl?search_terms=${encodeURIComponent(term)}`
    + `&search_simple=1&action=process&json=1&lc=nl&page_size=${pageSize}&fields=${OFF_FIELDS}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('Open Food Facts is niet bereikbaar.');
  const data = await res.json();
  return (data.products || []).map(normalizeOff).filter(Boolean);
}

/** Zoek één product op barcode. Geeft genormaliseerd product of null. */
async function getOffByBarcode(code) {
  const url = `${OFF_BASE}/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;
  return normalizeOff({ ...data.product, code });
}
