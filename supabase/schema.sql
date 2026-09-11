create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  password_salt text not null,
  role text not null check (role in ('admin', 'frentista')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  plate text not null,
  min_avg numeric(10, 2) not null,
  max_avg numeric(10, 2) not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.fuelings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  vehicle_id uuid not null references public.vehicles(id),
  vehicle_photo_url text,
  tachograph_photo_url text,
  pump text not null check (pump in ('1', '2', '3', '4', '5', '6')),
  pump_photo_url text,
  km numeric(12, 0) not null,
  liters numeric(12, 2) not null,
  observation text,
  user_id uuid not null references public.app_users(id)
);

create table if not exists public.pump_closings (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  pump text not null check (pump in ('1', '2', '3', '4', '5', '6')),
  initial numeric(14, 2) not null,
  final numeric(14, 2) not null,
  photo_url text,
  created_at timestamptz not null default now(),
  user_id uuid not null references public.app_users(id)
);

create table if not exists public.fueling_audits (
  id uuid primary key default gen_random_uuid(),
  fueling_id uuid not null references public.fuelings(id) on delete cascade,
  changed_at timestamptz not null default now(),
  changed_by uuid not null references public.app_users(id),
  justification text not null,
  changes jsonb not null
);

create index if not exists fuelings_created_at_idx on public.fuelings (created_at desc);
create index if not exists fuelings_vehicle_id_idx on public.fuelings (vehicle_id);
create index if not exists fueling_audits_fueling_id_idx on public.fueling_audits (fueling_id);
create index if not exists fueling_audits_changed_at_idx on public.fueling_audits (changed_at desc);
create index if not exists pump_closings_date_idx on public.pump_closings (date desc);

alter table public.app_users enable row level security;
alter table public.vehicles enable row level security;
alter table public.fuelings enable row level security;
alter table public.fueling_audits enable row level security;
alter table public.pump_closings enable row level security;

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant all privileges on sequences to service_role;
