-- Admin-controlled application access.
-- A blocked profile keeps its auth account, but it cannot read or write
-- warehouse data and the client signs it out immediately.

alter table public.profiles
  add column if not exists active boolean not null default true;

create or replace function public.set_user_access(
  p_target_user_id uuid,
  p_active boolean
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Потребна е најава.'
      using errcode = '42501';
  end if;

  if not public.is_admin() then
    raise exception 'Само администратор може да менува пристап.'
      using errcode = '42501';
  end if;

  if p_target_user_id = auth.uid() then
    raise exception 'Не може да го блокираш сопствениот профил.'
      using errcode = '22023';
  end if;

  update public.profiles
  set active = p_active
  where id = p_target_user_id
  returning * into v_profile;

  if not found then
    raise exception 'Корисникот не постои.'
      using errcode = 'P0002';
  end if;

  insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    'user.access_changed',
    'user',
    p_target_user_id::text,
    jsonb_build_object(
      'email', v_profile.email,
      'active', p_active,
      'access', case when p_active then 'unblocked' else 'blocked' end
    )
  );

  return v_profile;
end;
$$;

revoke all on function public.set_user_access(uuid, boolean) from public;
grant execute on function public.set_user_access(uuid, boolean) to authenticated;

-- Send an open app an immediate access update when an admin blocks it.
alter table public.profiles replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end
$$;
