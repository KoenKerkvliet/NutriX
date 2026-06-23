/* ============================================
   BRIGHTLY - Maaltijdverdeling (dagdoel → per eetmoment)
   Gedeeld tussen dashboard, maaltijd-pagina en profiel.
   ============================================ */

// Eetmoment-sleutel → profielkolom met het percentage van het dagdoel.
const MEAL_PCT_COLS = {
  ontbijt: 'meal_pct_ontbijt',
  lunch:   'meal_pct_lunch',
  diner:   'meal_pct_diner',
  snack:   'meal_pct_snack',
  drinken: 'meal_pct_drinken',
};

// Standaardverdeling (ontbijt & lunch lager dan diner).
const DEFAULT_MEAL_PCT = { ontbijt: 25, lunch: 30, diner: 35, snack: 7, drinken: 3 };

/** Percentage van het dagdoel voor een eetmoment (valt terug op de standaard). */
function mealPct(profile, key) {
  const v = profile ? profile[MEAL_PCT_COLS[key]] : null;
  return (v == null || v === '') ? DEFAULT_MEAL_PCT[key] : Number(v);
}

/** Streefcalorieën voor een eetmoment, afgeleid van het dagdoel. */
function mealTarget(profile, key) {
  const goal = (profile && profile.daily_kcal_goal) || 2000;
  return Math.round(goal * mealPct(profile, key) / 100);
}
