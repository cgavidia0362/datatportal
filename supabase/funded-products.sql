-- Run once in the Supabase SQL editor.
-- Keeps Gap and Warranty dollars from the monthly funded sheet.
-- Months before October 2026 stay empty; those columns are not backfilled.

alter table public.funded_deals
  add column if not exists gap_amount numeric,
  add column if not exists warranty_amount numeric;
