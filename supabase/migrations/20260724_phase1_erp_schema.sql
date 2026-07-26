-- Backup instructions before applying in production:
-- 1. pg_dump --schema=public --table=public.orders --table=public.receipts --table=public.products --table=public.order_items --table=public.receipt_items --no-owner --no-privileges > backup_before_phase1.sql
-- 2. Verify the source rows that will be migrated from legacy flattened order columns.
-- 3. Apply in a transaction against a staging or review environment first.
-- 4. Keep legacy columns intact until the post-migration validation is complete.

create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  package_size integer not null default 1,
  unit text not null default 'pieces',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_package_size_positive check (package_size >= 1)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  number text unique,
  client text not null default '',
  city text not null default '',
  date date not null default current_date,
  note text not null default '',
  status text not null default 'Чека залиха',
  packed jsonb not null default '{}'::jsonb,
  stock_deducted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  packages integer not null default 0,
  pieces integer not null default 0,
  free_packages integer not null default 0,
  free_pieces integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_items_packages_non_negative check (packages >= 0),
  constraint order_items_pieces_non_negative check (pieces >= 0),
  constraint order_items_free_packages_non_negative check (free_packages >= 0),
  constraint order_items_free_pieces_non_negative check (free_pieces >= 0),
  constraint order_items_no_duplicate_product unique (order_id, product_id)
);

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  number text unique,
  receipt_date date not null default current_date,
  workers text not null default '',
  note text not null default '',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  packages integer not null default 0,
  pieces integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint receipt_items_packages_non_negative check (packages >= 0),
  constraint receipt_items_pieces_non_negative check (pieces >= 0),
  constraint receipt_items_no_duplicate_product unique (receipt_id, product_id)
);

alter table public.products
  add column if not exists code text,
  add column if not exists name text,
  add column if not exists package_size integer,
  add column if not exists unit text,
  add column if not exists active boolean,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

alter table public.orders
  add column if not exists number text,
  add column if not exists client text,
  add column if not exists city text,
  add column if not exists date date,
  add column if not exists note text,
  add column if not exists status text,
  add column if not exists packed jsonb,
  add column if not exists stock_deducted boolean,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

alter table public.order_items
  add column if not exists order_id uuid,
  add column if not exists product_id uuid,
  add column if not exists packages integer,
  add column if not exists pieces integer,
  add column if not exists free_packages integer,
  add column if not exists free_pieces integer,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

alter table public.receipts
  add column if not exists number text,
  add column if not exists receipt_date date,
  add column if not exists workers text,
  add column if not exists note text,
  add column if not exists created_by uuid,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

alter table public.receipt_items
  add column if not exists receipt_id uuid,
  add column if not exists product_id uuid,
  add column if not exists packages integer,
  add column if not exists pieces integer,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

alter table public.products
  alter column code set not null,
  alter column name set not null,
  alter column package_size set default 1,
  alter column unit set default 'pieces',
  alter column active set default true,
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table public.order_items
  alter column packages set default 0,
  alter column pieces set default 0,
  alter column free_packages set default 0,
  alter column free_pieces set default 0,
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table public.receipts
  alter column receipt_date set default current_date,
  alter column workers set default '',
  alter column note set default '',
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table public.receipt_items
  alter column packages set default 0,
  alter column pieces set default 0,
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table public.products
  add constraint if not exists products_package_size_positive check (package_size >= 1);

alter table public.order_items
  add constraint if not exists order_items_packages_non_negative check (packages >= 0),
  add constraint if not exists order_items_pieces_non_negative check (pieces >= 0),
  add constraint if not exists order_items_free_packages_non_negative check (free_packages >= 0),
  add constraint if not exists order_items_free_pieces_non_negative check (free_pieces >= 0);

alter table public.receipt_items
  add constraint if not exists receipt_items_packages_non_negative check (packages >= 0),
  add constraint if not exists receipt_items_pieces_non_negative check (pieces >= 0);

create unique index if not exists products_code_unique on public.products (code);
create unique index if not exists orders_number_unique on public.orders (number) where number is not null;
create unique index if not exists order_items_order_product_unique on public.order_items (order_id, product_id);
create unique index if not exists order_items_product_idx on public.order_items (product_id);
create unique index if not exists receipts_number_unique on public.receipts (number) where number is not null;
create unique index if not exists receipts_created_by_idx on public.receipts (created_by, receipt_date desc);
create unique index if not exists receipt_items_receipt_product_unique on public.receipt_items (receipt_id, product_id);
create unique index if not exists receipt_items_product_idx on public.receipt_items (product_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row
execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row
execute function public.set_updated_at();

drop trigger if exists order_items_set_updated_at on public.order_items;
create trigger order_items_set_updated_at
before update on public.order_items
for each row
execute function public.set_updated_at();

drop trigger if exists receipts_set_updated_at on public.receipts;
create trigger receipts_set_updated_at
before update on public.receipts
for each row
execute function public.set_updated_at();

drop trigger if exists receipt_items_set_updated_at on public.receipt_items;
create trigger receipt_items_set_updated_at
before update on public.receipt_items
for each row
execute function public.set_updated_at();

insert into public.products (code, name, package_size, unit, active, created_at, updated_at)
values
  ('p025', 'Шише 0.250 мл', 15, 'pieces', true, now(), now()),
  ('p15', 'БиБ 1.5 Л', 6, 'pieces', true, now(), now()),
  ('flyers', 'Флаери', 1, 'pieces', true, now(), now())
on conflict (code)
do update set
  name = excluded.name,
  package_size = excluded.package_size,
  unit = excluded.unit,
  active = excluded.active,
  updated_at = now();

alter table public.products enable row level security;
alter table public.order_items enable row level security;
alter table public.receipts enable row level security;
alter table public.receipt_items enable row level security;

revoke all on table public.products from anon;
revoke all on table public.order_items from anon;
revoke all on table public.receipts from anon;
revoke all on table public.receipt_items from anon;

grant select, insert, update, delete on table public.products to authenticated;
grant select, insert, update, delete on table public.order_items to authenticated;
grant select, insert, update, delete on table public.receipts to authenticated;
grant select, insert, update, delete on table public.receipt_items to authenticated;

drop policy if exists "Active users read products" on public.products;
create policy "Active users read products"
on public.products for select to authenticated
using (
  exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and active
  )
);

drop policy if exists "Active users write products" on public.products;
create policy "Active users write products"
on public.products for all to authenticated
using (
  exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and active
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and active
  )
);

drop policy if exists "Active users read order_items" on public.order_items;
create policy "Active users read order_items"
on public.order_items for select to authenticated
using (
  exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and active
  )
);

drop policy if exists "Active users write order_items" on public.order_items;
create policy "Active users write order_items"
on public.order_items for all to authenticated
using (
  exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and active
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and active
  )
);

drop policy if exists "Active users read receipts" on public.receipts;
create policy "Active users read receipts"
on public.receipts for select to authenticated
using (
  exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and active
  )
);

drop policy if exists "Active users write receipts" on public.receipts;
create policy "Active users write receipts"
on public.receipts for all to authenticated
using (
  exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and active
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and active
  )
);

drop policy if exists "Active users read receipt_items" on public.receipt_items;
create policy "Active users read receipt_items"
on public.receipt_items for select to authenticated
using (
  exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and active
  )
);

drop policy if exists "Active users write receipt_items" on public.receipt_items;
create policy "Active users write receipt_items"
on public.receipt_items for all to authenticated
using (
  exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and active
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and active
  )
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name in ('qty025', 'qty025Pieces', 'free025', 'free025Pieces')
  ) then
    execute '
      with source_order as (
        select o.id as order_id,
               p.id as product_id,
               o.qty025 as packages,
               o.qty025Pieces as pieces,
               o.free025 as free_packages,
               o.free025Pieces as free_pieces
        from public.orders o
        join public.products p on p.code = ''p025''
        where coalesce(o.qty025, 0) + coalesce(o.qty025Pieces, 0) + coalesce(o.free025, 0) + coalesce(o.free025Pieces, 0) > 0
      )
      insert into public.order_items (order_id, product_id, packages, pieces, free_packages, free_pieces, created_at, updated_at)
      select order_id, product_id, packages, pieces, free_packages, free_pieces, now(), now()
      from source_order
      on conflict (order_id, product_id)
      do update set
        packages = excluded.packages,
        pieces = excluded.pieces,
        free_packages = excluded.free_packages,
        free_pieces = excluded.free_pieces,
        updated_at = now();';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name in ('qty15', 'qty15Pieces', 'free15', 'free15Pieces')
  ) then
    execute '
      with source_order as (
        select o.id as order_id,
               p.id as product_id,
               o.qty15 as packages,
               o.qty15Pieces as pieces,
               o.free15 as free_packages,
               o.free15Pieces as free_pieces
        from public.orders o
        join public.products p on p.code = ''p15''
        where coalesce(o.qty15, 0) + coalesce(o.qty15Pieces, 0) + coalesce(o.free15, 0) + coalesce(o.free15Pieces, 0) > 0
      )
      insert into public.order_items (order_id, product_id, packages, pieces, free_packages, free_pieces, created_at, updated_at)
      select order_id, product_id, packages, pieces, free_packages, free_pieces, now(), now()
      from source_order
      on conflict (order_id, product_id)
      do update set
        packages = excluded.packages,
        pieces = excluded.pieces,
        free_packages = excluded.free_packages,
        free_pieces = excluded.free_pieces,
        updated_at = now();';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'flyers'
  ) then
    execute '
      with source_order as (
        select o.id as order_id,
               p.id as product_id,
               0 as packages,
               o.flyers as pieces,
               0 as free_packages,
               0 as free_pieces
        from public.orders o
        join public.products p on p.code = ''flyers''
        where coalesce(o.flyers, 0) > 0
      )
      insert into public.order_items (order_id, product_id, packages, pieces, free_packages, free_pieces, created_at, updated_at)
      select order_id, product_id, packages, pieces, free_packages, free_pieces, now(), now()
      from source_order
      on conflict (order_id, product_id)
      do update set
        packages = excluded.packages,
        pieces = excluded.pieces,
        free_packages = excluded.free_packages,
        free_pieces = excluded.free_pieces,
        updated_at = now();';
  end if;
end $$;

-- Keep the original table shape intact for backward compatibility during validation.
-- Legacy columns are intentionally not dropped in this migration.
