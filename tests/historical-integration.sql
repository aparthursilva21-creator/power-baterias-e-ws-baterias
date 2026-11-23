-- Lançamentos retroativos: dados fictícios, Postgres de laboratório, sem atingir o projeto real.
set role authenticated;
do $history$
declare
  v_ws uuid:='00000000-0000-4000-8000-000000000003';
  v_power uuid:='00000000-0000-4000-8000-000000000002';
  v_sale uuid;v_sale2 uuid;v_new uuid;v_expense uuid;
  v_date timestamp;v_paydate timestamp;
  v_st public.used_battery_settlements%rowtype;
  v_report jsonb;v_n integer;v_blocked boolean;
begin
  v_date:=date_trunc('day',(now() at time zone 'America/Sao_Paulo')-interval '65 days')+interval '11 hours 20 minutes';
  v_paydate:=v_date+interval '5 days 3 hours';
  perform set_config('request.jwt.claim.sub',v_ws::text,true);
  v_sale:=public.register_historical_battery_sale(
   p_request_id=>'a1000000-0000-4000-8000-000000000001'::uuid,
   p_sold_at_local=>v_date,
   p_brand=>'Moura',p_model=>'60 Ah usada',
   p_transfer_price_cents=>6000,p_recovery_cost_cents=>2000,
   p_sale_price_cents=>22000,p_customer_name=>'Cliente antigo teste',
   p_payment_method=>'pix',p_warranty_days=>30,
   p_prior_paid_cents=>2500,p_paid_at_local=>v_paydate
  );
  v_sale2:=public.register_historical_battery_sale(
   p_request_id=>'a1000000-0000-4000-8000-000000000001'::uuid,
   p_sold_at_local=>v_date,
   p_brand=>'Moura',p_model=>'60 Ah usada',
   p_transfer_price_cents=>6000,p_recovery_cost_cents=>2000,
   p_sale_price_cents=>22000,p_customer_name=>'Cliente antigo teste',
   p_payment_method=>'pix',p_prior_paid_cents=>2500,p_paid_at_local=>v_paydate
  );
  if v_sale<>v_sale2 then raise exception 'Reenvio duplicou venda antiga'; end if;
  select * into v_st from public.used_battery_settlements where sale_id=v_sale;
  if v_st.owed_cents<>6000 or v_st.paid_cents<>2500 then
    raise exception 'Acerto parcial antigo incorreto'; end if;
  select count(*) into v_n from public.used_battery_sales
  where id=v_sale and is_historical and recorded_by=v_ws
    and abs(extract(epoch from
      (sold_at at time zone 'America/Sao_Paulo') -v_date))<1
    and recorded_at>now()-interval '2 minutes';
  if v_n<>1 then raise exception 'Registro e data efetiva incorretos'; end if;

  select count(*) into v_n from public.used_settlement_events
    where settlement_id=v_st.id and action='historical_payment'
      and (effective_at at time zone 'America/Sao_Paulo')=v_paydate
      and occurred_at>now()-interval '2 minutes';
  if v_n<>1 then raise exception 'Data efetiva de acerto antigo incorreta'; end if;

  v_report:=public.get_power_ws_monthly_report(v_date::date);
  if (v_report->>'sales_revenue_cents')::bigint<>22000 then
    raise exception 'Venda antiga não foi contabilizada no mês de origem'; end if;
  if (v_report->>'power_received_in_month_cents')::bigint<>2500 then
    raise exception 'Acerto antigo não foi contabilizado no mês efetivo'; end if;

  v_expense:=public.register_ws_expense_historical(
   'gasoline',3900,v_date::date,'Gasolina de entrega antiga',
   v_date+interval '4 hours 10 minutes'
  );
  select count(*) into v_n from public.ws_expenses
  where id=v_expense and is_historical and spent_on=v_date::date
    and spent_at at time zone 'America/Sao_Paulo'=v_date+interval '4 hours 10 minutes'
    and created_at>now()-interval '2 minutes';
  if v_n<>1 then raise exception 'Gasto antigo não tem data de negócio e data de cadastro'; end if;
  v_report:=public.get_power_ws_monthly_report(v_date::date);
  if (v_report->>'ws_expenses_cents')::bigint<>3900 then
    raise exception 'Despesa antiga não apareceu no mês certo';end if;

  v_blocked:=false;
  begin
   perform public.register_historical_battery_sale(
     p_request_id=>'a1000000-0000-4000-8000-000000000002'::uuid,
     p_sold_at_local=>(now() at time zone 'America/Sao_Paulo')+interval '7 days',
     p_brand=>'X',p_model=>'Y',p_transfer_price_cents=>5000,
     p_recovery_cost_cents=>0,p_sale_price_cents=>10000,
     p_customer_name=>'Teste',p_payment_method=>'pix'
   );
  exception when others then v_blocked:=true; end;
  if not v_blocked then raise exception 'Aceitou venda do futuro';end if;

  -- Conta Power pode cadastrar somente vendas ANTIGAS, não venda comum.
  perform set_config('request.jwt.claim.sub',v_power::text,true);
  v_new:=public.register_historical_battery_sale(
   p_request_id=>'a1000000-0000-4000-8000-000000000003'::uuid,
   p_sold_at_local=>v_date,
   p_brand=>'Heliar',p_model=>'60 Ah',p_transfer_price_cents=>5000,
   p_recovery_cost_cents=>0,p_sale_price_cents=>14000,
   p_customer_name=>'Cliente antigo cadastrado por Sandro',p_payment_method=>'cash'
  );
  select count(*) into v_n from public.used_battery_sales
    where id=v_new and recorded_by=v_power and is_historical;
  if v_n<>1 then raise exception 'Importacao por Sandro não identificada'; end if;

  v_blocked:=false;
  begin
    perform public.register_direct_battery_sale(
      p_request_id=>'a1000000-0000-4000-8000-000000000004'::uuid,
      p_brand=>'Teste',p_model=>'Modelo',p_transfer_price_cents=>5000,
      p_recovery_cost_cents=>0,p_sale_price_cents=>10000,
      p_customer_name=>'Cliente',p_payment_method=>'pix'
    );
  exception when others then v_blocked:=true; end;
  if not v_blocked then raise exception 'Power registrou venda de hoje sem permissão'; end if;

  -- Venda normal continua possível após a criação dos novos campos obrigatórios.
  perform set_config('request.jwt.claim.sub',v_ws::text,true);
  v_new:=public.register_direct_battery_sale(
    p_request_id=>'a1000000-0000-4000-8000-000000000005'::uuid,
    p_brand=>'Heliar',p_model=>'60 Ah normal',p_transfer_price_cents=>5000,
    p_recovery_cost_cents=>0,p_sale_price_cents=>12000,
    p_customer_name=>'Venda normal',p_payment_method=>'pix'
  );
  select count(*) into v_n from public.used_battery_sales
    where id=v_new and not is_historical and recorded_by=v_ws;
  if v_n<>1 then raise exception 'Venda normal parou de funcionar após migração'; end if;

  raise notice 'PASSOU: venda antiga WS/Power, pagamentos, despesas, mês certo, duplicidade e auditoria';
end;
$history$;
