alter table public.fuelings
  add column if not exists source text not null default 'online',
  add column if not exists offline_created_at timestamptz,
  add column if not exists synced_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fuelings_source_check'
      and conrelid = 'public.fuelings'::regclass
  ) then
    alter table public.fuelings
      add constraint fuelings_source_check check (source in ('online', 'offline'));
  end if;
end $$;

update public.fuelings
set source = 'online'
where source is null;
