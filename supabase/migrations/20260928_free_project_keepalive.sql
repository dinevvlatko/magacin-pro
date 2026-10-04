-- Keeps this low-traffic Free project active without exposing application data.
-- Run once in the Supabase SQL editor after the paused project is restored.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create table if not exists private.system_heartbeat (
  id smallint primary key check (id = 1),
  checked_at timestamptz not null default now()
);

revoke all on table private.system_heartbeat from public;
revoke all on table private.system_heartbeat from anon;
revoke all on table private.system_heartbeat from authenticated;

create or replace function public.keep_project_active()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.system_heartbeat (id, checked_at)
  values (1, now())
  on conflict (id) do update
    set checked_at = excluded.checked_at
    where private.system_heartbeat.checked_at < now() - interval '6 hours';

  return true;
end;
$$;

revoke all on function public.keep_project_active() from public;
grant execute on function public.keep_project_active() to anon;
grant execute on function public.keep_project_active() to authenticated;
