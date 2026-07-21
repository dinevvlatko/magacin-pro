create table if not exists public.warehouse_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.warehouse_state enable row level security;

revoke all on table public.warehouse_state from anon;
grant select, insert, update on table public.warehouse_state to authenticated;

drop policy if exists "Users read their warehouse" on public.warehouse_state;
create policy "Users read their warehouse"
on public.warehouse_state
for select
to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists "Users create their warehouse" on public.warehouse_state;
create policy "Users create their warehouse"
on public.warehouse_state
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists "Users update their warehouse" on public.warehouse_state;
create policy "Users update their warehouse"
on public.warehouse_state
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

alter table public.warehouse_state replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'warehouse_state'
  ) then
    alter publication supabase_realtime add table public.warehouse_state;
  end if;
end
$$;
