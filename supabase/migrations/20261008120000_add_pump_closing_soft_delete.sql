alter table public.pump_closings
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.app_users(id),
  add column if not exists delete_reason text;

create index if not exists pump_closings_deleted_at_idx
  on public.pump_closings (deleted_at);
