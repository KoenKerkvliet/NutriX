/* ============================================
   BRIGHTLY - Eigen product aanmaken
   ============================================ */

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let userId = null;
let accessToken = null;

(async function init() {
  const session = await requireAuth();
  if (!session) return;
  userId = session.user.id;
  accessToken = session.access_token;

  // Categorie-dropdown vullen (vaste lijst uit categories.js)
  $('category').innerHTML = FOOD_CATEGORIES
    .map(c => `<option value="${c}"${c === DEFAULT_CATEGORY ? ' selected' : ''}>${c}</option>`).join('');

  const bc = params.get('barcode');
  if (bc) $('barcode').value = bc;

  // link terug naar loggen met juiste maaltijd/datum
  const meal = params.get('meal') || '';
  const date = params.get('date') || '';
  $('backLink').href = `loggen.html${meal ? `?meal=${meal}&date=${date}` : ''}`;

  $('productForm').addEventListener('submit', save);

  // AI: etiket scannen (foto)
  $('aiScanBtn').onclick = () => $('labelFile').click();
  $('labelFile').addEventListener('change', handleLabelPhoto);
  // AI: beschrijving (tekst)
  $('aiTextBtn').onclick = handleTextEstimate;
  $('aiText').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleTextEstimate(); } });
})();

/* ---------- AI helpers ---------- */
function fillFromAI(data) {
  if (data.name) $('name').value = data.name;
  if (data.brand) $('brand').value = data.brand;
  if (data.kcal_per_100 != null) $('kcal').value = data.kcal_per_100;
  if (data.protein_per_100 != null) $('protein').value = data.protein_per_100;
  if (data.carbs_per_100 != null) $('carbs').value = data.carbs_per_100;
  if (data.sugar_per_100 != null) $('sugar').value = data.sugar_per_100;
  if (data.fat_per_100 != null) $('fat').value = data.fat_per_100;
  if (data.default_serving_g != null) $('serving').value = data.default_serving_g;
  // AI mag een categorie voorstellen, maar alleen als die in onze vaste lijst zit
  if (data.category && FOOD_CATEGORIES.includes(data.category)) $('category').value = data.category;
}

async function callAI(payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/extract-label`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    const extra = data.detail ? ' — ' + String(data.detail).slice(0, 300) : '';
    throw new Error((data.error || 'Er ging iets mis.') + extra);
  }
  return data;
}

async function handleLabelPhoto(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  const status = $('aiStatus');
  const btn = $('aiScanBtn');
  status.style.color = ''; status.textContent = 'Foto verwerken…';
  btn.disabled = true;
  try {
    const base64 = await downscaleToBase64(file, 1280, 0.8);
    status.textContent = '🤖 Etiket lezen met AI…';
    fillFromAI(await callAI({ image: base64, mediaType: 'image/jpeg' }));
    status.style.color = 'var(--green-dark)';
    status.textContent = '✓ Ingevuld! Controleer de waarden en sla op.';
  } catch (err) {
    status.style.color = 'var(--danger)';
    status.textContent = 'Mislukt: ' + err.message;
  } finally {
    btn.disabled = false;
  }
}

async function handleTextEstimate() {
  const text = $('aiText').value.trim();
  if (!text) { $('aiText').focus(); return; }

  const status = $('aiStatus');
  const btn = $('aiTextBtn');
  status.style.color = ''; status.textContent = '🤖 Schatten met AI…';
  btn.disabled = true;
  try {
    fillFromAI(await callAI({ text }));
    status.style.color = 'var(--green-dark)';
    status.textContent = '✓ Geschat! Controleer de waarden (schatting) en sla op.';
  } catch (err) {
    status.style.color = 'var(--danger)';
    status.textContent = 'Mislukt: ' + err.message;
  } finally {
    btn.disabled = false;
  }
}

/** Verklein de foto via canvas en geef de base64 (zonder data-prefix) terug. */
function downscaleToBase64(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      URL.revokeObjectURL(img.src);
      resolve(dataUrl.split(',')[1]);
    };
    img.onerror = () => reject(new Error('Kon de foto niet laden.'));
    img.src = URL.createObjectURL(file);
  });
}

async function save(e) {
  e.preventDefault();
  const alertBox = $('alert');
  alertBox.className = 'alert hidden';

  const payload = {
    user_id: userId,
    name: $('name').value.trim(),
    brand: $('brand').value.trim() || null,
    barcode: $('barcode').value.trim() || null,
    category: $('category').value || DEFAULT_CATEGORY,
    kcal_per_100: parseNum($('kcal').value),
    protein_per_100: parseNum($('protein').value) || 0,
    carbs_per_100: parseNum($('carbs').value) || 0,
    sugar_per_100: $('sugar').value ? parseNum($('sugar').value) : null,
    fat_per_100: parseNum($('fat').value) || 0,
    default_serving_g: $('serving').value ? parseNum($('serving').value) : null,
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
