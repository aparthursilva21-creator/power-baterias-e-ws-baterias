-- 019: cancelamento auditado por WS/Power/Admin e relatorios de periodo (dia, mes, ano).
-- Nao apaga registros nem altera pagamentos realizados.
begin;

create or replace function public.cancel_used_battery_sale(
  p_sale_id uuid,p_reason text
) returns void
language plpgsql security definer set search_path=''
as $fn$
declare
  v_sale public.used_battery_sales%rowtype;
  v_st public.used_battery_settlements%rowtype;
  v_battery public.used_batteries%rowtype;
  v_role text;
  v_before jsonb;
  v_after jsonb;
begin
  v_role:=public.current_app_role();
  if auth.uid() is null or v_role not in ('admin','power','ws') then
    raise exception 'Sua conta não pode cancelar vendas';
  end if;
  if p_sale_id is null then
    raise exception 'Informe a venda a cancelar';
  end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 5 and 500 then
    raise exception 'Explique o motivo do cancelamento (mínimo de 5 caracteres)';
  end if;

  select * into v_sale from public.used_battery_sales
  where id=p_sale_id for update;
  if not found or v_sale.cancelled_at is not null then
    raise exception 'Venda não encontrada ou já cancelada';
  end if;
  select * into v_st from public.used_battery_settlements
    where sale_id=v_sale.id for update;
  if not found then raise exception 'Acerto da venda não encontrado';end if;
  select * into v_battery from public.used_batteries
    where id=v_sale.battery_id;
  if not found then raise exception 'Bateria da venda não encontrada';end if;

  -- Pagamentos/dispensas anteriores nao podem sumir da contabilidade:
  -- reconciliar antes do cancelamento, e lotes exigem ajuste administrativo.
  if v_st.paid_cents<>0 or v_st.waived_cents<>0 or exists(
    select 1 from public.used_settlement_batch_items
    where settlement_id=v_st.id
  ) then
    raise exception 'Esta venda possui acerto pago, dispensado ou em lote. Reconcilie o acerto com o administrador antes de cancelar';
  end if;

  v_before:=jsonb_build_object('sale',to_jsonb(v_sale),
    'battery',to_jsonb(v_battery),'settlement',to_jsonb(v_st));

  update public.used_battery_sales set
    cancelled_at=now(),cancelled_by=auth.uid(),
    cancellation_reason=btrim(p_reason)
  where id=v_sale.id;
  select jsonb_build_object('sale',to_jsonb(s),
    'battery',to_jsonb(v_battery),'settlement',to_jsonb(v_st))
  into v_after from public.used_battery_sales s where s.id=v_sale.id;

  insert into public.used_sale_revisions
    (sale_id,action,reason,before_data,after_data,actor_id)
  values(v_sale.id,'cancelled',btrim(p_reason),v_before,v_after,auth.uid());

  perform pbws_private.notify_roles(
    array['power','ws','admin'],'sale',
    'Venda cancelada',
    'Venda de '||v_battery.brand||' '||v_battery.model||
       ' cancelada por '||(case v_role when 'power' then 'Power'
         when 'ws' then 'WS' else 'administrador' end)||
       '. Motivo e responsável constam no histórico.',
    'sales',auth.uid());
end;
$fn$;

revoke all on function public.cancel_used_battery_sale(uuid,text) from public,anon,authenticated;
grant execute on function public.cancel_used_battery_sale(uuid,text) to authenticated;

-- Relatorio unico, calculado pelo servidor, considerando dias INCLUSIVOS no
-- negocio (Brasilia): p_start incluido / p_end exclusivo.
-- Guarda a mesma semantica e os limites de acesso do relatorio mensal existente.
create function public.get_power_ws_period_report(
  p_start date,p_end date
) returns jsonb
language plpgsql stable security definer set search_path=''
as $report$
declare
  v_role text;
  v_start timestamptz;
  v_end timestamptz;
  v_count bigint;
  v_revenue bigint;
  v_repasse bigint;
  v_recovery bigint;
  v_expenses bigint;
  v_power_expenses bigint;
  v_paid bigint;
  v_pending bigint;
  v_settled bigint;
begin
  v_role:=public.current_app_role();
  if auth.uid() is null or v_role not in ('admin','ws','power') then
    raise exception 'Não autorizado a consultar relatórios';
  end if;
  if p_start is null or p_end is null or p_start<'2000-01-01'::date
     or p_end<=p_start or p_end>p_start+366 then
    raise exception 'Selecione um período válido de até 366 dias';
  end if;
  v_start:=p_start::timestamp at time zone 'America/Sao_Paulo';
  v_end:=p_end::timestamp at time zone 'America/Sao_Paulo';

  select count(*),
    coalesce(sum(s.sale_price_cents),0),
    coalesce(sum(st.owed_cents-st.waived_cents),0),
    coalesce(sum(b.recovery_cost_cents),0),
    count(*) filter(where st.paid_cents+st.waived_cents=st.owed_cents)
  into v_count,v_revenue,v_repasse,v_recovery,v_settled
  from public.used_battery_sales s
    join public.used_batteries b on b.id=s.battery_id
    join public.used_battery_settlements st on st.sale_id=s.id
  where s.cancelled_at is null and s.sold_at>=v_start and s.sold_at<v_end;

  select coalesce(sum(e.new_paid_cents-e.old_paid_cents),0)
  into v_paid
  from public.used_settlement_events e
    join public.used_battery_settlements st on st.id=e.settlement_id
    join public.used_battery_sales s on s.id=st.sale_id
  where s.cancelled_at is null
    and e.effective_at>=v_start and e.effective_at<v_end;

  select coalesce(sum(st.owed_cents-st.paid_cents-st.waived_cents),0)
  into v_pending
  from public.used_battery_settlements st
    join public.used_battery_sales s on s.id=st.sale_id
  where s.cancelled_at is null;

  if v_role in ('ws','admin') then
    select coalesce(sum(amount_cents),0) into v_expenses
    from public.ws_expenses
    where spent_on>=p_start and spent_on<p_end;
  else
    v_expenses:=null;
  end if;
  if v_role in ('power','admin') then
    select coalesce(sum(amount_cents),0) into v_power_expenses
    from public.power_expenses
    where spent_on>=p_start and spent_on<p_end;
  else
    v_power_expenses:=null;
  end if;

  return jsonb_build_object(
    'period_start',p_start,'period_end_exclusive',p_end,'role',v_role,
    'sales_count',v_count,'sales_revenue_cents',v_revenue,
    'power_repasse_sales_month_cents',v_repasse,
    'recovery_cost_sales_month_cents',v_recovery,
    'ws_expenses_cents',v_expenses,'power_expenses_cents',v_power_expenses,
    'ws_estimated_profit_cents',case when v_expenses is null then null
      else v_revenue-v_repasse-v_recovery-v_expenses end,
    'power_received_in_month_cents',v_paid,
    'power_pending_total_now_cents',v_pending,
    'fully_settled_sales_in_month',v_settled
  );
end;
$report$;

revoke all on function public.get_power_ws_period_report(date,date)
  from public,anon,authenticated;
grant execute on function public.get_power_ws_period_report(date,date)
  to authenticated;
commit;
