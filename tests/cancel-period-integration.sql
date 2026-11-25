-- Integração CI: cancelamento WS/Power e competência diária/mensal/anual.
-- Todas as mudanças desta execução ficam SOMENTE no PostgreSQL de teste.
set role authenticated;
do $tests$
declare
 ws uuid:='00000000-0000-4000-8000-000000000003';
 power_user uuid:='00000000-0000-4000-8000-000000000002';
 admin_user uuid:='00000000-0000-4000-8000-000000000001';
 a uuid;b uuid;paid uuid;
 r jsonb;baseline bigint;got bigint;n int;denied boolean;
 date_sale timestamp:='2023-08-17 11:35:00';
begin
 perform set_config('request.jwt.claim.sub',ws::text,true);
 r:=public.get_power_ws_period_report('2023-08-17','2023-08-18');
 baseline:=(r->>'sales_revenue_cents')::bigint;
 a:=public.register_historical_battery_sale(
   p_request_id=>'01900000-0000-4000-8000-000000000001'::uuid,
   p_sold_at_local=>date_sale,p_brand=>'Moura',p_model=>'60Ah',
   p_transfer_price_cents=>7000,p_recovery_cost_cents=>1200,
   p_sale_price_cents=>21000,p_customer_name=>'Cliente excluído Power',
   p_payment_method=>'pix',p_prior_paid_cents=>0
 );
 r:=public.get_power_ws_period_report('2023-08-17','2023-08-18');
 if (r->>'sales_revenue_cents')::bigint<>baseline+21000 then
   raise exception 'Relatorio diario nao incluiu venda anterior';end if;

 perform set_config('request.jwt.claim.sub',power_user::text,true);
 perform public.cancel_used_battery_sale(a,'Venda duplicada, reconhecida pelo Sandro');
 select count(*) into n from public.used_battery_sales where id=a
   and cancelled_at is not null and cancelled_by=power_user
   and cancellation_reason='Venda duplicada, reconhecida pelo Sandro';
 if n<>1 then raise exception 'Power nao conseguiu excluir venda não paga';end if;
 select count(*) into n from public.used_sale_revisions
   where sale_id=a and action='cancelled' and actor_id=power_user
     and reason='Venda duplicada, reconhecida pelo Sandro'
     and before_data->'sale'->>'cancelled_at' is null
     and after_data->'sale'->>'cancelled_at' is not null
     and before_data->'battery'->>'brand'='Moura';
 if n<>1 then raise exception 'Nao salvou antes/depois/autor da exclusao Power';end if;
 r:=public.get_power_ws_period_report('2023-08-17','2023-08-18');
 if (r->>'sales_revenue_cents')::bigint<>baseline then
   raise exception 'Relatorio diario manteve venda cancelada';end if;
 if r->>'ws_expenses_cents' is not null then
   raise exception 'Perfil Power acessou despesas privadas WS';end if;

 denied:=false;
 begin perform public.cancel_used_battery_sale(a,'Cancelamento duplicado');
 exception when others then denied:=true;end;
 if not denied then raise exception 'Venda cancelada duas vezes';end if;

 perform set_config('request.jwt.claim.sub',ws::text,true);
 b:=public.register_historical_battery_sale(
   p_request_id=>'01900000-0000-4000-8000-000000000002'::uuid,
   p_sold_at_local=>'2023-08-18 13:10:00',p_brand=>'Heliar',p_model=>'50Ah',
   p_transfer_price_cents=>5000,p_recovery_cost_cents=>0,
   p_sale_price_cents=>15000,p_customer_name=>'Cliente excluído WS',
   p_payment_method=>'pix',p_prior_paid_cents=>0
 );
 perform public.cancel_used_battery_sale(b,'Duplicidade identificada por Wanderson');
 select count(*) into n from public.used_sale_revisions
   where sale_id=b and action='cancelled' and actor_id=ws;
 if n<>1 then raise exception 'WS nao conseguiu cancelar venda com auditoria';end if;
 r:=public.get_power_ws_period_report('2023-08-01','2023-09-01');
 if (r->>'sales_revenue_cents')::bigint<>baseline then
   raise exception 'Relatorio mensal nao excluiu vendas canceladas';end if;
 if r->>'power_expenses_cents' is not null then
   raise exception 'WS acessou despesas privadas Power';end if;
 r:=public.get_power_ws_period_report('2023-01-01','2024-01-01');
 if (r->>'sales_revenue_cents')::bigint<>baseline then
   raise exception 'Relatorio anual nao excluiu vendas canceladas';end if;

 paid:=public.register_historical_battery_sale(
   p_request_id=>'01900000-0000-4000-8000-000000000003'::uuid,
   p_sold_at_local=>'2023-08-19 10:30:00',p_brand=>'Moura',p_model=>'80Ah',
   p_transfer_price_cents=>8000,p_recovery_cost_cents=>2000,
   p_sale_price_cents=>26000,p_customer_name=>'Cliente pago teste',
   p_payment_method=>'pix',p_prior_paid_cents=>4000,
   p_paid_at_local=>'2023-08-19 12:30:00'
 );
 denied:=false;
 begin
   perform public.cancel_used_battery_sale(paid,'Possui acerto financeiro já registrado');
 exception when others then denied:=true;end;
 if not denied then raise exception 'WS apagou venda com pagamento ativo';end if;
 perform set_config('request.jwt.claim.sub',power_user::text,true);
 denied:=false;
 begin
   perform public.cancel_used_battery_sale(paid,'Power tentando cancelar pagamento feito');
 exception when others then denied:=true;end;
 if not denied then raise exception 'Power cancelou venda paga';end if;
 perform set_config('request.jwt.claim.sub',admin_user::text,true);
 r:=public.get_power_ws_period_report('2023-08-19','2023-08-20');
 if (r->>'sales_revenue_cents')::bigint<>26000 then
   raise exception 'Relatório de venda ativa não corresponde';end if;
 if (r->>'power_received_in_month_cents')::bigint<>4000 then
   raise exception 'Relatório diário ignorou pagamento na data efetiva';end if;

 denied:=false;
 begin
   perform public.get_power_ws_period_report('2023-01-01','2025-01-01');
 exception when others then denied:=true;end;
 if not denied then raise exception 'Aceitou período maior do que um ano';end if;
 if has_function_privilege('anon','public.cancel_used_battery_sale(uuid,text)','EXECUTE')
    or has_function_privilege('anon','public.get_power_ws_period_report(date,date)','EXECUTE') then
   raise exception 'RPCs financeiras expostas a visitantes anônimos';end if;
 raise notice 'PASSOU: Sandro e WS cancelam sem apagar, auditoria, proteção de acerto, dia/mês/ano e isolamento';
end;
$tests$;
