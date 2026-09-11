create table if not exists public.fueling_audits (
  id uuid primary key default gen_random_uuid(),
  fueling_id uuid not null references public.fuelings(id) on delete cascade,
  changed_at timestamptz not null default now(),
  changed_by uuid not null references public.app_users(id),
  justification text not null,
  changes jsonb not null
);

create index if not exists fueling_audits_fueling_id_idx on public.fueling_audits (fueling_id);
create index if not exists fueling_audits_changed_at_idx on public.fueling_audits (changed_at desc);

alter table public.fueling_audits enable row level security;
