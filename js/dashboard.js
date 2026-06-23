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
const CHEVRON = '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
let currentDate = new Date();
let userId = null;
let weightTimer = null;

const $ = (id) => document.getElementById(id);
// Null-safe zetters: een ontbrekend element (bv. door cache-mismatch) mag de render nooit breken.
const setText = (id, val) => { const el = $(id); if (el) el.textContent = val; };

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
    supabase.from('step_log').select('kcal,active_kcal').eq('log_date', dateStr).maybeSingle(),
    supabase.from('activity_log').select('kcal,source').eq('log_date', dateStr),
  ]);
  const sd = stepRes.data;
  // Echte Fitbit-verbranding (active_kcal) als die er is, anders de stappen-schatting.
  const base = sd ? (sd.active_kcal != null ? Number(sd.active_kcal) : Number(sd.kcal || 0)) : 0;
  // Fitbit-workouts zitten al in active_kcal → alleen handmatige activiteiten optellen.
  const manual = (actRes.data || []).filter(a => a.source !== 'fitbit').reduce((s, a) => s + Number(a.kcal || 0), 0);
  return Math.round(base + manual);
}

/** Aantal stappen van de dag (0 als niets gelogd). */
async function loadSteps(dateStr) {
  const { data } = await supabase.from('step_log').select('steps').eq('log_date', dateStr).maybeSingle();
  return data ? Number(data.steps) || 0 : 0;
}

/** Laatst gelogde gewicht (null als er nog niets is). */
async function loadWeight() {
  const { data } = await supabase.from('weight_log').select('weight_kg').order('log_date', { ascending: false }).limit(1);
  return data && data.length ? Number(data[0].weight_kg) : null;
}

/** Slaap van de (wake-)dag, of null. */
async function loadSleep(dateStr) {
  const { data } = await supabase.from('sleep_log').select('duration_min,score').eq('log_date', dateStr).maybeSingle();
  return data || null;
}

/** Streak: aantal dagen op rij met minimaal één voeding-log (tot vandaag). */
async function loadStreak() {
  const { data } = await supabase.from('food_log').select('log_date');
  const days = new Set((data || []).map(r => r.log_date));
  let streak = 0;
  const d = new Date();
  // Vandaag nog niet gelogd is geen breuk — de dag is nog bezig; tel dan vanaf gisteren.
  if (!days.has(isoDate(d))) d.setDate(d.getDate() - 1);
  while (days.has(isoDate(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

function render(profile, items, burned, steps, weight, streak, sleep) {
  // Module-instellingen cachen voor de onderbalk (nav.js leest deze).
  try { localStorage.setItem('brightly_modules', JSON.stringify(profile.modules || {})); } catch (e) {}
  setText('dateLabel', currentDate.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }));
  setText('greeting', dutchDateLabel(currentDate));
  setText('streakN', streak);

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
  setText('kcalLeft', left);
  setText('kcalGoal', goal);
  setText('kcalEaten', Math.round(tot.kcal));
  setText('kcalBurned', burned ? '+' + burned : '0');
  setText('statSteps', (steps || 0).toLocaleString('nl-NL'));
  setText('statWeight', weight != null ? `${weight} kg` : '—');

  // Vannacht-kaart (slaap) — alleen tonen als er slaapdata is.
  const sc = $('sleepCard');
  if (sc) {
    if (sleep && sleep.duration_min) {
      const m = Math.round(sleep.duration_min);
      let txt = `${Math.floor(m / 60)}u ${String(m % 60).padStart(2, '0')}m`;
      if (sleep.score != null) txt += ` · score ${sleep.score}`;
      setText('sleepValue', txt);
      sc.style.display = '';
    } else {
      sc.style.display = 'none';
    }
  }

  // Ring (gevuld t.o.v. het bijgestelde doel inclusief beweging)
  const pct = Math.min(1, netGoal ? tot.kcal / netGoal : 0);
  const ring = $('ringFg');
  if (ring) { ring.style.strokeDasharray = RING_CIRC; ring.style.strokeDashoffset = RING_CIRC * (1 - pct); }

  // Macro's
  const pGoal = profile.daily_protein_goal || Math.round(goal * 0.30 / 4);
  const cGoal = profile.daily_carbs_goal   || Math.round(goal * 0.40 / 4);
  const fGoal = profile.daily_fat_goal     || Math.round(goal * 0.30 / 9);
  const setMacro = (bar, val, amount, mGoal) => {
    setText(val, `${Math.round(amount)} g`);
    const b = $(bar); if (b) b.style.width = Math.min(100, mGoal ? (amount / mGoal) * 100 : 0) + '%';
  };
  setMacro('barCarb', 'valCarb', tot.carbs, cGoal);
  setMacro('barProtein', 'valProtein', tot.protein, pGoal);
  setMacro('barFat', 'valFat', tot.fat, fGoal);
  // Waarvan suikers — zelfde schaal als koolhydraten (suiker is deel van koolhydraten)
  setMacro('barSugar', 'valSugar', tot.sugar, cGoal);

  // Maaltijden — elk eetmoment opent zijn eigen pagina (maaltijd.html)
  const dateStr = isoDate(currentDate);
  const wrap = $('meals');
  if (!wrap) return;
  wrap.innerHTML = MEALS.map(m => {
    const mealItems = items.filter(i => i.meal_type === m.key);
    const mealKcal = Math.round(mealItems.reduce((s, i) => s + Number(i.kcal || 0) * (i.qty || 1), 0));
    const target = mealTarget(profile, m.key);

    // Rand: groen onder de streefwaarde, oranje eroverheen, niets bij leeg.
    const status = mealItems.length ? (mealKcal <= target ? 'within' : 'over') : '';

    // Subregel onder de naam: samenvatting van wat je at, of een hint.
    const sub = mealItems.length
      ? `<div class="sub">${mealItems.map(i => escapeHtml(i.name)).join(', ')}</div>`
      : '<div class="sub">Nog niets gelogd</div>';

    return `
      <div class="meal${status ? ' ' + status : ''}">
        <div class="meal-head">
          <a class="meal-open" href="maaltijd.html?meal=${m.key}&date=${dateStr}">
            <div class="meal-icon">${m.icon}</div>
            <div class="meal-info">
              <div class="name">${m.label}</div>
              ${sub}
            </div>
            <div class="meal-kcal">${mealKcal} / ${target}</div>
            <span class="meal-chevron" aria-hidden="true">${CHEVRON}</span>
          </a>
          <a class="meal-add" href="loggen.html?meal=${m.key}&date=${dateStr}" aria-label="Toevoegen aan ${m.label}">+</a>
        </div>
      </div>`;
  }).join('');
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
  const [profile, items, burned, steps, weight, streak, sleep] = await Promise.all([
    loadProfile(), loadDay(dateStr), loadBurned(dateStr), loadSteps(dateStr), loadWeight(), loadStreak(), loadSleep(dateStr),
  ]);
  render(profile, items, burned, steps, weight, streak, sleep);
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

/* ---------- Gewicht-kaart (snel loggen van vandaag) ---------- */
async function initWeightCard() {
  const card = $('weightCard');
  if (!card) return;
  const todayStr = isoDate(new Date());
  const [todayRes, latestRes, profRes] = await Promise.all([
    supabase.from('weight_log').select('weight_kg').eq('log_date', todayStr).maybeSingle(),
    supabase.from('weight_log').select('weight_kg').order('log_date', { ascending: false }).limit(1),
    supabase.from('profiles').select('target_weight_kg').single(),
  ]);
  let saved = todayRes.data ? Number(todayRes.data.weight_kg) : null;
  const latest = latestRes.data && latestRes.data.length ? Number(latestRes.data[0].weight_kg) : null;
  let val = Math.round((saved ?? latest ?? 70) * 10) / 10;
  const goal = profRes.data && profRes.data.target_weight_kg != null ? Number(profRes.data.target_weight_kg) : null;

  const show = () => setText('wcValue', `${val.toFixed(1)} kg`);
  setText('wcGoal', goal != null ? `Doel ${goal} kg` : '');
  show();

  async function saveWeight() {
    if (saved != null && Math.abs(val - saved) < 0.05) { setText('wcStatus', ''); return; }  // niets veranderd
    const { error } = await supabase.from('weight_log')
      .upsert({ user_id: userId, log_date: todayStr, weight_kg: val }, { onConflict: 'user_id,log_date' });
    if (error) { setText('wcStatus', 'Opslaan mislukt'); return; }
    saved = val;
    setText('wcStatus', '✓ opgeslagen');
    setText('statWeight', `${val.toFixed(1)} kg`);   // bovenste stat meteen bijwerken
  }
  const nudge = (delta) => {
    val = Math.round(Math.min(400, Math.max(20, val + delta)) * 10) / 10;
    show();
    setText('wcStatus', '');
    clearTimeout(weightTimer);
    weightTimer = setTimeout(saveWeight, 800);   // bewaar waar je hem laat staan
  };

  // Tikken = 0,1; ingedrukt houden = versneld herhalen (fijn voor grotere sprongen).
  const bindHold = (btn, delta) => {
    let to = null, iv = null;
    const stop = () => { clearTimeout(to); clearInterval(iv); iv = null; };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      nudge(delta);
      to = setTimeout(() => { iv = setInterval(() => nudge(delta), 90); }, 400);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, stop));
  };
  bindHold($('wcDown'), -0.1);
  bindHold($('wcUp'), 0.1);
}

(async function init() {
  const session = await requireAuth();
  if (!session) return;
  userId = session.user.id;
  // Optionele ?date=YYYY-MM-DD (bv. vanuit de kalender), niet in de toekomst.
  const dateParam = new URLSearchParams(location.search).get('date');
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const [y, m, d] = dateParam.split('-').map(Number);
    const picked = new Date(y, m - 1, d);
    if (!isNaN(picked) && picked <= new Date()) currentDate = picked;
  }
  await refresh();
  if (window.hideLoader) hideLoader();
  initWeightCard();

  // Fitbit: stille dagsync op de achtergrond; ververs als er stappen binnenkwamen.
  if (typeof fitbitAutoSync === 'function' && isToday(currentDate)) {
    fitbitAutoSync(isoDate(currentDate)).then(r => { if (r && r.connected) refresh(); }).catch(() => {});
  }
})();
