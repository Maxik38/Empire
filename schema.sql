-- ============================================================
-- EMPIRE GAME - Fáza 1: Hrad, suroviny, budovy, fronty
-- Spusti tento skript v Supabase SQL editore
-- ============================================================

-- 1. PROFILY HRÁČOV (naviazané na auth.users)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  created_at timestamptz not null default now()
);

-- 2. HRADY
-- Zatiaľ 1 hrad na hráča (hlavný hrad). Neskôr pribudnú kolónie/základne.
create table if not exists castles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  name text not null default 'Hrad',
  x int not null,
  y int not null,
  created_at timestamptz not null default now(),
  unique (x, y)
);

-- 3. SUROVINY HRADU
-- Jeden riadok na hrad na typ suroviny.
create table if not exists castle_resources (
  castle_id uuid not null references castles(id) on delete cascade,
  resource_type text not null check (resource_type in ('wood','stone','food','gold')),
  amount numeric not null default 0,
  capacity numeric not null default 1000,
  production_rate numeric not null default 0, -- za sekundu
  last_updated_at timestamptz not null default now(),
  primary key (castle_id, resource_type)
);

-- 4. BUDOVY NA HRADE
-- building_type = kľúč definovaný v JS konfigu (napr. 'sawmill', 'quarry', 'farm', 'warehouse', 'main_hall')
create table if not exists castle_buildings (
  id uuid primary key default gen_random_uuid(),
  castle_id uuid not null references castles(id) on delete cascade,
  building_type text not null,
  level int not null default 0,
  slot int not null, -- pozícia v mriežke hradu (0..n)
  created_at timestamptz not null default now(),
  unique (castle_id, slot)
);

-- 5. FRONTA VÝSTAVBY
-- Keď hráč spustí vylepšenie, vytvorí sa záznam. Server aj klient
-- kontrolujú finish_at a po jeho dosiahnutí sa level budovy zvýši.
create table if not exists build_queue (
  id uuid primary key default gen_random_uuid(),
  castle_id uuid not null references castles(id) on delete cascade,
  building_id uuid not null references castle_buildings(id) on delete cascade,
  target_level int not null,
  started_at timestamptz not null default now(),
  finish_at timestamptz not null,
  completed boolean not null default false
);

-- ============================================================
-- INDEXY
-- ============================================================
create index if not exists idx_castles_owner on castles(owner_id);
create index if not exists idx_buildings_castle on castle_buildings(castle_id);
create index if not exists idx_queue_castle on build_queue(castle_id) where completed = false;

-- ============================================================
-- ROW LEVEL SECURITY
-- Hráč vidí a mení iba svoje vlastné dáta.
-- (Neskôr, keď pribudne mapa/útoky, pridáme aj read-only prístup
-- k cudzím hradom pre zobrazenie na mape.)
-- ============================================================
alter table profiles enable row level security;
alter table castles enable row level security;
alter table castle_resources enable row level security;
alter table castle_buildings enable row level security;
alter table build_queue enable row level security;

create policy "profiles: read all" on profiles for select using (true);
create policy "profiles: insert own" on profiles for insert with check (auth.uid() = id);
create policy "profiles: update own" on profiles for update using (auth.uid() = id);

create policy "castles: owner full access" on castles for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "resources: owner full access" on castle_resources for all
  using (exists (select 1 from castles c where c.id = castle_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from castles c where c.id = castle_id and c.owner_id = auth.uid()));

create policy "buildings: owner full access" on castle_buildings for all
  using (exists (select 1 from castles c where c.id = castle_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from castles c where c.id = castle_id and c.owner_id = auth.uid()));

create policy "queue: owner full access" on build_queue for all
  using (exists (select 1 from castles c where c.id = castle_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from castles c where c.id = castle_id and c.owner_id = auth.uid()));

-- ============================================================
-- FUNKCIA: založenie nového hráča (nový hrad + počiatočné suroviny/budovy)
-- Zavolá sa raz z klienta po registrácii.
-- ============================================================
create or replace function create_starter_castle(p_username text)
returns uuid
language plpgsql
security definer
as $$
declare
  v_castle_id uuid;
  v_x int;
  v_y int;
begin
  insert into profiles (id, username) values (auth.uid(), p_username)
    on conflict (id) do nothing;

  -- náhodná voľná pozícia na mape (zjednodušené pre fázu 1)
  v_x := (random() * 2000)::int;
  v_y := (random() * 2000)::int;

  insert into castles (owner_id, name, x, y)
  values (auth.uid(), p_username || 's hrad', v_x, v_y)
  returning id into v_castle_id;

  insert into castle_resources (castle_id, resource_type, amount, capacity, production_rate) values
    (v_castle_id, 'wood', 500, 1000, 0.5),
    (v_castle_id, 'stone', 500, 1000, 0.5),
    (v_castle_id, 'food', 500, 1000, 0.3),
    (v_castle_id, 'gold', 200, 1000, 0.1);

  insert into castle_buildings (castle_id, building_type, level, slot) values
    (v_castle_id, 'main_hall', 1, 0),
    (v_castle_id, 'sawmill', 1, 1),
    (v_castle_id, 'quarry', 1, 2),
    (v_castle_id, 'farm', 1, 3),
    (v_castle_id, 'warehouse', 1, 4),
    (v_castle_id, 'barracks', 0, 5),
    (v_castle_id, 'empty', 0, 6),
    (v_castle_id, 'empty', 0, 7),
    (v_castle_id, 'empty', 0, 8);

  return v_castle_id;
end;
$$;
