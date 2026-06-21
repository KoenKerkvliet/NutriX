# NutriX

Mobiele voedings- & gewicht-tracker, geïnspireerd op Yazio. Vanilla HTML/CSS/JS met
Supabase als backend en de [Open Food Facts](https://world.openfoodfacts.org/)-API als
Europese voedseldatabase. Mobile-first, te installeren als PWA. Gehost op GitHub Pages.

## Functies
- Inloggen / registreren (Supabase Auth)
- Dagoverzicht met calorie-ring en macro's
- Maaltijden loggen: ontbijt, lunch, diner, tussendoor en drinken
- Producten zoeken in Open Food Facts + **barcode scannen**
- Eigen producten aanmaken
- Dagelijks gewicht bijhouden (grafiek volgt)
- Profiel & persoonlijke doelen (kcal, macro's)

## Setup
1. Maak een Supabase-project aan.
2. Voer `supabase/setup.sql` uit in de SQL-editor (tabellen + RLS + trigger).
3. Vul `js/supabase-config.js` met je **Project URL** en **anon public key**
   (Supabase → Project Settings → API).
4. Zet de site op GitHub Pages (of open lokaal via een HTTPS-server i.v.m. camera).

## Structuur
```
index.html          Login / registratie
dashboard.html      Dagoverzicht
loggen.html         Zoeken + barcode scannen  (volgt)
product.html        Eigen product aanmaken    (volgt)
gewicht.html        Dagelijks gewicht         (volgt)
profiel.html        Profiel & doelen          (volgt)
css/style.css       Design system (mobile-first)
js/                 supabase-config, auth, dashboard, ...
supabase/setup.sql  Databaseschema
```

## Tech
Geen build-stap. Supabase-JS en de scanner-library worden via CDN geladen.
