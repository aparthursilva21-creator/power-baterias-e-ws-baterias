-- 014: Despesas da Power separadas das despesas da WS.
-- Apenas Sandro/Arthur podem lançar gastos Power; WS não vê valores Power.
begin;

create table public.power_expenses (
 id uuid primary key default gen_random_uuid(),
 category text not null check(category in ('gasoline','delivery','recovery_parts','materials','other')),
 amount_cents bigint not null check(amount_cents>0),
 spent_on date not null,
 spent_at timestamptz,
 description text not null check (char_length(btrim(description)) between 2 and 300),
 created_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id),
 is_historical boolean not null default false
);
create index power_expenses_date_idx on public.power_expenses(spent_on desc);
create table public.power_expense_events (
 id uuid primary key default gen_random_uuid(),
 expense_id uuid not null references public.power_expenses(id),
 action text not null check(action in ('created','corrected')),
 before_data jsonb,
 after_data jsonb not null,
 reason text not null,
 actor_id uuid not null references auth.users(id),
 occurred_at timestamptz not null default now()
);
create index power_expense_events_idx on public.power_expense_events(occurred_at desc);

alter table public.power_expenses enable row level security;
alter table public.power_expense_events enable row level security;
revoke all on public.power_expenses,public.power_expense_events
  from public,anon,authenticated;
grant select on public.power_expenses,public.power_expense_events to authenticated;

create policy "Power can read its own expenses" on public.power_expenses
for select to authenticated using ((select public.current_app_role()) in ('power','admin'));
create policy "Power can read its own expense audit" on public.power_expense_events
for select to authenticated using ((select public.current_app_role()) in ('power','admin'));

create function public.register_power_expense(
 p_category text, p_amount_cents bigint, p_spent_on date, p_description text,
 p_spent_at_local timestamp without time zone default null,
 p_historical boolean default false
) returns uuid
language plpgsql security definer set search_path=''
as $fn$
declare
 v_id uuid;v_at timestamptz;
begin
 if auth.uid() is null or public.current_app_role() not in ('power','admin') then
   raise exception 'Somente Sandro ou administrador podem registrar gastos Power';
 end if;
 if p_category not in ('gasoline','delivery','recovery_parts','materials','other')
    or p_category is null then raise exception 'Categoria inválida'; end if;
 if p_amount_cents is null or p_amount_cents<=0 then
   raise exception 'Valor de gasto precisa ser positivo'; end if;
 if p_spent_on is null or p_spent_on<'2000-01-01'::date
    or p_spent_on>(now() at time zone 'America/Sao_Paulo')::date then
   raise exception 'Data de despesa inválida';end if;
 if char_length(btrim(coalesce(p_description,''))) not between 2 and 300 then
   raise exception 'Informe uma descrição';end if;
 if p_spent_at_local is not null then
   v_at:=p_spent_at_local at time zone 'America/Sao_Paulo';
   if p_spent_at_local::date<>p_spent_on or v_at>now() then
     raise exception 'Horário deve corresponder à data e não pode ser futuro';
   end if;
 end if;
 insert into public.power_expenses
   (category,amount_cents,spent_on,spent_at,description,created_by,is_historical)
 values (
   p_category,p_amount_cents,p_spent_on,v_at,btrim(p_description),auth.uid(),
   coalesce(p_historical,false) or p_spent_on<(now() at time zone 'America/Sao_Paulo')::date
 ) returning id into v_id;
 insert into public.power_expense_events
   (expense_id,action,before_data,after_data,reason,actor_id)
 select v_id,'created',null,to_jsonb(e),'Despesa registrada',auth.uid()
 from public.power_expenses e where e.id=v_id;
 return v_id;
end;
$fn$;

create function public.correct_power_expense(
 p_expense_id uuid,p_amount_cents bigint,p_spent_on date,p_description text,
 p_reason text,p_spent_at_local timestamp without time zone default null
) returns void
language plpgsql security definer set search_path=''
as $fn$
declare
 v_exp public.power_expenses%rowtype;
 v_before jsonb;v_after jsonb;v_at timestamptz;
begin
 if auth.uid() is null or public.current_app_role() not in ('power','admin') then
  raise exception 'Somente Sandro ou administrador corrigem gastos Power';end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 5 and 500 then
  raise exception 'Justificativa de correção deve ter ao menos 5 caracteres';end if;
 if p_amount_cents is null or p_amount_cents<=0 then
  raise exception 'Valor inválido';end if;
 if p_spent_on is null or p_spent_on<'2000-01-01'::date
    or p_spent_on>(now() at time zone 'America/Sao_Paulo')::date then
  raise exception 'Data inválida';end if;
 if char_length(btrim(coalesce(p_description,''))) not between 2 and 300 then
  raise exception 'Descrição inválida';end if;
 if p_spent_at_local is not null then
  v_at:=p_spent_at_local at time zone 'America/Sao_Paulo';
  if p_spent_at_local::date<>p_spent_on or v_at>now() then
   raise exception 'Horário inválido';end if;
 end if;
 select * into v_exp from public.power_expenses where id=p_expense_id for update;
 if not found then raise exception 'Despesa não encontrada';end if;
 v_before:=to_jsonb(v_exp);
 update public.power_expenses set amount_cents=p_amount_cents,spent_on=p_spent_on,
   spent_at=v_at,description=btrim(p_description),
   is_historical=v_exp.is_historical or p_spent_on<(now() at time zone 'America/Sao_Paulo')::date
 where id=p_expense_id;
 select to_jsonb(e) into v_after from public.power_expenses e where id=p_expense_id;
 if v_before=v_after then raise exception 'Não houve alteração';end if;
 insert into public.power_expense_events
   (expense_id,action,before_data,after_data,reason,actor_id)
 values(p_expense_id,'corrected',v_before,v_after,btrim(p_reason),auth.uid());
end;
$fn$;

-- Power vê seus gastos no próprio relatório, sem afetar lucro da WS.
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
  v_power_expenses bigint;
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

  if v_role in ('power','admin') then
    select coalesce(sum(amount_cents),0) into v_power_expenses
    from public.power_expenses
    where spent_on>=v_from_date and spent_on<v_to_date;
  else
    v_power_expenses:=null;
  end if;

  return jsonb_build_object(
    'month',to_char(v_from_date,'YYYY-MM'),
    'role',v_role,
    'sales_count',v_count,
    'sales_revenue_cents',v_revenue,
    'power_repasse_sales_month_cents',v_repasse,
    'recovery_cost_sales_month_cents',v_recovery,
    'ws_expenses_cents',v_expenses,
    'power_expenses_cents',v_power_expenses,
    'ws_estimated_profit_cents',
      case when v_expenses is null then null
      else v_revenue-v_repasse-v_recovery-v_expenses end,
    'power_received_in_month_cents',v_paid_month,
    'power_pending_total_now_cents',v_pending,
    'fully_settled_sales_in_month',v_settled
  );
end;
$func$;

revoke all on function public.register_power_expense(
 text,bigint,date,text,timestamp without time zone,boolean
) from public,anon,authenticated;
grant execute on function public.register_power_expense(
 text,bigint,date,text,timestamp without time zone,boolean
) to authenticated;
revoke all on function public.correct_power_expense(
 uuid,bigint,date,text,text,timestamp without time zone
) from public,anon,authenticated;
grant execute on function public.correct_power_expense(
 uuid,bigint,date,text,text,timestamp without time zone
) to authenticated;
commit;
