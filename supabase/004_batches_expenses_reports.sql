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
  if p_new_amount_cents is null or p_new_amount_cents < 0 then
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
