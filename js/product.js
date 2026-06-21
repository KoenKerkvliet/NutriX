/* ============================================
   BRIGHTLY - Eigen product aanmaken
   ============================================ */

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let userId = null;

(async function init() {
  const session = await requireAuth();
  if (!session) return;
  userId = session.user.id;

  const bc = params.get('barcode');
  if (bc) $('barcode').value = bc;

  // link terug naar loggen met juiste maaltijd/datum
  const meal = params.get('meal') || '';
  const date = params.get('date') || '';
  $('backLink').href = `loggen.html${meal ? `?meal=${meal}&date=${date}` : ''}`;

  $('productForm').addEventListener('submit', save);
})();

async function save(e) {
  e.preventDefault();
  const alertBox = $('alert');
  alertBox.className = 'alert hidden';

  const payload = {
    user_id: userId,
    name: $('name').value.trim(),
    brand: $('brand').value.trim() || null,
    barcode: $('barcode').value.trim() || null,
    kcal_per_100: Number($('kcal').value),
    protein_per_100: Number($('protein').value) || 0,
    carbs_per_100: Number($('carbs').value) || 0,
    fat_per_100: Number($('fat').value) || 0,
    default_serving_g: $('serving').value ? Number($('serving').value) : null,
  };
  if (!payload.name || !payload.kcal_per_100) {
    alertBox.textContent = 'Vul minimaal een naam en de calorieën per 100 g in.';
    alertBox.className = 'alert alert-error';
    return;
  }

  const btn = $('saveBtn'); btn.disabled = true; btn.textContent = 'Opslaan…';
  const { error } = await supabase.from('custom_products').insert(payload);
  if (error) {
    alertBox.textContent = 'Opslaan mislukt: ' + error.message;
    alertBox.className = 'alert alert-error';
    btn.disabled = false; btn.textContent = 'Opslaan';
    return;
  }
  // terug naar loggen; nieuw product verschijnt onder "Mijn producten"
  const meal = params.get('meal') || '';
  const date = params.get('date') || '';
  location.href = `loggen.html${meal ? `?meal=${meal}&date=${date}` : ''}`;
}
