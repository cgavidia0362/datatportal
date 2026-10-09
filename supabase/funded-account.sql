-- Run once in the Supabase SQL editor.
-- Stores the funded-sheet account number and lets the public
-- dealer/state pages average lender fees. Account numbers stay
-- off those public pages; only the signed-in deal popup shows them.

alter table public.funded_deals
  add column if not exists account_number text;

alter table public.funded_deals enable row level security;

drop policy if exists portal_anon_select on public.funded_deals;
create policy portal_anon_select
  on public.funded_deals
  for select
  to anon
  using (true);

grant select on public.funded_deals to anon;
