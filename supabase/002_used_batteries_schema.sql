-- Power Baterias × WS Baterias
-- 002: Operação de baterias consignadas e acertos após venda.
-- EXECUTAR SOMENTE NO NOVO PROJETO SUPABASE, DEPOIS DE setup-auth.sql.
-- Ainda não conectar dados reais antes dos testes e homologação.
-- Valores monetários são armazenados em CENTAVOS (bigint).
-- Este script não apaga dados; não modifica a instalação antiga Power Baterias.

begin;

-- Reusa a autorização Google já existente no novo projeto.
create or replace function public.current_app_role()
returns text
language sql
stable security definer
set search_path = ''
as $role$
  select a.role
  from public.authorized_users a
  join auth.users u on lower(btrim(u.email)) = a.email
  join auth.identities i on i.user_id = u.id and i.provider = 'google'
  where u.id = auth.uid()
    and u.email_confirmed_at is not null
    and a.active = true
  limit 1;
$role$;
revoke all on function public.current_app_role() from public, anon;
grant execute on function public.current_app_role() to authenticated;

create sequence if not exists public.used_battery_code_seq start with 1;

create table if not exists public.used_batteries (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  brand text not null check (char_length(btrim(brand)) between 1 and 100),
  model text not null check (char_length(btrim(model)) between 1 and 120),
  amperage_ah integer check (amperage_ah between 1 and 500),
  serial_number text,
  -- preço acordado de repasse à Power: SEM pagamento até haver venda
  transfer_price_cents bigint not null check (transfer_price_cents > 0),
  recovery_cost_cents bigint not null default 0 check (recovery_cost_cents >= 0),
  asking_price_cents bigint not null check (asking_price_cents >= 0),
  status text not null default 'received'
    check (status in ('received','restoring','available','sold','discarded')),
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.used_battery_sales (
  id uuid primary key default gen_random_uuid(),
  battery_id uuid not null unique references public.used_batteries(id),
  customer_name text not null check (char_length(btrim(customer_name)) between 1 and 160),
  customer_phone text,
  vehicle_plate text,
  sale_price_cents bigint not null check (sale_price_cents > 0),
  payment_method text not null check (payment_method in ('pix','cash','card','other')),
  warranty_days integer not null default 30 check (warranty_days between 0 and 365),
  sold_by uuid not null references auth.users(id),
  sold_at timestamptz not null default now(),
  notes text
);

-- Um acerto para cada bateria vendida. Antes da venda não existe obrigação.
create table if not exists public.used_battery_settlements (
  id uuid primary key default gen_random_uuid(),
  battery_id uuid not null unique references public.used_batteries(id),
  sale_id uuid not null unique references public.used_battery_sales(id),
  owed_cents bigint not null check (owed_cents > 0),
  paid_cents bigint not null default 0 check (paid_cents >= 0),
  waived_cents bigint not null default 0 check (waived_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settlement_balance_valid check (paid_cents + waived_cents <= owed_cents)
);

-- Auditoria imutável via funções de servidor (nenhuma atualização/deleção do cliente).
create table if not exists public.used_battery_activity (
  id uuid primary key default gen_random_uuid(),
  battery_id uuid not null references public.used_batteries(id),
  action text not null check (action in ('received','edited','sold')),
  description text,
  actor_id uuid not null references auth.users(id),
  occurred_at timestamptz not null default now()
);

create table if not exists public.used_settlement_events (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.used_battery_settlements(id),
  action text not null
    check (action in ('created','payment','payment_correction','amount_adjustment','waiver','reopen')),
  old_owed_cents bigint not null,
  new_owed_cents bigint not null,
  old_paid_cents bigint not null,
  new_paid_cents bigint not null,
  old_waived_cents bigint not null,
  new_waived_cents bigint not null,
  reason text not null,
  actor_id uuid not null references auth.users(id),
  occurred_at timestamptz not null default now()
);

create index if not exists used_batteries_status_idx on public.used_batteries(status);
create index if not exists used_sales_date_idx on public.used_battery_sales(sold_at desc);
create index if not exists used_settlement_events_ref_idx on public.used_settlement_events(settlement_id, occurred_at desc);
create index if not exists used_battery_activity_ref_idx on public.used_battery_activity(battery_id, occurred_at desc);

-- Não permitir operações diretas nas tabelas; apenas leitura autenticada e
-- escritas pelas funções de negócio que checam o papel antes de modificar.
alter table public.used_batteries enable row level security;
alter table public.used_battery_sales enable row level security;
alter table public.used_battery_settlements enable row level security;
alter table public.used_settlement_events enable row level security;
alter table public.used_battery_activity enable row level security;

revoke all on public.used_batteries, public.used_battery_sales,
  public.used_battery_settlements, public.used_settlement_events,
  public.used_battery_activity from public, anon, authenticated;

grant select on public.used_batteries, public.used_battery_sales,
  public.used_battery_settlements, public.used_settlement_events,
  public.used_battery_activity to authenticated;

create policy "authorized read batteries" on public.used_batteries
  for select to authenticated using ((select public.is_authorized_user()));
create policy "authorized read sales" on public.used_battery_sales
  for select to authenticated using ((select public.is_authorized_user()));
create policy "authorized read settlements" on public.used_battery_settlements
  for select to authenticated using ((select public.is_authorized_user()));
create policy "authorized read settlement events" on public.used_settlement_events
  for select to authenticated using ((select public.is_authorized_user()));
create policy "authorized read battery events" on public.used_battery_activity
  for select to authenticated using ((select public.is_authorized_user()));

commit;
