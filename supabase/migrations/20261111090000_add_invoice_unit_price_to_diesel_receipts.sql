alter table public.diesel_receipts
  add column if not exists invoice_unit_price numeric(14, 4);
