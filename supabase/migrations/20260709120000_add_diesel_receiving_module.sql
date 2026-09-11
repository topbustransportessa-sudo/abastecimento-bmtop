create table if not exists public.diesel_user_companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  company text not null check (company in ('Belo Monte', 'Topbus')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, company)
);

create table if not exists public.diesel_tanks (
  id uuid primary key default gen_random_uuid(),
  company text not null check (company in ('Belo Monte', 'Topbus')),
  name text not null,
  code text not null,
  fuel_type text not null,
  nominal_capacity numeric(14, 2) not null,
  real_capacity numeric(14, 2) not null,
  height_mm numeric(12, 2) not null,
  diameter numeric(12, 2) not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company, code)
);

create table if not exists public.diesel_arqueacao (
  id uuid primary key default gen_random_uuid(),
  company text not null check (company in ('Belo Monte', 'Topbus')),
  tank_id uuid not null references public.diesel_tanks(id) on delete cascade,
  measure_mm numeric(12, 2) not null,
  liters numeric(14, 2) not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tank_id, measure_mm)
);

create table if not exists public.diesel_tolerances (
  id uuid primary key default gen_random_uuid(),
  company text not null check (company in ('Belo Monte', 'Topbus')),
  tank_id uuid not null references public.diesel_tanks(id) on delete cascade,
  tolerance_liters numeric(14, 2) not null,
  tolerance_percent numeric(8, 4) not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.diesel_receipts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  company text not null check (company in ('Belo Monte', 'Topbus')),
  tank_id uuid not null references public.diesel_tanks(id),
  received_at timestamptz not null,
  user_id uuid not null references public.app_users(id),
  trailer_plate text not null,
  supplier text not null,
  invoice_number text not null,
  invoice_liters numeric(14, 2) not null,
  sealed_truck_photo_url text not null,
  initial_mm numeric(12, 2) not null,
  initial_liters numeric(14, 2),
  initial_photo_url text not null,
  final_mm numeric(12, 2) not null,
  final_liters numeric(14, 2),
  final_photo_url text not null,
  measured_liters numeric(14, 2),
  diff_liters numeric(14, 2),
  diff_percent numeric(10, 6),
  status text not null,
  observation text,
  admin_analysis text,
  analyzed_by uuid references public.app_users(id),
  analyzed_at timestamptz
);

create table if not exists public.diesel_audits (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  entity_id uuid,
  action text not null,
  created_at timestamptz not null default now(),
  user_id uuid references public.app_users(id),
  notes text,
  changes jsonb not null default '{}'::jsonb
);

create index if not exists diesel_tanks_company_idx on public.diesel_tanks (company);
create index if not exists diesel_arqueacao_tank_idx on public.diesel_arqueacao (tank_id, measure_mm);
create index if not exists diesel_tolerances_tank_idx on public.diesel_tolerances (tank_id);
create index if not exists diesel_receipts_received_at_idx on public.diesel_receipts (received_at desc);
create index if not exists diesel_receipts_company_idx on public.diesel_receipts (company);
create index if not exists diesel_receipts_user_idx on public.diesel_receipts (user_id);
create index if not exists diesel_audits_entity_idx on public.diesel_audits (entity, entity_id);

alter table public.diesel_user_companies enable row level security;
alter table public.diesel_tanks enable row level security;
alter table public.diesel_arqueacao enable row level security;
alter table public.diesel_tolerances enable row level security;
alter table public.diesel_receipts enable row level security;
alter table public.diesel_audits enable row level security;
