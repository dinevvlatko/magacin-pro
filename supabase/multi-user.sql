do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('admin', 'operator');
  end if;
end
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role public.app_role not null default 'operator',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists profiles_role_active_idx on public.profiles (role, active);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = case
        when public.profiles.full_name = '' then excluded.full_name
        else public.profiles.full_name
      end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, email, full_name)
select id, coalesce(email, ''), coalesce(raw_user_meta_data ->> 'full_name', '')
from auth.users
on conflict (id) do nothing;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and active
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
      and active
  );
$$;

revoke all on function public.is_active_user() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_admin() to authenticated;

create table if not exists public.shared_warehouse_state (
  id text primary key default 'main' check (id = 'main'),
  state jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

insert into public.shared_warehouse_state (id, state, updated_at, updated_by)
select 'main', state, updated_at, owner_id
from public.warehouse_state
order by updated_at desc
limit 1
on conflict (id) do nothing;

create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_log_created_at_idx on public.activity_log (created_at desc);
create index if not exists activity_log_actor_id_idx on public.activity_log (actor_id, created_at desc);
create index if not exists activity_log_entity_idx on public.activity_log (entity_type, entity_id);

alter table public.profiles enable row level security;
alter table public.shared_warehouse_state enable row level security;
alter table public.activity_log enable row level security;

revoke all on table public.profiles from anon;
revoke all on table public.shared_warehouse_state from anon;
revoke all on table public.activity_log from anon;

grant select, update on table public.profiles to authenticated;
grant select, insert, update on table public.shared_warehouse_state to authenticated;
grant select, insert on table public.activity_log to authenticated;
grant usage, select on sequence public.activity_log_id_seq to authenticated;

drop policy if exists "Users read own profile or admins read all" on public.profiles;
create policy "Users read own profile or admins read all"
on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Admins update profiles" on public.profiles;
create policy "Admins update profiles"
on public.profiles for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "Active users read shared warehouse" on public.shared_warehouse_state;
create policy "Active users read shared warehouse"
on public.shared_warehouse_state for select to authenticated
using ((select public.is_active_user()));

drop policy if exists "Active users create shared warehouse" on public.shared_warehouse_state;
create policy "Active users create shared warehouse"
on public.shared_warehouse_state for insert to authenticated
with check (
  (select public.is_active_user())
  and id = 'main'
  and updated_by = (select auth.uid())
);

drop policy if exists "Active users update shared warehouse" on public.shared_warehouse_state;
create policy "Active users update shared warehouse"
on public.shared_warehouse_state for update to authenticated
using ((select public.is_active_user()))
with check (
  (select public.is_active_user())
  and id = 'main'
  and updated_by = (select auth.uid())
);

drop policy if exists "Admins read activity" on public.activity_log;
create policy "Admins read activity"
on public.activity_log for select to authenticated
using ((select public.is_admin()));

drop policy if exists "Active users write own activity" on public.activity_log;
create policy "Active users write own activity"
on public.activity_log for insert to authenticated
with check (
  actor_id = (select auth.uid())
  and (select public.is_active_user())
);

alter table public.shared_warehouse_state replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shared_warehouse_state'
  ) then
    alter publication supabase_realtime add table public.shared_warehouse_state;
  end if;
end
$$;

-- Run this after the admin has registered, replacing the email value:
-- update public.profiles set role = 'admin' where email = 'admin@example.com';
