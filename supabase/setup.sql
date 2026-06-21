-- ============================================
-- NUTRIX - Databaseschema
-- Voer dit uit in de Supabase SQL-editor (of via MCP apply_migration).
-- Veilig om opnieuw te draaien (idempotent waar mogelijk).
-- ============================================

-- ---------- PROFILES ----------
create table if not exists public.profiles (
  id                 uuid primary key references auth.users on delete cascade,
  display_name       text,
  gender             text check (gender in ('man','vrouw','anders')),
  birth_date         date,
  height_cm          numeric,
  activity_level     text check (activity_level in ('zittend','licht','matig','actief','zeer_actief')),
  goal               text check (goal in ('afvallen','onderhoud','aankomen')),
  target_weight_kg   numeric,
  daily_kcal_goal    integer,
  daily_protein_goal integer,
  daily_carbs_goal   integer,
  daily_fat_goal     integer,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- ---------- WEIGHT LOG (dagelijks gewicht) ----------
create table if not exists public.weight_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  log_date   date not null,
  weight_kg  numeric not null,
  created_at timestamptz default now(),
  unique (user_id, log_date)
);
create index if not exists weight_log_user_date_idx on public.weight_log (user_id, log_date);

-- ---------- CUSTOM PRODUCTS (zelf aangemaakt / gescand) ----------
create table if not exists public.custom_products (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users on delete cascade,
  name             text not null,
  brand            text,
  barcode          text,
  kcal_per_100     numeric not null,
  protein_per_100  numeric default 0,
  carbs_per_100    numeric default 0,
  fat_per_100      numeric default 0,
  fiber_per_100    numeric,
  sugar_per_100    numeric,
  salt_per_100     numeric,
  default_serving_g numeric,
  created_at       timestamptz default now()
);
create index if not exists custom_products_user_idx on public.custom_products (user_id);
create index if not exists custom_products_barcode_idx on public.custom_products (user_id, barcode);

-- ---------- FOOD LOG (gelogde maaltijden & drankjes) ----------
create table if not exists public.food_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  log_date   date not null,
  meal_type  text not null check (meal_type in ('ontbijt','lunch','diner','snack','drinken')),
  source     text not null check (source in ('off','custom')),  -- off = Open Food Facts
  source_ref text,            -- barcode / OFF-code / custom_product id
  name       text not null,
  brand      text,
  amount_g   numeric not null,
  kcal       numeric not null,
  protein    numeric default 0,
  carbs      numeric default 0,
  fat        numeric default 0,
  logged_at  timestamptz default now()
);
create index if not exists food_log_user_date_idx on public.food_log (user_id, log_date);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
alter table public.profiles        enable row level security;
alter table public.weight_log      enable row level security;
alter table public.custom_products enable row level security;
alter table public.food_log        enable row level security;

-- PROFILES: eigenaar = id
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
drop policy if exists "profiles_upsert_own" on public.profiles;
create policy "profiles_upsert_own" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

-- Generieke owner-policies via user_id voor de overige tabellen
do $$
declare t text;
begin
  foreach t in array array['weight_log','custom_products','food_log'] loop
    execute format('drop policy if exists "%s_select_own" on public.%I;', t, t);
    execute format('create policy "%s_select_own" on public.%I for select using (auth.uid() = user_id);', t, t);
    execute format('drop policy if exists "%s_insert_own" on public.%I;', t, t);
    execute format('create policy "%s_insert_own" on public.%I for insert with check (auth.uid() = user_id);', t, t);
    execute format('drop policy if exists "%s_update_own" on public.%I;', t, t);
    execute format('create policy "%s_update_own" on public.%I for update using (auth.uid() = user_id);', t, t);
    execute format('drop policy if exists "%s_delete_own" on public.%I;', t, t);
    execute format('create policy "%s_delete_own" on public.%I for delete using (auth.uid() = user_id);', t, t);
  end loop;
end $$;

-- ============================================
-- TRIGGER: maak automatisch een profiel bij registratie
-- ============================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
