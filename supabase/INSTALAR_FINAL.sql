-- INSTALAÇÃO DA OPERAÇÃO POWER × WS — SOMENTE NO PROJETO SUPABASE NOVO
-- Pré-requisito: setup-auth.sql já executado e três contas autorizadas.
-- Execute este arquivo uma única vez no SQL Editor. Se falhar, informe a mensagem;
-- NÃO tente reaplicar cegamente (algumas policies não são idempotentes).
-- NÃO ALTERA E NEM SE CONECTA AO PROJETO ANTIGO POWER BATERIAS.


-- ===== ARQUIVO supabase/002_used_batteries_schema.sql =====

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


-- ===== ARQUIVO supabase/003_used_batteries_operations.sql =====

-- Power Baterias × WS Baterias
-- 003: Funções transacionais de cadastro, venda e acerto.
-- Executar DEPOIS de 002_used_batteries_schema.sql, no projeto NOVO.
-- O app não pode editar vendas/acertos diretamente: somente via RPC segura.
begin;

-- Operação: WS / administrador podem cadastrar bateria recebida.
-- Não há dívida ao Sandro até o momento da venda.
create or replace function public.register_used_battery(
  p_brand text,
  p_model text,
  p_transfer_price_cents bigint,
  p_asking_price_cents bigint,
  p_amperage_ah integer default null,
  p_serial_number text default null,
  p_notes text default null,
  p_recovery_cost_cents bigint default 0
) returns uuid
language plpgsql
security definer
set search_path = ''
as $func$
declare
  v_id uuid;
begin
  if public.current_app_role() not in ('ws','admin') or public.current_app_role() is null then
    raise exception 'Acesso negado: somente WS ou administrador cadastram baterias';
  end if;
  if p_brand is null or btrim(p_brand) = '' or char_length(p_brand) > 100
     or p_model is null or btrim(p_model) = '' or char_length(p_model) > 120 then
    raise exception 'Marca e modelo são obrigatórios e devem ser curtos';
  end if;
  if p_transfer_price_cents is null or p_transfer_price_cents <= 0
     or p_recovery_cost_cents is null or p_recovery_cost_cents < 0
     or p_asking_price_cents is null or p_asking_price_cents < 0 then
    raise exception 'Os preços informados são inválidos';
  end if;
  insert into public.used_batteries (
    code, brand, model, amperage_ah, serial_number,
    transfer_price_cents, recovery_cost_cents, asking_price_cents, notes, created_by
  )
  values (
    'WS-' || lpad(nextval('public.used_battery_code_seq')::text, 6, '0'),
    btrim(p_brand), btrim(p_model), p_amperage_ah, nullif(btrim(p_serial_number), ''),
    p_transfer_price_cents, p_recovery_cost_cents, p_asking_price_cents, p_notes, auth.uid()
  )
  returning id into v_id;

  insert into public.used_battery_activity (battery_id, action, description, actor_id)
  values (v_id, 'received', 'Bateria recebida da Power; acerto nasce apenas após venda', auth.uid());
  return v_id;
end;
$func$;

-- WS / administrador: prepara e altera bateria, nunca após venda ou descarte.
create or replace function public.update_used_battery(
  p_battery_id uuid,
  p_status text,
  p_transfer_price_cents bigint,
  p_recovery_cost_cents bigint,
  p_asking_price_cents bigint,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  v_battery public.used_batteries%rowtype;
begin
  if public.current_app_role() not in ('ws','admin') or public.current_app_role() is null then
    raise exception 'Acesso negado';
  end if;
  select * into v_battery from public.used_batteries where id = p_battery_id for update;
  if not found then raise exception 'Bateria não encontrada'; end if;
  if v_battery.status in ('sold','discarded') then
    raise exception 'Essa bateria está encerrada e não pode ser alterada';
  end if;
  if p_status not in ('received','restoring','available','discarded') or p_status is null then
    raise exception 'Situação inválida';
  end if;
  if p_transfer_price_cents is null or p_transfer_price_cents <= 0
     or p_recovery_cost_cents is null or p_recovery_cost_cents < 0
     or p_asking_price_cents is null or p_asking_price_cents < 0 then
    raise exception 'Os valores não podem ser negativos';
  end if;

  update public.used_batteries
  set status = p_status,
      transfer_price_cents = p_transfer_price_cents,
      recovery_cost_cents = p_recovery_cost_cents,
      asking_price_cents = p_asking_price_cents,
      notes = coalesce(p_note, notes),
      updated_at = now()
  where id = p_battery_id;

  insert into public.used_battery_activity (battery_id, action, description, actor_id)
  values (
    p_battery_id, 'edited',
    'Anterior: ' || v_battery.status || ', repasse ' ||
    v_battery.transfer_price_cents || ', recuperação ' || v_battery.recovery_cost_cents ||
    ', venda ' || v_battery.asking_price_cents ||
    ' | Novo: ' || p_status || ', repasse ' || p_transfer_price_cents ||
    ', recuperação ' || p_recovery_cost_cents || ', venda ' || p_asking_price_cents ||
    coalesce(' | ' || nullif(btrim(p_note), ''), ''),
    auth.uid()
  );
end;
$func$;

-- Venda + baixa do estoque + acerto PENDENTE, tudo na mesma transação.
-- FOR UPDATE + UNIQUE(battery_id) impedem vender duas vezes por concorrência.
create or replace function public.register_used_battery_sale(
  p_battery_id uuid,
  p_customer_name text,
  p_sale_price_cents bigint,
  p_payment_method text,
  p_warranty_days integer default 30,
  p_customer_phone text default null,
  p_vehicle_plate text default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $func$
declare
  v_battery public.used_batteries%rowtype;
  v_sale_id uuid;
  v_settlement_id uuid;
begin
  if public.current_app_role() not in ('ws','admin') or public.current_app_role() is null then
    raise exception 'Acesso negado: somente WS ou administrador registram vendas';
  end if;
  if p_customer_name is null or btrim(p_customer_name) = ''
     or char_length(p_customer_name) > 160 then
    raise exception 'Informe o nome do cliente';
  end if;
  if p_sale_price_cents is null or p_sale_price_cents <= 0 then
    raise exception 'Valor de venda inválido';
  end if;
  if p_payment_method not in ('pix','cash','card','other') or p_payment_method is null then
    raise exception 'Forma de pagamento inválida';
  end if;
  if p_warranty_days is null or p_warranty_days not between 0 and 365 then
    raise exception 'Prazo de garantia inválido';
  end if;

  select * into v_battery
  from public.used_batteries
  where id = p_battery_id
  for update;

  if not found then raise exception 'Bateria não encontrada'; end if;
  if v_battery.status <> 'available' then
    raise exception 'A bateria precisa estar disponível antes de ser vendida';
  end if;

  insert into public.used_battery_sales (
    battery_id, customer_name, customer_phone, vehicle_plate,
    sale_price_cents, payment_method, warranty_days, sold_by, notes
  )
  values (
    p_battery_id, btrim(p_customer_name), nullif(btrim(p_customer_phone), ''),
    nullif(btrim(p_vehicle_plate), ''), p_sale_price_cents,
    p_payment_method, p_warranty_days, auth.uid(), p_notes
  ) returning id into v_sale_id;

  update public.used_batteries
    set status = 'sold', updated_at = now()
    where id = p_battery_id;

  -- Somente AQUI surge o acerto devido à Power Baterias.
  insert into public.used_battery_settlements
    (battery_id, sale_id, owed_cents, paid_cents, waived_cents)
  values (p_battery_id, v_sale_id, v_battery.transfer_price_cents, 0, 0)
  returning id into v_settlement_id;

  insert into public.used_settlement_events (
    settlement_id, action, old_owed_cents, new_owed_cents,
    old_paid_cents, new_paid_cents, old_waived_cents, new_waived_cents,
    reason, actor_id
  ) values (
    v_settlement_id, 'created', 0, v_battery.transfer_price_cents,
    0, 0, 0, 0, 'Acerto gerado automaticamente ao vender a bateria', auth.uid()
  );
  insert into public.used_battery_activity (battery_id, action, description, actor_id)
  values (p_battery_id, 'sold', 'Venda registrada e acerto criado', auth.uid());

  return v_sale_id;
end;
$func$;

-- Sandro (power) / Arthur (admin) controlam o acerto após a venda.
-- action:
--   payment       -> registra pagamento, parcial ou completo (+centavos)
--   correct_paid  -> corrige valor pago com delta assinado (+ ou -), exige motivo
--   adjust_owed   -> revisa valor TOTAL do acerto (não abaixo do já pago)
--   waive         -> dispensa saldo que falta, exige motivo
--   reopen        -> reabre acerto anteriormente dispensado, exige motivo
-- NUNCA apaga históricos ou registra acertos de bateria não vendida.
create or replace function public.manage_used_settlement(
  p_settlement_id uuid,
  p_action text,
  p_amount_cents bigint default null,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  v_old public.used_battery_settlements%rowtype;
  v_new_owed bigint;
  v_new_paid bigint;
  v_new_waived bigint;
  v_reason text;
  v_event text;
begin
  if public.current_app_role() not in ('power','admin') or public.current_app_role() is null then
    raise exception 'Acesso negado: somente Sandro ou administrador alteram acertos';
  end if;

  select * into v_old from public.used_battery_settlements
  where id = p_settlement_id for update;
  if not found then raise exception 'Acerto não encontrado'; end if;

  v_new_owed := v_old.owed_cents;
  v_new_paid := v_old.paid_cents;
  v_new_waived := v_old.waived_cents;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  case p_action
    when 'payment' then
      if p_amount_cents is null or p_amount_cents <= 0 then
        raise exception 'Informe um pagamento positivo';
      end if;
      if v_old.waived_cents > 0 then
        raise exception 'Acerto dispensado. Reabra antes de registrar pagamento';
      end if;
      if p_amount_cents > v_old.owed_cents - v_old.paid_cents then
        raise exception 'Pagamento maior que o saldo pendente';
      end if;
      v_new_paid := v_old.paid_cents + p_amount_cents;
      v_reason := coalesce(v_reason, 'Pagamento registrado por gestor Power');
      v_event := 'payment';

    when 'correct_paid' then
      if p_amount_cents is null or p_amount_cents = 0 then
        raise exception 'Informe o ajuste do pagamento (+/- centavos)';
      end if;
      if v_reason is null then
        raise exception 'Informe o motivo da correção de pagamento';
      end if;
      v_new_paid := v_old.paid_cents + p_amount_cents;
      if v_new_paid < 0 or v_new_paid + v_old.waived_cents > v_old.owed_cents then
        raise exception 'Correção ultrapassa os limites do acerto';
      end if;
      v_event := 'payment_correction';

    when 'adjust_owed' then
      if p_amount_cents is null or p_amount_cents <= 0 then
        raise exception 'Informe um valor positivo; para dispensar use a ação waive';
      end if;
      if v_reason is null then raise exception 'Informe o motivo do ajuste'; end if;
      if p_amount_cents < v_old.paid_cents + v_old.waived_cents then
        raise exception 'Valor novo não pode ser menor que o já pago ou dispensado';
      end if;
      if p_amount_cents = v_old.owed_cents then
        raise exception 'O valor já está igual ao informado';
      end if;
      v_new_owed := p_amount_cents;
      v_event := 'amount_adjustment';

    when 'waive' then
      if v_reason is null then raise exception 'Informe por que o acerto foi dispensado'; end if;
      if v_old.owed_cents <= v_old.paid_cents + v_old.waived_cents then
        raise exception 'Não há saldo para dispensar';
      end if;
      v_new_waived := v_old.owed_cents - v_old.paid_cents;
      v_event := 'waiver';

    when 'reopen' then
      if v_reason is null then raise exception 'Informe o motivo da reabertura'; end if;
      if v_old.waived_cents = 0 then
        raise exception 'Este acerto não está dispensado';
      end if;
      v_new_waived := 0;
      v_event := 'reopen';

    else
      raise exception 'Tipo de operação inválido';
  end case;

  update public.used_battery_settlements
  set owed_cents = v_new_owed, paid_cents = v_new_paid,
      waived_cents = v_new_waived, updated_at = now()
  where id = p_settlement_id;

  insert into public.used_settlement_events (
    settlement_id, action, old_owed_cents, new_owed_cents,
    old_paid_cents, new_paid_cents, old_waived_cents, new_waived_cents,
    reason, actor_id
  ) values (
    p_settlement_id, v_event, v_old.owed_cents, v_new_owed,
    v_old.paid_cents, v_new_paid, v_old.waived_cents, v_new_waived,
    v_reason, auth.uid()
  );
end;
$func$;

-- Fechar as permissões: chamadas REST RPC só para sessões autenticadas.
revoke all on function public.register_used_battery(text,text,bigint,bigint,integer,text,text,bigint) from public, anon;
revoke all on function public.update_used_battery(uuid,text,bigint,bigint,bigint,text) from public, anon;
revoke all on function public.register_used_battery_sale(uuid,text,bigint,text,integer,text,text,text) from public, anon;
revoke all on function public.manage_used_settlement(uuid,text,bigint,text) from public, anon;

grant execute on function public.register_used_battery(text,text,bigint,bigint,integer,text,text,bigint) to authenticated;
grant execute on function public.update_used_battery(uuid,text,bigint,bigint,bigint,text) to authenticated;
grant execute on function public.register_used_battery_sale(uuid,text,bigint,text,integer,text,text,text) to authenticated;
grant execute on function public.manage_used_settlement(uuid,text,bigint,text) to authenticated;

commit;


-- ===== ARQUIVO supabase/004_batches_expenses_reports.sql =====

-- 004 — Acertos em lote + despesas da WS + relatório mensal.
-- Executar no projeto NOVO depois de 002 e 003. Não executar na Power antiga.
-- Todo valor financeiro é em CENTAVOS. Não há pagamento ao cadastrar bateria.
begin;

create table if not exists public.used_settlement_batches (
  id uuid primary key default gen_random_uuid(),
  payment_method text not null check (payment_method in ('pix','cash','transfer','other')),
  reference text,
  notes text,
  total_paid_cents bigint not null check (total_paid_cents >= 0),
  total_waived_cents bigint not null check (total_waived_cents >= 0),
  created_by uuid not null references auth.users(id),
  settled_at timestamptz not null default now(),
  constraint batch_has_effect check (total_paid_cents + total_waived_cents > 0)
);

create table if not exists public.used_settlement_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.used_settlement_batches(id),
  settlement_id uuid not null references public.used_battery_settlements(id),
  old_owed_cents bigint not null,
  new_owed_cents bigint not null,
  paid_now_cents bigint not null check (paid_now_cents >= 0),
  waived_now_cents bigint not null check (waived_now_cents >= 0),
  reason text,
  unique (batch_id, settlement_id)
);

alter table public.used_settlement_events
  add column if not exists batch_id uuid references public.used_settlement_batches(id);

create table if not exists public.ws_expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null
    check (category in ('gasoline','delivery','recovery_parts','materials','other')),
  amount_cents bigint not null check (amount_cents > 0),
  spent_on date not null,
  description text not null check (char_length(btrim(description)) between 2 and 300),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.ws_expense_events (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.ws_expenses(id),
  action text not null check (action in ('created','corrected')),
  old_amount_cents bigint,
  new_amount_cents bigint not null check (new_amount_cents >= 0),
  reason text not null,
  actor_id uuid not null references auth.users(id),
  occurred_at timestamptz not null default now()
);

create index if not exists ws_expenses_date_idx on public.ws_expenses(spent_on desc);
create index if not exists used_settlement_batches_date_idx on public.used_settlement_batches(settled_at desc);
create index if not exists used_batch_items_ref_idx on public.used_settlement_batch_items(settlement_id);
create index if not exists used_settlement_events_batch_idx on public.used_settlement_events(batch_id);

alter table public.used_settlement_batches enable row level security;
alter table public.used_settlement_batch_items enable row level security;
alter table public.ws_expenses enable row level security;
alter table public.ws_expense_events enable row level security;

revoke all on public.used_settlement_batches, public.used_settlement_batch_items,
  public.ws_expenses, public.ws_expense_events from public, anon, authenticated;
grant select on public.used_settlement_batches, public.used_settlement_batch_items,
  public.ws_expenses, public.ws_expense_events to authenticated;

create policy "authorized batches read" on public.used_settlement_batches
  for select to authenticated using ((select public.is_authorized_user()));
create policy "authorized batch items read" on public.used_settlement_batch_items
  for select to authenticated using ((select public.is_authorized_user()));
create policy "ws expense read" on public.ws_expenses
  for select to authenticated using ((select public.current_app_role()) in ('ws','admin'));
create policy "ws expense events read" on public.ws_expense_events
  for select to authenticated using ((select public.current_app_role()) in ('ws','admin'));

-- Seleção: [{ "settlement_id": "uuid", "new_owed_cents": 7000,
--              "paid_now_cents": 7000, "waive_remaining": false,
--              "reason": "Revisão com o Sandro" }, ...]
-- Todas as baterias do lote devem terminar sem saldo pendente.
-- Validação, bloqueio e commit do lote ocorrem em uma só transação.
create or replace function public.settle_used_batteries_batch(
  p_items jsonb,
  p_payment_method text,
  p_reference text default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $func$
declare
  v_item jsonb;
  v_old public.used_battery_settlements%rowtype;
  v_batch_id uuid;
  v_id uuid;
  v_new_owed bigint;
  v_to_pay bigint;
  v_to_waive bigint;
  v_open bigint;
  v_total_paid bigint := 0;
  v_total_waived bigint := 0;
  v_reason text;
  v_waive boolean;
  v_count int;
begin
  if public.current_app_role() not in ('power','admin') then
    raise exception 'Apenas Sandro ou administrador podem confirmar acertos';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'Selecione entre 1 e 100 baterias';
  end if;
  if p_payment_method not in ('pix','cash','transfer','other') or p_payment_method is null then
    raise exception 'Forma de pagamento inválida';
  end if;
  select count(distinct item->>'settlement_id') into v_count
  from jsonb_array_elements(p_items) as item;
  if v_count <> jsonb_array_length(p_items) then
    raise exception 'Uma bateria não pode aparecer duas vezes no mesmo lote';
  end if;

  -- Um registro pai com totais atualizados apenas após todas as validações.
  -- A transação reverte por completo se qualquer linha falhar.
  insert into public.used_settlement_batches
    (payment_method, reference, notes, total_paid_cents, total_waived_cents, created_by)
  values (p_payment_method, nullif(btrim(p_reference), ''),
          nullif(btrim(p_notes), ''), 0, 1, auth.uid())
  returning id into v_batch_id;

  for v_item in
    select elem from jsonb_array_elements(p_items) elem
    order by elem->>'settlement_id'
  loop
    v_id := (v_item->>'settlement_id')::uuid;
    if v_id is null then raise exception 'ID do acerto ausente'; end if;
    select * into v_old from public.used_battery_settlements
      where id = v_id for update;
    if not found then raise exception 'Acerto não encontrado: %', v_id; end if;
    if v_old.owed_cents = v_old.paid_cents + v_old.waived_cents then
      raise exception 'Este acerto já está concluído: %', v_id;
    end if;

    v_new_owed := coalesce((v_item->>'new_owed_cents')::bigint, v_old.owed_cents);
    v_to_pay := coalesce((v_item->>'paid_now_cents')::bigint, 0);
    v_waive := coalesce((v_item->>'waive_remaining')::boolean, false);
    v_reason := nullif(btrim(coalesce(v_item->>'reason','')), '');

    if v_new_owed <= 0 or v_new_owed < v_old.paid_cents + v_old.waived_cents then
      raise exception 'Valor revisado incompatível com pagamentos anteriores';
    end if;
    v_open := v_new_owed - v_old.paid_cents - v_old.waived_cents;
    if v_to_pay < 0 or v_to_pay > v_open then
      raise exception 'Pagamento inválido para o acerto %', v_id;
    end if;
    v_to_waive := case when v_waive then v_open - v_to_pay else 0 end;
    if v_to_pay + v_to_waive <> v_open then
      raise exception 'O lote deve liquidar integralmente cada bateria selecionada';
    end if;
    if (v_new_owed <> v_old.owed_cents or v_to_waive > 0) and v_reason is null then
      raise exception 'Edição ou dispensa exige justificativa para o acerto %', v_id;
    end if;
    if v_new_owed <> v_old.owed_cents then
      insert into public.used_settlement_events (
        settlement_id, action, old_owed_cents, new_owed_cents,
        old_paid_cents, new_paid_cents, old_waived_cents,
        new_waived_cents, reason, actor_id, batch_id
      ) values (
        v_id, 'amount_adjustment', v_old.owed_cents, v_new_owed,
        v_old.paid_cents, v_old.paid_cents, v_old.waived_cents,
        v_old.waived_cents, v_reason, auth.uid(), v_batch_id
      );
    end if;

    if v_to_pay > 0 then
      insert into public.used_settlement_events (
        settlement_id, action, old_owed_cents, new_owed_cents,
        old_paid_cents, new_paid_cents, old_waived_cents,
        new_waived_cents, reason, actor_id, batch_id
      ) values (
        v_id, 'payment', v_new_owed, v_new_owed,
        v_old.paid_cents, v_old.paid_cents + v_to_pay,
        v_old.waived_cents, v_old.waived_cents,
        coalesce(v_reason,'Pagamento confirmado em lote'), auth.uid(), v_batch_id
      );
    end if;
    if v_to_waive > 0 then
      insert into public.used_settlement_events (
        settlement_id, action, old_owed_cents, new_owed_cents,
        old_paid_cents, new_paid_cents, old_waived_cents,
        new_waived_cents, reason, actor_id, batch_id
      ) values (
        v_id, 'waiver', v_new_owed, v_new_owed,
        v_old.paid_cents + v_to_pay, v_old.paid_cents + v_to_pay,
        v_old.waived_cents, v_old.waived_cents + v_to_waive,
        v_reason, auth.uid(), v_batch_id
      );
    end if;

    update public.used_battery_settlements
    set owed_cents = v_new_owed,
        paid_cents = v_old.paid_cents + v_to_pay,
        waived_cents = v_old.waived_cents + v_to_waive,
        updated_at = now()
    where id = v_id;

    insert into public.used_settlement_batch_items (
      batch_id, settlement_id, old_owed_cents, new_owed_cents,
      paid_now_cents, waived_now_cents, reason
    ) values (v_batch_id, v_id, v_old.owed_cents, v_new_owed,
              v_to_pay, v_to_waive, v_reason);

    v_total_paid := v_total_paid + v_to_pay;
    v_total_waived := v_total_waived + v_to_waive;
  end loop;

  update public.used_settlement_batches
    set total_paid_cents = v_total_paid,
        total_waived_cents = v_total_waived
    where id = v_batch_id;
  return v_batch_id;
end;
$func$;

-- Registra despesa operacional da WS (gasolina, peças etc).
create or replace function public.register_ws_expense(
  p_category text,
  p_amount_cents bigint,
  p_spent_on date,
  p_description text
) returns uuid
language plpgsql security definer set search_path = ''
as $func$
declare v_id uuid;
begin
  if public.current_app_role() not in ('ws','admin') then
    raise exception 'Apenas WS ou administrador cadastram despesas';
  end if;
  if p_category not in ('gasoline','delivery','recovery_parts','materials','other')
     or p_category is null then raise exception 'Categoria inválida'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Informe um valor positivo'; end if;
  if p_spent_on is null or p_spent_on > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Data de despesa inválida'; end if;
  if char_length(btrim(coalesce(p_description,''))) not between 2 and 300 then
    raise exception 'Descreva a despesa'; end if;
  insert into public.ws_expenses
    (category, amount_cents, spent_on, description, created_by)
  values (p_category, p_amount_cents, p_spent_on, btrim(p_description), auth.uid())
  returning id into v_id;

  insert into public.ws_expense_events
    (expense_id, action, old_amount_cents, new_amount_cents, reason, actor_id)
  values (v_id,'created',null,p_amount_cents,'Despesa lançada',auth.uid());
  return v_id;
end;
$func$;

-- Corrige uma despesa já lançada sem apagar o valor anterior.
create or replace function public.correct_ws_expense(
  p_expense_id uuid,
  p_new_amount_cents bigint,
  p_reason text
) returns void
language plpgsql security definer set search_path = ''
as $func$
declare v_old public.ws_expenses%rowtype;
begin
  if public.current_app_role() not in ('ws','admin') then
    raise exception 'Apenas WS ou administrador corrigem despesas'; end if;
  if p_new_amount_cents is null or p_new_amount_cents <= 0 then
    raise exception 'Valor incorreto'; end if;
  if char_length(btrim(coalesce(p_reason,''))) < 5 then
    raise exception 'Informe o motivo da correção'; end if;
  select * into v_old from public.ws_expenses
    where id=p_expense_id for update;
  if not found then raise exception 'Despesa inexistente'; end if;
  if v_old.amount_cents = p_new_amount_cents then
    raise exception 'O valor não foi alterado'; end if;
  update public.ws_expenses
    set amount_cents=p_new_amount_cents where id=p_expense_id;
  insert into public.ws_expense_events
    (expense_id,action,old_amount_cents,new_amount_cents,reason,actor_id)
  values (p_expense_id,'corrected',v_old.amount_cents,
          p_new_amount_cents,btrim(p_reason),auth.uid());
end;
$func$;

-- Retorna indicadores mensais. Os cálculos de lucro são ESTIMATIVOS
-- e distinguem receita da WS de valor que deve ser repassado à Power.
create or replace function public.get_power_ws_monthly_report(
  p_month date
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $func$
declare
  v_role text;
  v_start timestamptz;
  v_end timestamptz;
  v_from_date date;
  v_to_date date;
  v_count bigint;
  v_revenue bigint;
  v_repasse bigint;
  v_recovery bigint;
  v_expenses bigint;
  v_paid_month bigint;
  v_pending bigint;
  v_settled bigint;
begin
  v_role := public.current_app_role();
  if v_role is null then raise exception 'Acesso não autorizado'; end if;
  if p_month is null then raise exception 'Informe o mês'; end if;
  v_from_date := date_trunc('month', p_month::timestamp)::date;
  v_to_date := (v_from_date + interval '1 month')::date;
  v_start := v_from_date::timestamp at time zone 'America/Sao_Paulo';
  v_end := v_to_date::timestamp at time zone 'America/Sao_Paulo';

  select count(*),
    coalesce(sum(s.sale_price_cents),0),
    coalesce(sum(st.owed_cents - st.waived_cents),0),
    coalesce(sum(b.recovery_cost_cents),0),
    count(*) filter (where st.paid_cents + st.waived_cents = st.owed_cents)
  into v_count,v_revenue,v_repasse,v_recovery,v_settled
  from public.used_battery_sales s
    join public.used_batteries b on b.id=s.battery_id
    join public.used_battery_settlements st on st.sale_id=s.id
  where s.sold_at >= v_start and s.sold_at < v_end;

  select coalesce(sum(e.new_paid_cents - e.old_paid_cents),0)
  into v_paid_month from public.used_settlement_events e
  where e.occurred_at >= v_start and e.occurred_at < v_end;

  select coalesce(sum(owed_cents-paid_cents-waived_cents),0)
  into v_pending from public.used_battery_settlements;

  if v_role in ('ws','admin') then
    select coalesce(sum(amount_cents),0) into v_expenses
    from public.ws_expenses
    where spent_on >= v_from_date and spent_on < v_to_date;
  else
    v_expenses := null;
  end if;

  return jsonb_build_object(
    'month',to_char(v_from_date,'YYYY-MM'),
    'role',v_role,
    'sales_count',v_count,
    'sales_revenue_cents',v_revenue,
    'power_repasse_sales_month_cents',v_repasse,
    'recovery_cost_sales_month_cents',v_recovery,
    'ws_expenses_cents',v_expenses,
    'ws_estimated_profit_cents',
      case when v_expenses is null then null
      else v_revenue-v_repasse-v_recovery-v_expenses end,
    'power_received_in_month_cents',v_paid_month,
    'power_pending_total_now_cents',v_pending,
    'fully_settled_sales_in_month',v_settled
  );
end;
$func$;

revoke all on function public.settle_used_batteries_batch(jsonb,text,text,text)
  from public,anon;
revoke all on function public.register_ws_expense(text,bigint,date,text)
  from public,anon;
revoke all on function public.correct_ws_expense(uuid,bigint,text)
  from public,anon;
revoke all on function public.get_power_ws_monthly_report(date)
  from public,anon;

grant execute on function public.settle_used_batteries_batch(jsonb,text,text,text)
  to authenticated;
grant execute on function public.register_ws_expense(text,bigint,date,text)
  to authenticated;
grant execute on function public.correct_ws_expense(uuid,bigint,text)
  to authenticated;
grant execute on function public.get_power_ws_monthly_report(date)
  to authenticated;

commit;


-- ===== ARQUIVO supabase/005_staff_realtime.sql =====

-- 005 — Auditoria de usuário, permissões e atualização entre celulares.
-- Executar no Supabase da parceria DEPOIS de 002, 003 e 004.
-- Nunca executar no banco antigo Power Baterias.
begin;

-- Rótulo identificável dos operadores cadastrados.
-- Somente contas autorizadas veem esta lista restrita; não expõe tokens.
create or replace function public.get_power_ws_team()
returns table (id uuid, email text, role text)
language sql stable security definer
set search_path = ''
as $func$
  select u.id, u.email::text, a.role
  from public.authorized_users a
  join auth.users u on lower(btrim(u.email)) = lower(btrim(a.email))
  where a.active = true and public.current_app_role() is not null
  order by a.role;
$func$;
revoke all on function public.get_power_ws_team() from public, anon;
grant execute on function public.get_power_ws_team() to authenticated;

-- A identidade (auth.uid) é registrada no banco em todos os writes.
-- Tabelas de auditoria não têm políticas para insert/update/delete pelo cliente.
-- Endurecer a sequência: só as funções SECURITY DEFINER gravam códigos.
revoke all on sequence public.used_battery_code_seq from public, anon, authenticated;

-- Publicar alterações para os navegadores de Sandro, Wanderson e Arthur.
-- Se a publicação não existir neste ambiente, mantém polling no app como fallback.
do $realtime$
declare
  v_name text;
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach v_name in array array[
      'used_batteries','used_battery_sales','used_battery_settlements',
      'used_settlement_batches','used_settlement_batch_items',
      'used_settlement_events','used_battery_activity',
      'ws_expenses','ws_expense_events'
    ] loop
      if not exists(
        select 1 from pg_publication_tables
        where pubname='supabase_realtime' and schemaname='public' and tablename=v_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I',v_name);
      end if;
    end loop;
  end if;
end;
$realtime$;

commit;


-- ===== ARQUIVO supabase/006_direct_sale_no_stock.sql =====

-- 006 — Venda direta, sem estoque na operação.
-- WS lança bateria + cliente + valor vendido no mesmo formulário.
-- Uma transação gera venda, cadastro histórico da bateria e dívida pendente à Power.
-- Execute APENAS no Supabase pbEws, depois da migração 005.
begin;

-- Chave idempotente: evita duas vendas se o celular repetir a mesma solicitação.
alter table public.used_battery_sales
  add column if not exists client_request_id uuid;

create unique index if not exists used_battery_sale_request_unique
  on public.used_battery_sales(client_request_id)
  where client_request_id is not null;

create or replace function public.register_direct_battery_sale(
  p_request_id uuid,
  p_brand text,
  p_model text,
  p_transfer_price_cents bigint,
  p_recovery_cost_cents bigint,
  p_sale_price_cents bigint,
  p_customer_name text,
  p_payment_method text,
  p_warranty_days integer default 30,
  p_amperage_ah integer default null,
  p_serial_number text default null,
  p_customer_phone text default null,
  p_vehicle_plate text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_battery_id uuid;
  v_sale_id uuid;
  v_settlement_id uuid;
  v_existing_seller uuid;
begin
  if auth.uid() is null or public.current_app_role() not in ('ws','admin') then
    raise exception 'Apenas WS ou administrador podem lançar vendas';
  end if;
  if p_request_id is null then
    raise exception 'Identificador de lançamento obrigatório';
  end if;

  -- Evita que dois pedidos simultâneos com o mesmo identificador avancem juntos.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));
  select id, sold_by into v_sale_id, v_existing_seller
    from public.used_battery_sales
    where client_request_id = p_request_id;
  if found then
    if v_existing_seller <> auth.uid() then
      raise exception 'Identificador de venda já utilizado por outra conta';
    end if;
    return v_sale_id;
  end if;

  if char_length(btrim(coalesce(p_brand, ''))) not between 1 and 100
     or char_length(btrim(coalesce(p_model, ''))) not between 1 and 120 then
    raise exception 'Informe marca e modelo da bateria';
  end if;
  if p_amperage_ah is not null and p_amperage_ah not between 1 and 500 then
    raise exception 'Amperagem inválida';
  end if;
  if char_length(coalesce(p_serial_number, '')) > 120 then
    raise exception 'Número de série muito longo';
  end if;
  if p_transfer_price_cents is null or p_transfer_price_cents <= 0
     or p_recovery_cost_cents is null or p_recovery_cost_cents < 0
     or p_sale_price_cents is null or p_sale_price_cents <= 0 then
    raise exception 'Informe valores de venda e repasse válidos';
  end if;
  if char_length(btrim(coalesce(p_customer_name, ''))) not between 1 and 160 then
    raise exception 'Informe o nome do cliente';
  end if;
  if char_length(coalesce(p_customer_phone,'')) > 30
     or char_length(coalesce(p_vehicle_plate,'')) > 15
     or char_length(coalesce(p_notes,'')) > 1200 then
    raise exception 'Dados opcionais muito longos';
  end if;
  if p_payment_method not in ('pix','cash','card','other') or p_payment_method is null then
    raise exception 'Forma de pagamento inválida';
  end if;
  if p_warranty_days is null or p_warranty_days not between 0 and 365 then
    raise exception 'Garantia deve ser de 0 a 365 dias';
  end if;

  -- Registro histórico da bateria (já vendida, nunca criada como estoque).
  insert into public.used_batteries (
    code,brand,model,amperage_ah,serial_number,
    transfer_price_cents,recovery_cost_cents,asking_price_cents,
    status,notes,created_by
  ) values (
    'WS-' || lpad(nextval('public.used_battery_code_seq')::text,6,'0'),
    btrim(p_brand),btrim(p_model),p_amperage_ah,
    nullif(btrim(coalesce(p_serial_number,'')),''),
    p_transfer_price_cents,p_recovery_cost_cents,p_sale_price_cents,
    'sold',p_notes,auth.uid()
  ) returning id into v_battery_id;

  -- Hora e identidade reais são definidas pelo servidor.
  insert into public.used_battery_sales (
    battery_id,customer_name,customer_phone,vehicle_plate,
    sale_price_cents,payment_method,warranty_days,sold_by,notes,client_request_id
  ) values (
    v_battery_id,btrim(p_customer_name),
    nullif(btrim(coalesce(p_customer_phone,'')),''),
    nullif(btrim(coalesce(p_vehicle_plate,'')),''),
    p_sale_price_cents,p_payment_method,p_warranty_days,auth.uid(),
    p_notes,p_request_id
  ) returning id into v_sale_id;

  -- Acerto só surge quando a venda existe; nunca antes.
  insert into public.used_battery_settlements(
    battery_id,sale_id,owed_cents,paid_cents,waived_cents
  ) values (
    v_battery_id,v_sale_id,p_transfer_price_cents,0,0
  ) returning id into v_settlement_id;

  insert into public.used_settlement_events(
    settlement_id,action,old_owed_cents,new_owed_cents,
    old_paid_cents,new_paid_cents,old_waived_cents,new_waived_cents,
    reason,actor_id
  ) values (
    v_settlement_id,'created',0,p_transfer_price_cents,
    0,0,0,0,'Acerto gerado automaticamente com a venda direta',auth.uid()
  );

  insert into public.used_battery_activity(battery_id,action,description,actor_id)
  values (v_battery_id,'sold',
          'Bateria e venda registradas juntas; acerto pendente criado',
          auth.uid());

  return v_sale_id;
end;
$function$;

-- Remover a possibilidade de usar o fluxo antigo por API.
-- Tabelas históricas são preservadas para não perder vendas/acertos.
revoke execute on function public.register_used_battery(text,text,bigint,bigint,integer,text,text,bigint)
  from public,anon,authenticated;
revoke execute on function public.update_used_battery(uuid,text,bigint,bigint,bigint,text)
  from public,anon,authenticated;
revoke execute on function public.register_used_battery_sale(uuid,text,bigint,text,integer,text,text,text)
  from public,anon,authenticated;

revoke all on function public.register_direct_battery_sale(
  uuid,text,text,bigint,bigint,bigint,text,text,integer,integer,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.register_direct_battery_sale(
  uuid,text,text,bigint,bigint,bigint,text,text,integer,integer,text,text,text,text
) to authenticated;

commit;

