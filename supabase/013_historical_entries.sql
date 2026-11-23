-- 013: vendas e despesas antigas com data de negocio separada do cadastro.
-- Somente no Supabase pbEws; nenhum dado atual e apagado.
begin;
alter table public.used_battery_sales
  add column if not exists recorded_by uuid references auth.users(id),
  add column if not exists recorded_at timestamptz not null default now(),
  add column if not exists is_historical boolean not null default false;
update public.used_battery_sales set recorded_by=sold_by where recorded_by is null;
alter table public.used_battery_sales alter column recorded_by set not null;

alter table public.used_settlement_events
  add column if not exists effective_at timestamptz not null default now();
alter table public.used_settlement_events drop constraint used_settlement_events_action_check;
alter table public.used_settlement_events add constraint used_settlement_events_action_check
 check (action in ('created','payment','payment_correction','amount_adjustment',
                   'waiver','reopen','historical_payment'));

alter table public.ws_expenses
  add column if not exists spent_at timestamptz,
  add column if not exists is_historical boolean not null default false;

create or replace function public.register_historical_battery_sale(
  p_request_id uuid,
  p_sold_at_local timestamp without time zone,
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
  p_notes text default null,
  p_paid_at_local timestamp without time zone default null,
  p_prior_paid_cents bigint default 0
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
  v_sold_at timestamptz;
  v_paid_at timestamptz;
  v_role text;
begin
  v_role:=public.current_app_role();
  if auth.uid() is null or v_role not in ('ws','power','admin') then
    raise exception 'Somente a equipe autorizada pode importar vendas anteriores';
  end if;
  if p_sold_at_local is null then raise exception 'Informe data e horário da venda anterior'; end if;
  v_sold_at:=p_sold_at_local at time zone 'America/Sao_Paulo';
  if v_sold_at < '2000-01-01'::timestamptz or v_sold_at > now() then
    raise exception 'Venda histórica precisa ter uma data passada válida';
  end if;
  if p_prior_paid_cents is null or p_prior_paid_cents < 0 or
     (p_prior_paid_cents>0 and p_paid_at_local is null) or
     (p_prior_paid_cents=0 and p_paid_at_local is not null) then
    raise exception 'Informe a data do acerto antigo quando houver pagamento';
  end if;
  if p_prior_paid_cents > 0 then
    v_paid_at:=p_paid_at_local at time zone 'America/Sao_Paulo';
    if v_paid_at < v_sold_at or v_paid_at > now() then
      raise exception 'Pagamento antigo precisa ocorrer entre a venda e hoje';
    end if;
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

  if p_prior_paid_cents > p_transfer_price_cents then
    raise exception 'Pagamento antigo não pode superar o valor devido ao Sandro';
  end if;

  -- Cadastro técnico preservado para vincular venda, garantia e acerto.
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
    sale_price_cents,payment_method,warranty_days,sold_by,notes,client_request_id,
    sold_at,recorded_by,is_historical
  ) values (
    v_battery_id,btrim(p_customer_name),
    nullif(btrim(coalesce(p_customer_phone,'')),''),
    nullif(btrim(coalesce(p_vehicle_plate,'')),''),
    p_sale_price_cents,p_payment_method,p_warranty_days,auth.uid(),
    p_notes,p_request_id,
    v_sold_at,auth.uid(),true
  ) returning id into v_sale_id;

  -- Acerto só surge quando a venda existe; nunca antes.
  insert into public.used_battery_settlements(
    battery_id,sale_id,owed_cents,paid_cents,waived_cents
  ) values (
    v_battery_id,v_sale_id,p_transfer_price_cents,p_prior_paid_cents,0
  ) returning id into v_settlement_id;

  insert into public.used_settlement_events(
    settlement_id,action,old_owed_cents,new_owed_cents,
    old_paid_cents,new_paid_cents,old_waived_cents,new_waived_cents,
    reason,actor_id
  ) values (
    v_settlement_id,'created',0,p_transfer_price_cents,
    0,0,0,0,'Acerto vinculado a venda histórica cadastrada posteriormente',auth.uid()
  );

  if p_prior_paid_cents > 0 then
    insert into public.used_settlement_events(
      settlement_id,action,old_owed_cents,new_owed_cents,
      old_paid_cents,new_paid_cents,old_waived_cents,new_waived_cents,
      reason,actor_id,effective_at
    ) values (
      v_settlement_id,'historical_payment',
      p_transfer_price_cents,p_transfer_price_cents,
      0,p_prior_paid_cents,0,0,
      'Pagamento histórico informado durante a importação da venda',
      auth.uid(),v_paid_at
    );
  end if;

  insert into public.used_battery_activity(battery_id,action,description,actor_id)
  values (v_battery_id,'sold',
          'Venda histórica informada em '||to_char(v_sold_at at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||
          ' (cadastro realizado posteriormente)',
          auth.uid());

  return v_sale_id;
end;
$function$;

-- Registro retroativo de despesas: horario opcional quando nao conhecido.
create function public.register_ws_expense_historical(
  p_category text,
  p_amount_cents bigint,
  p_spent_on date,
  p_description text,
  p_spent_at_local timestamp without time zone default null
) returns uuid
language plpgsql security definer set search_path=''
as $func$
declare
  v_id uuid;
  v_spent_at timestamptz;
begin
  if auth.uid() is null or public.current_app_role() not in ('ws','admin') then
    raise exception 'Somente WS ou administrador podem cadastrar despesas da WS';
  end if;
  if p_spent_on is null or p_spent_on > (now() at time zone 'America/Sao_Paulo')::date
      or p_spent_on < '2000-01-01'::date then
    raise exception 'Data de despesa inválida';
  end if;
  if p_spent_at_local is not null then
    if p_spent_at_local::date<>p_spent_on then
      raise exception 'A data e o horário da despesa devem corresponder';
    end if;
    v_spent_at:=p_spent_at_local at time zone 'America/Sao_Paulo';
    if v_spent_at>now() then raise exception 'Despesa não pode ocorrer no futuro'; end if;
  end if;
  v_id:=public.register_ws_expense(p_category,p_amount_cents,p_spent_on,p_description);
  update public.ws_expenses set
    is_historical=p_spent_on<(now() at time zone 'America/Sao_Paulo')::date,
    spent_at=v_spent_at where id=v_id;
  return v_id;
end;
$func$;

create or replace function pbws_private.on_sale_notification()
returns trigger language plpgsql security definer set search_path = ''
as $func$
declare
  v_b public.used_batteries%rowtype;
begin
  -- Importacoes antigas ficam no historico, sem alertar como venda nova.
  if new.is_historical then return new; end if;
  select * into v_b from public.used_batteries where id=new.battery_id;
  perform pbws_private.notify_roles(
    array['power','admin'],'sale',
    'Nova venda registrada',
    'Bateria '||coalesce(v_b.brand,'')||' '||coalesce(v_b.model,'')||
    ' vendida. Repasse previsto: R$ '||
    to_char(coalesce(v_b.transfer_price_cents,0)::numeric/100,'FM999999999990D00')||'.',
    'settlements',new.sold_by
  );
  return new;
end;
$func$;

-- Receita pelo horario efetivo da venda, pagamentos pelo horario efetivo informado.
-- Auditoria occurred_at permanece com o horario REAL da inclusao.
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
  where s.cancelled_at is null and s.sold_at >= v_start and s.sold_at < v_end;

  select coalesce(sum(e.new_paid_cents - e.old_paid_cents),0)
  into v_paid_month from public.used_settlement_events e
  join public.used_battery_settlements st on st.id=e.settlement_id
  join public.used_battery_sales s on s.id=st.sale_id
  where s.cancelled_at is null and e.effective_at >= v_start and e.effective_at < v_end;

  select coalesce(sum(owed_cents-paid_cents-waived_cents),0)
  into v_pending from public.used_battery_settlements st
  join public.used_battery_sales s on s.id=st.sale_id
  where s.cancelled_at is null;

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

revoke all on function public.register_historical_battery_sale(
 uuid,timestamp without time zone,text,text,bigint,bigint,bigint,text,text,
 integer,integer,text,text,text,text,timestamp without time zone,bigint
) from public,anon,authenticated;
grant execute on function public.register_historical_battery_sale(
 uuid,timestamp without time zone,text,text,bigint,bigint,bigint,text,text,
 integer,integer,text,text,text,text,timestamp without time zone,bigint
) to authenticated;
revoke all on function public.register_ws_expense_historical(
 text,bigint,date,text,timestamp without time zone
) from public,anon,authenticated;
grant execute on function public.register_ws_expense_historical(
 text,bigint,date,text,timestamp without time zone
) to authenticated;
commit;
