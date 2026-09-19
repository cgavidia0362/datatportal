-- Buying Analysis Portal — Auth, profiles, and RLS
-- Run this in Supabase → SQL Editor (once).
--
-- Dashboard steps (do these first):
-- 1. Authentication → Providers → Email: enable
-- 2. Authentication → Providers → Email: turn OFF "Confirm email" if you want
--    invited users to sign in immediately with the temp password you set
-- 3. Authentication → Providers: disable any public sign-up / "Allow new users to sign up"
-- 4. Authentication → Users → Add user (your email + password)
-- 5. Run this entire script
-- 6. Run:  update public.profiles set role = 'admin' where email = 'YOUR_EMAIL';
-- 7. Vercel → Project → Settings → Environment Variables:
--    SUPABASE_SERVICE_ROLE_KEY = (Settings → API → service_role secret)
--    SUPABASE_URL = https://zhquyedaxszsnswaimza.supabase.co
--    Never put the service_role key in index.html

-- ── profiles ────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null default 'user' check (role in ('admin', 'user')),
  created_at timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (email);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, role)
  values (new.id, new.email, 'user')
  on conflict (user_id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill profiles for any Auth users already created
insert into public.profiles (user_id, email, role)
select id, email, 'user'
from auth.users
on conflict (user_id) do nothing;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

alter table public.profiles enable row level security;

drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- No client-side inserts/updates; the invite API uses the service role.

-- ── business tables: RLS ────────────────────────────────────────────────
-- Anon (report pages): SELECT only on tables those pages query.
-- Authenticated (portal): full access, same as today after login.

do $$
declare
  t text;
  report_tables text[] := array[
    'monthly_snapshots',
    'funding_returns',
    'master_dealers',
    'buying_daily_data',
    'rep_goals'
  ];
  write_tables text[] := array[
    'monthly_snapshots',
    'funded_deals',
    'monthly_kpis',
    'yearly_dealer_totals',
    'state_monthly',
    'fi_yearly',
    'master_dealers',
    'buying_daily_data',
    'rep_goals',
    'state_goals',
    'funding_deals',
    'funding_returns',
    'funding_ai_summaries'
  ];
begin
  foreach t in array write_tables
  loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t and table_type = 'BASE TABLE'
    ) then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists portal_anon_select on public.%I', t);
      execute format('drop policy if exists portal_auth_all on public.%I', t);
      execute format(
        'create policy portal_auth_all on public.%I for all to authenticated using (true) with check (true)',
        t
      );
    end if;
  end loop;

  foreach t in array report_tables
  loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t and table_type = 'BASE TABLE'
    ) then
      execute format(
        'create policy portal_anon_select on public.%I for select to anon using (true)',
        t
      );
    end if;
  end loop;
end $$;

-- Views used by the portal (read-only for both anon and logged-in users)
do $$
begin
  if exists (
    select 1 from information_schema.views
    where table_schema = 'public' and table_name = 'monthly_summary_view'
  ) then
    grant select on public.monthly_summary_view to anon, authenticated;
  end if;
end $$;

grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.is_admin() to authenticated;

-- Anon can only read the tables public report pages query
do $$
declare
  t text;
  report_tables text[] := array[
    'monthly_snapshots',
    'funding_returns',
    'master_dealers',
    'buying_daily_data',
    'rep_goals'
  ];
begin
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  loop
    execute format('revoke all on table public.%I from anon', t);
  end loop;
  foreach t in array report_tables
  loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t and table_type = 'BASE TABLE'
    ) then
      execute format('grant select on table public.%I to anon', t);
    end if;
  end loop;
end $$;
