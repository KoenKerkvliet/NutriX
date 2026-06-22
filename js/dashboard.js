/* ============================================
   BRIGHTLY - Dashboard (dagoverzicht)
   ============================================ */

const SVG = (paths) =>
  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

const MEALS = [
  { key: 'ontbijt',  label: 'Ontbijt',    icon: SVG('<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" y1="2" x2="6" y2="4.5"/><line x1="10" y1="2" x2="10" y2="4.5"/><line x1="14" y1="2" x2="14" y2="4.5"/>') },
  { key: 'lunch',    label: 'Lunch',      icon: SVG('<path d="M4 11h16a8 8 0 0 1-16 0Z"/><path d="M12 3v3M9 4.5v1.5M15 4.5v1.5"/>') },
  { key: 'diner',    label: 'Diner',      icon: SVG('<path d="M3 2v7c0 1.1.9 2 2 2a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>') },
  { key: 'snack',    label: 'Tussendoor', icon: SVG('<path d="M12 8c-1-1-2.6-1.4-4-1-2 .7-3 3-3 5.5C5 16 8 21 10 21c.8 0 1.2-.4 2-.4s1.2.4 2 .4c2 0 5-5 5-8.5 0-2.5-1-4.8-3-5.5-1.4-.4-3 0-4 1Z"/><path d="M12 8c0-2 1-3.6 3-4"/>') },
  { key: 'drinken',  label: 'Drinken',    icon: SVG('<path d="M6 4h12l-1.4 15.2a2 2 0 0 1-2 1.8H9.4a2 2 0 0 1-2-1.8L6 4Z"/><path d="M5 4h14M7.6 10h8.8"/>') },
];

const RING_CIRC = 2 * Math.PI * 52; // omtrek van de ring (r=52)
const CHEVRON = '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
let currentDate = new Date();

// Inklap-status per eetmoment. Verleden dagen starten ingeklapt, vandaag uitgeklapt.
let mealCollapsed = {};
let collapsedDateKey = null;
let lastData = null;          // laatst gerenderde data (voor re-render bij togglen)

const $ = (id) => document.getElementById(id);

/** Lokale datum als YYYY-MM-DD (zonder tijdzone-verschuiving). */
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dutchDateLabel(d) {
  const today = isoDate(new Date());
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (isoDate(d) === today) return 'Vandaag';
  if (isoDate(d) === isoDate(y)) return 'Gisteren';
  return d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
}

async function loadProfile() {
  const { data } = await supabase.from('profiles').select('*').single();
  return data || {};
}

async function loadDay(dateStr) {
  const { data } = await supabase
    .from('food_log')
    .select('*')
    .eq('log_date', dateStr)
    .order('logged_at', { ascending: true });
  return data || [];
}

/** Verbrande calorieën van de dag: stappen + activiteiten. */
async function loadBurned(dateStr) {
  const [stepRes, actRes] = await Promise.all([
    supabase.from('step_log').select('kcal').eq('log_date', dateStr).maybeSingle(),
    supabase.from('activity_log').select('kcal').eq('log_date', dateStr),
  ]);
  const stepKcal = stepRes.data ? Number(stepRes.data.kcal) : 0;
  const actKcal = (actRes.data || []).reduce((s, a) => s + Number(a.kcal || 0), 0);
  return Math.round(stepKcal + actKcal);
}

function render(profile, items, burned) {
  $('dateLabel').textContent = currentDate.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
  $('greeting').textContent = dutchDateLabel(currentDate);

  // Totalen (× aantal porties per item)
  const tot = items.reduce((a, i) => {
    const q = i.qty || 1;
    return {
      kcal: a.kcal + Number(i.kcal || 0) * q,
      carbs: a.carbs + Number(i.carbs || 0) * q,
      sugar: a.sugar + Number(i.sugar || 0) * q,
      protein: a.protein + Number(i.protein || 0) * q,
      fat: a.fat + Number(i.fat || 0) * q,
    };
  }, { kcal: 0, carbs: 0, sugar: 0, protein: 0, fat: 0 });

  const goal = profile.daily_kcal_goal || 2000;
  const netGoal = goal + (burned || 0);          // beweging mag je extra eten
  const left = Math.max(0, Math.round(netGoal - tot.kcal));
  $('kcalLeft').textContent = left;
  $('kcalEaten').textContent = Math.round(tot.kcal);
  $('kcalGoal').textContent = goal;
  $('kcalBurned').textContent = '+' + (burned || 0);
  $('burnedWrap').classList.toggle('hidden', !burned);

  // Ring (gevuld t.o.v. het bijgestelde doel inclusief beweging)
  const pct = Math.min(1, netGoal ? tot.kcal / netGoal : 0);
  $('ringFg').style.strokeDasharray = RING_CIRC;
  $('ringFg').style.strokeDashoffset = RING_CIRC * (1 - pct);

  // Macro's
  const pGoal = profile.daily_protein_goal || Math.round(goal * 0.30 / 4);
  const cGoal = profile.daily_carbs_goal   || Math.round(goal * 0.40 / 4);
  const fGoal = profile.daily_fat_goal     || Math.round(goal * 0.30 / 9);
  const setMacro = (bar, val, amount, mGoal) => {
    $(val).textContent = `${Math.round(amount)} g`;
    $(bar).style.width = Math.min(100, mGoal ? (amount / mGoal) * 100 : 0) + '%';
  };
  setMacro('barCarb', 'valCarb', tot.carbs, cGoal);
  setMacro('barProtein', 'valProtein', tot.protein, pGoal);
  setMacro('barFat', 'valFat', tot.fat, fGoal);
  // Waarvan suikers — zelfde schaal als koolhydraten (suiker is deel van koolhydraten)
  setMacro('barSugar', 'valSugar', tot.sugar, cGoal);

  // Maaltijden
  lastData = { profile, items, burned };
  const dateStr = isoDate(currentDate);

  // Bij een nieuwe dag de inklap-status resetten naar de standaard:
  // afgelopen dagen ingeklapt, vandaag uitgeklapt.
  if (collapsedDateKey !== dateStr) {
    collapsedDateKey = dateStr;
    const collapseByDefault = !isToday(currentDate);
    mealCollapsed = {};
    MEALS.forEach(m => { mealCollapsed[m.key] = collapseByDefault; });
  }

  const wrap = $('meals');
  wrap.innerHTML = MEALS.map(m => {
    const mealItems = items.filter(i => i.meal_type === m.key);
    const mealKcal = Math.round(mealItems.reduce((s, i) => s + Number(i.kcal || 0) * (i.qty || 1), 0));
    const collapsible = mealItems.length > 0;
    const collapsed = collapsible && mealCollapsed[m.key];

    const rows = collapsed ? '' : mealItems.map(i => {
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
    }).join('');

    // Subregel onder de naam: leeg → hint; ingeklapt → samenvatting van wat je at.
    let sub = '';
    if (!mealItems.length) {
      sub = '<div class="sub">Nog niets gelogd</div>';
    } else if (collapsed) {
      const names = mealItems.map(i => escapeHtml(i.name)).join(', ');
      sub = `<div class="sub">${names}</div>`;
    }

    return `
      <div class="meal${collapsed ? ' is-collapsed' : ''}">
        <div class="meal-head${collapsible ? ' clickable' : ''}"${collapsible ? ` data-meal="${m.key}" role="button" tabindex="0" aria-expanded="${!collapsed}"` : ''}>
          <div class="meal-icon">${m.icon}</div>
          <div class="meal-info">
            <div class="name">${m.label}</div>
            ${sub}
          </div>
          <div class="meal-kcal">${mealKcal} kcal</div>
          ${collapsible ? `<span class="meal-chevron" aria-hidden="true">${CHEVRON}</span>` : ''}
          <a class="meal-add" href="loggen.html?meal=${m.key}&date=${dateStr}" aria-label="Toevoegen aan ${m.label}">+</a>
        </div>
        ${rows}
      </div>`;
  }).join('');

  // Tellers en verwijderen
  wrap.querySelectorAll('.qty-btn').forEach(b => b.onclick = () => changeQty(b.dataset.id, b.dataset.act === 'inc' ? 1 : -1));
  wrap.querySelectorAll('.mi-del').forEach(b => b.onclick = () => removeItem(b.dataset.id));

  // In-/uitklappen door op de kop te klikken (niet op de +-knop).
  wrap.querySelectorAll('.meal-head.clickable').forEach(h => {
    h.addEventListener('click', (e) => {
      if (e.target.closest('.meal-add')) return;   // +-knop navigeert naar loggen
      toggleMeal(h.dataset.meal);
    });
    h.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMeal(h.dataset.meal); }
    });
  });
}

function toggleMeal(key) {
  mealCollapsed[key] = !mealCollapsed[key];
  if (lastData) render(lastData.profile, lastData.items, lastData.burned);
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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function isToday(d) { return isoDate(d) === isoDate(new Date()); }

function updateNav() {
  // niet vooruit naar de toekomst
  $('dayNext').disabled = isToday(currentDate);
}

async function refresh() {
  updateNav();
  const dateStr = isoDate(currentDate);
  const [profile, items, burned] = await Promise.all([loadProfile(), loadDay(dateStr), loadBurned(dateStr)]);
  render(profile, items, burned);
}

$('dayPrev').addEventListener('click', () => {
  currentDate.setDate(currentDate.getDate() - 1);
  refresh();
});

$('dayNext').addEventListener('click', () => {
  if (isToday(currentDate)) return;          // geen toekomst
  currentDate.setDate(currentDate.getDate() + 1);
  refresh();
});

$('dayToday').addEventListener('click', () => {
  if (isToday(currentDate)) return;
  currentDate = new Date();
  refresh();
});

(async function init() {
  const session = await requireAuth();
  if (!session) return;
  // Optionele ?date=YYYY-MM-DD (bv. vanuit de kalender), niet in de toekomst.
  const dateParam = new URLSearchParams(location.search).get('date');
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const [y, m, d] = dateParam.split('-').map(Number);
    const picked = new Date(y, m - 1, d);
    if (!isNaN(picked) && picked <= new Date()) currentDate = picked;
  }
  await refresh();
})();
