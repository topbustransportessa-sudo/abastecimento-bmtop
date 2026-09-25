create table if not exists public.tank_measurements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  measured_at timestamptz not null,
  company text not null check (company in ('Belo Monte', 'Topbus')),
  tank_id uuid not null references public.diesel_tanks(id),
  pump text not null check (pump in ('1', '2', '3', '4', '5', '6')),
  kind text not null check (kind in ('initial', 'final')),
  measure_mm numeric(12, 2) not null,
  liters numeric(14, 2) not null,
  photo_url text not null,
  user_id uuid not null references public.app_users(id)
);

create index if not exists tank_measurements_measured_at_idx on public.tank_measurements (measured_at desc);
create index if not exists tank_measurements_tank_pump_idx on public.tank_measurements (tank_id, pump, measured_at desc);

alter table public.tank_measurements enable row level security;
grant all privileges on public.tank_measurements to service_role;
