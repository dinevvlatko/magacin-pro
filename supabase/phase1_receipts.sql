-- PHASE 1: normalized products, receipts and receipt items.
-- Run once in Supabase SQL Editor AFTER supabase/multi-user.sql.
-- This file has NOT been executed by Codex.

create extension if not exists pgcrypto;

create sequence if not exists public.receipt_number_seq;

create or replace function public.next_receipt_number()
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select 'PR-' || lpad(nextval('public.receipt_number_seq')::text, 4, '0');
$$;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9_-]*$'),
  name text not null check (btrim(name) <> ''),
  package_size integer not null check (package_size > 0),
  stock_units bigint not null default 0 check (stock_units >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default public.next_receipt_number(),
  receipt_date date not null default current_date,
  workers_team text not null default '',
  note text not null default '',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  packages integer not null default 0 check (packages >= 0),
  extra_pieces integer not null default 0 check (extra_pieces >= 0),
  total_units bigint not null check (total_units > 0),
  created_at timestamptz not null default now(),
  unique (receipt_id, product_id)
);

create index if not exists receipts_receipt_date_idx on public.receipts (receipt_date desc, number desc);
create index if not exists receipt_items_receipt_id_idx on public.receipt_items (receipt_id);
create index if not exists receipt_items_product_id_idx on public.receipt_items (product_id);

-- Seed the three current products from the existing shared warehouse totals.
insert into public.products (code, name, package_size, stock_units)
values
  (
    'p025',
    'Шише 0.250 мл',
    15,
    coalesce((select (state #>> '{warehouse,p025,total}')::bigint from public.shared_warehouse_state where id = 'main'), 0)
  ),
  (
    'p15',
    'БиБ 1,5 Л',
    6,
    coalesce((select (state #>> '{warehouse,p15,total}')::bigint from public.shared_warehouse_state where id = 'main'), 0)
  ),
  (
    'flyers',
    'Флаери',
    1,
    coalesce((select (state #>> '{warehouse,flyers}')::bigint from public.shared_warehouse_state where id = 'main'), 0)
  )
on conflict (code) do update
set name = excluded.name,
    package_size = excluded.package_size,
    active = true,
    updated_at = now();

-- Import existing PR-xxxx receipt headers from the legacy JSON exactly once.
with legacy_movements as (
  select movement
  from public.shared_warehouse_state state_row
  cross join lateral jsonb_array_elements(coalesce(state_row.state -> 'movements', '[]'::jsonb)) movement
  where state_row.id = 'main'
    and movement ->> 'type' = 'Влез'
    and movement ->> 'orderNumber' ~ '^PR-[0-9]{4}$'
),
legacy_headers as (
  select
    movement ->> 'orderNumber' as number,
    min((movement ->> 'date')::date) as receipt_date,
    max(coalesce(movement ->> 'party', '')) as workers_team,
    max(coalesce(movement ->> 'note', '')) as note
  from legacy_movements
  group by movement ->> 'orderNumber'
)
insert into public.receipts (number, receipt_date, workers_team, note)
select number, receipt_date, workers_team, note
from legacy_headers
on conflict (number) do nothing;

-- Import the legacy receipt lines; the current stock was already seeded above.
with legacy_movements as (
  select movement
  from public.shared_warehouse_state state_row
  cross join lateral jsonb_array_elements(coalesce(state_row.state -> 'movements', '[]'::jsonb)) movement
  where state_row.id = 'main'
    and movement ->> 'type' = 'Влез'
    and movement ->> 'orderNumber' ~ '^PR-[0-9]{4}$'
),
legacy_lines as (
  select
    receipt.id as receipt_id,
    product.id as product_id,
    sum(coalesce((movement ->> 'packages')::integer, 0))::integer as packages,
    sum(coalesce((movement ->> 'pieces')::integer, 0))::integer as extra_pieces,
    sum(
      coalesce((movement ->> 'packages')::integer, 0) * product.package_size
      + coalesce((movement ->> 'pieces')::integer, 0)
    )::bigint as total_units
  from legacy_movements
  join public.receipts receipt on receipt.number = movement ->> 'orderNumber'
  join public.products product on product.code = movement ->> 'product'
  group by receipt.id, product.id
)
insert into public.receipt_items (receipt_id, product_id, packages, extra_pieces, total_units)
select receipt_id, product_id, packages, extra_pieces, total_units
from legacy_lines
where total_units > 0
on conflict (receipt_id, product_id) do nothing;

select setval(
  'public.receipt_number_seq',
  greatest(
    1,
    coalesce((select max(substring(number from 4)::bigint) + 1 from public.receipts where number ~ '^PR-[0-9]+$'), 1)
  ),
  false
);

alter table public.products enable row level security;
alter table public.receipts enable row level security;
alter table public.receipt_items enable row level security;

revoke all on table public.products, public.receipts, public.receipt_items from anon;
revoke all on table public.products, public.receipts, public.receipt_items from authenticated;
grant select on table public.products, public.receipts, public.receipt_items to authenticated;

drop policy if exists "Active users read products" on public.products;
create policy "Active users read products"
on public.products for select to authenticated
using ((select public.is_active_user()));

drop policy if exists "Active users read receipts" on public.receipts;
create policy "Active users read receipts"
on public.receipts for select to authenticated
using ((select public.is_active_user()));

drop policy if exists "Active users read receipt items" on public.receipt_items;
create policy "Active users read receipt items"
on public.receipt_items for select to authenticated
using ((select public.is_active_user()));

create or replace function public.apply_legacy_stock_delta(
  p_state jsonb,
  p_code text,
  p_delta bigint
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_total bigint;
  v_size integer;
begin
  if p_code = 'p025' then
    v_size := 15;
    v_total := coalesce((p_state #>> '{warehouse,p025,total}')::bigint, 0) + p_delta;
    if v_total < 0 then raise exception 'Измената би создала негативна залиха за Шише 0.250 мл.'; end if;
    p_state := jsonb_set(p_state, '{warehouse,p025,total}', to_jsonb(v_total), true);
    p_state := jsonb_set(p_state, '{warehouse,p025,packages}', to_jsonb(v_total / v_size), true);
    p_state := jsonb_set(p_state, '{warehouse,p025,pieces}', to_jsonb(v_total % v_size), true);
  elsif p_code = 'p15' then
    v_size := 6;
    v_total := coalesce((p_state #>> '{warehouse,p15,total}')::bigint, 0) + p_delta;
    if v_total < 0 then raise exception 'Измената би создала негативна залиха за БиБ 1,5 Л.'; end if;
    p_state := jsonb_set(p_state, '{warehouse,p15,total}', to_jsonb(v_total), true);
    p_state := jsonb_set(p_state, '{warehouse,p15,packages}', to_jsonb(v_total / v_size), true);
    p_state := jsonb_set(p_state, '{warehouse,p15,pieces}', to_jsonb(v_total % v_size), true);
  elsif p_code = 'flyers' then
    v_total := coalesce((p_state #>> '{warehouse,flyers}')::bigint, 0) + p_delta;
    if v_total < 0 then raise exception 'Измената би создала негативна залиха за Флаери.'; end if;
    p_state := jsonb_set(p_state, '{warehouse,flyers}', to_jsonb(v_total), true);
  end if;
  return p_state;
end;
$$;

create or replace function public.create_receipt_atomic(
  p_receipt_date date,
  p_workers_team text,
  p_note text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_receipt public.receipts%rowtype;
  v_state jsonb;
  v_new_movements jsonb := '[]'::jsonb;
  v_item_count integer;
  v_product_count integer;
  v_quantity bigint;
  v_line record;
begin
  if not public.is_active_user() then raise exception 'Немате активен кориснички пристап.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Приемницата мора да има најмалку една ставка.';
  end if;

  select count(*), count(distinct item.product_id)
  into v_item_count, v_product_count
  from jsonb_to_recordset(p_items) as item(product_id uuid, packages integer, extra_pieces integer);
  if v_item_count <> v_product_count then raise exception 'Истиот производ не може да биде внесен двапати.'; end if;

  perform product.id
  from public.products product
  where product.id in (select item.product_id from jsonb_to_recordset(p_items) as item(product_id uuid))
  order by product.id
  for update;

  select count(*)
  into v_product_count
  from public.products product
  join jsonb_to_recordset(p_items) as item(product_id uuid, packages integer, extra_pieces integer)
    on item.product_id = product.id
  where product.active
    and item.packages >= 0
    and item.extra_pieces >= 0
    and (product.package_size = 1 or item.extra_pieces < product.package_size);
  if v_product_count <> v_item_count then raise exception 'Една или повеќе ставки не се валидни.'; end if;

  select coalesce(sum(item.packages * product.package_size + item.extra_pieces), 0)
  into v_quantity
  from jsonb_to_recordset(p_items) as item(product_id uuid, packages integer, extra_pieces integer)
  join public.products product on product.id = item.product_id;
  if v_quantity <= 0 then raise exception 'Најмалку една ставка мора да има количина поголема од нула.'; end if;

  select state into v_state
  from public.shared_warehouse_state
  where id = 'main'
  for update;
  if v_state is null then raise exception 'Заедничкиот магацин не е иницијализиран.'; end if;

  insert into public.receipts (receipt_date, workers_team, note, created_by)
  values (p_receipt_date, btrim(coalesce(p_workers_team, '')), btrim(coalesce(p_note, '')), auth.uid())
  returning * into v_receipt;

  insert into public.receipt_items (receipt_id, product_id, packages, extra_pieces, total_units)
  select
    v_receipt.id,
    item.product_id,
    item.packages,
    item.extra_pieces,
    item.packages * product.package_size + item.extra_pieces
  from jsonb_to_recordset(p_items) as item(product_id uuid, packages integer, extra_pieces integer)
  join public.products product on product.id = item.product_id
  where item.packages * product.package_size + item.extra_pieces > 0;

  for v_line in
    select
      product.id,
      product.code,
      product.package_size,
      item.packages,
      item.extra_pieces,
      item.packages * product.package_size + item.extra_pieces as total_units
    from jsonb_to_recordset(p_items) as item(product_id uuid, packages integer, extra_pieces integer)
    join public.products product on product.id = item.product_id
    where item.packages * product.package_size + item.extra_pieces > 0
    order by product.id
  loop
    update public.products
    set stock_units = stock_units + v_line.total_units,
        updated_at = now()
    where id = v_line.id;
    v_state := public.apply_legacy_stock_delta(v_state, v_line.code, v_line.total_units);
    if v_line.code in ('p025', 'p15', 'flyers') then
      v_new_movements := v_new_movements || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text,
        'date', p_receipt_date::text,
        'product', v_line.code,
        'type', 'Влез',
        'packages', v_line.packages,
        'pieces', v_line.extra_pieces,
        'party', btrim(coalesce(p_workers_team, '')),
        'orderNumber', v_receipt.number,
        'note', btrim(coalesce(p_note, ''))
      ));
    end if;
  end loop;

  v_state := jsonb_set(v_state, '{movements}', v_new_movements || coalesce(v_state -> 'movements', '[]'::jsonb), true);
  update public.shared_warehouse_state
  set state = v_state,
      updated_at = clock_timestamp(),
      updated_by = auth.uid()
  where id = 'main';

  return jsonb_build_object('id', v_receipt.id, 'number', v_receipt.number);
end;
$$;

create or replace function public.update_receipt_atomic(
  p_receipt_id uuid,
  p_receipt_date date,
  p_workers_team text,
  p_note text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_receipt public.receipts%rowtype;
  v_state jsonb;
  v_new_movements jsonb := '[]'::jsonb;
  v_item_count integer;
  v_product_count integer;
  v_quantity bigint;
  v_delta record;
begin
  if not public.is_active_user() then raise exception 'Немате активен кориснички пристап.'; end if;
  select * into v_receipt from public.receipts where id = p_receipt_id for update;
  if not found then raise exception 'Приемницата не постои.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Приемницата мора да има најмалку една ставка.';
  end if;

  select count(*), count(distinct item.product_id)
  into v_item_count, v_product_count
  from jsonb_to_recordset(p_items) as item(product_id uuid, packages integer, extra_pieces integer);
  if v_item_count <> v_product_count then raise exception 'Истиот производ не може да биде внесен двапати.'; end if;

  perform product.id
  from public.products product
  where product.id in (
    select product_id from public.receipt_items where receipt_id = p_receipt_id
    union
    select item.product_id from jsonb_to_recordset(p_items) as item(product_id uuid)
  )
  order by product.id
  for update;

  select count(*)
  into v_product_count
  from public.products product
  join jsonb_to_recordset(p_items) as item(product_id uuid, packages integer, extra_pieces integer)
    on item.product_id = product.id
  where product.active
    and item.packages >= 0
    and item.extra_pieces >= 0
    and (product.package_size = 1 or item.extra_pieces < product.package_size);
  if v_product_count <> v_item_count then raise exception 'Една или повеќе ставки не се валидни.'; end if;

  select coalesce(sum(item.packages * product.package_size + item.extra_pieces), 0)
  into v_quantity
  from jsonb_to_recordset(p_items) as item(product_id uuid, packages integer, extra_pieces integer)
  join public.products product on product.id = item.product_id;
  if v_quantity <= 0 then raise exception 'Најмалку една ставка мора да има количина поголема од нула.'; end if;

  select state into v_state
  from public.shared_warehouse_state
  where id = 'main'
  for update;
  if v_state is null then raise exception 'Заедничкиот магацин не е иницијализиран.'; end if;

  for v_delta in
    with old_totals as (
      select product_id, sum(total_units)::bigint as total_units
      from public.receipt_items
      where receipt_id = p_receipt_id
      group by product_id
    ),
    new_totals as (
      select item.product_id, sum(item.packages * product.package_size + item.extra_pieces)::bigint as total_units
      from jsonb_to_recordset(p_items) as item(product_id uuid, packages integer, extra_pieces integer)
      join public.products product on product.id = item.product_id
      group by item.product_id
    )
    select
      product.id,
      product.code,
      product.package_size,
      coalesce(new_totals.total_units, 0) - coalesce(old_totals.total_units, 0) as delta_units
    from old_totals
    full join new_totals using (product_id)
    join public.products product on product.id = coalesce(old_totals.product_id, new_totals.product_id)
    where coalesce(new_totals.total_units, 0) <> coalesce(old_totals.total_units, 0)
    order by product.id
  loop
    if (select stock_units from public.products where id = v_delta.id) + v_delta.delta_units < 0 then
      raise exception 'Измената би создала негативна залиха за %.', v_delta.code;
    end if;
    update public.products
    set stock_units = stock_units + v_delta.delta_units,
        updated_at = now()
    where id = v_delta.id;
    v_state := public.apply_legacy_stock_delta(v_state, v_delta.code, v_delta.delta_units);
    if v_delta.code in ('p025', 'p15', 'flyers') then
      v_new_movements := v_new_movements || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text,
        'date', p_receipt_date::text,
        'product', v_delta.code,
        'type', 'Корекција',
        'packages', v_delta.delta_units / v_delta.package_size,
        'pieces', v_delta.delta_units % v_delta.package_size,
        'party', btrim(coalesce(p_workers_team, '')),
        'orderNumber', v_receipt.number,
        'note', 'Разлика од измена на приемница. ' || btrim(coalesce(p_note, ''))
      ));
    end if;
  end loop;

  delete from public.receipt_items where receipt_id = p_receipt_id;
  insert into public.receipt_items (receipt_id, product_id, packages, extra_pieces, total_units)
  select
    p_receipt_id,
    item.product_id,
    item.packages,
    item.extra_pieces,
    item.packages * product.package_size + item.extra_pieces
  from jsonb_to_recordset(p_items) as item(product_id uuid, packages integer, extra_pieces integer)
  join public.products product on product.id = item.product_id
  where item.packages * product.package_size + item.extra_pieces > 0;

  update public.receipts
  set receipt_date = p_receipt_date,
      workers_team = btrim(coalesce(p_workers_team, '')),
      note = btrim(coalesce(p_note, '')),
      updated_at = now()
  where id = p_receipt_id;

  if jsonb_array_length(v_new_movements) > 0 then
    v_state := jsonb_set(v_state, '{movements}', v_new_movements || coalesce(v_state -> 'movements', '[]'::jsonb), true);
  end if;
  update public.shared_warehouse_state
  set state = v_state,
      updated_at = clock_timestamp(),
      updated_by = auth.uid()
  where id = 'main';

  return jsonb_build_object('id', v_receipt.id, 'number', v_receipt.number);
end;
$$;

revoke all on function public.next_receipt_number() from public;
revoke all on function public.apply_legacy_stock_delta(jsonb, text, bigint) from public;
revoke all on function public.create_receipt_atomic(date, text, text, jsonb) from public;
revoke all on function public.update_receipt_atomic(uuid, date, text, text, jsonb) from public;
grant execute on function public.create_receipt_atomic(date, text, text, jsonb) to authenticated;
grant execute on function public.update_receipt_atomic(uuid, date, text, text, jsonb) to authenticated;

