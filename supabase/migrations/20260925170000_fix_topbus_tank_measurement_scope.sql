alter table public.tank_measurements
  drop constraint if exists tank_measurements_pump_check;

alter table public.tank_measurements
  add constraint tank_measurements_pump_check
  check (pump in ('1', '2', '3', '4', '5', '6', 'topbus'));
