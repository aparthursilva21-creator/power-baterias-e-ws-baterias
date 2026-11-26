-- Testes pós-020: somente WS cadastra e Sandro/WS editam e recebem alertas.
-- Executar SOMENTE no banco efêmero de CI, jamais sobre vendas reais.
set role authenticated;
do $verify$
declare
 v_ws uuid:='00000000-0000-4000-8000-000000000003';
 v_power uuid:='00000000-0000-4000-8000-000000000002';
 v_admin uuid:='00000000-0000-4000-8000-000000000001';
 v_sale uuid;v_other uuid;v_n int;v_before int;v_power_before int;v_denied boolean;
 v_original timestamptz;v_actor uuid;
begin
 perform set_config('request.jwt.claim.sub',v_ws::text,true);
 select count(*) into v_before from public.pbws_notifications
 where recipient_id=v_ws and title='Nova venda registrada';
 select count(*) into v_power_before from public.pbws_notifications
 where recipient_id=v_power and title='Nova venda registrada';
 v_sale:=public.register_direct_battery_sale(
   p_request_id=>'20260200-0000-4000-8000-000000000001'::uuid,
   p_brand=>'Moura',p_model=>'60Ah',p_transfer_price_cents=>6000,
   p_recovery_cost_cents=>0,p_sale_price_cents=>18000,
   p_customer_name=>'Cliente da WS',p_payment_method=>'pix'
 );
 select count(*) into v_n from public.pbws_notifications
 where recipient_id=v_ws and title='Nova venda registrada';
 if v_n<>v_before+1 then raise exception 'Venda nao notificou a propria WS';end if;
 select count(*) into v_n from public.pbws_notifications
 where recipient_id=v_power and title='Nova venda registrada';
 if v_n<>v_power_before+1 then
  raise exception 'Nova venda nao notificou Sandro: anterior %, atual %',
    v_power_before,v_n;
 end if;
 select sold_at,sold_by into v_original,v_actor from public.used_battery_sales where id=v_sale;

 -- Quem corrige é Sandro, mesmo que o lançamento tenha sido feito pelo Wanderson.
 perform set_config('request.jwt.claim.sub',v_power::text,true);
 perform public.correct_used_battery_sale(v_sale,
   '{"customer_name":"Cliente corrigido pelo Sandro","sale_price_cents":18500}'::jsonb,
   'Valor informado incorretamente no WhatsApp');
 select count(*) into v_n from public.used_sale_revisions where sale_id=v_sale
   and action='corrected' and actor_id=v_power
   and before_data->'sale'->>'customer_name'='Cliente da WS'
   and after_data->'sale'->>'customer_name'='Cliente corrigido pelo Sandro';
 if v_n<>1 then raise exception 'Sandro nao conseguiu corrigir venda da WS com antes/depois';end if;
 select count(*) into v_n from public.used_battery_sales where id=v_sale
   and sold_by=v_actor and sold_at=v_original and sale_price_cents=18500;
 if v_n<>1 then raise exception 'Edicao mudou vendedor ou horario da venda';end if;
 select count(*) into v_n from public.pbws_notifications where recipient_id=v_ws
   and title='Venda corrigida' and created_at>now()-interval '3 minutes';
 if v_n<1 then raise exception 'WS nao recebeu aviso da edicao do Sandro';end if;
 select count(*) into v_n from public.pbws_notifications where recipient_id=v_power
   and title='Venda corrigida' and created_at>now()-interval '3 minutes';
 if v_n<1 then raise exception 'Sandro nao recebeu confirmacao no proprio celular';end if;

 -- Wanderson pode corrigir posteriormente, preservando autoria.
 perform set_config('request.jwt.claim.sub',v_ws::text,true);
 perform public.correct_used_battery_sale(v_sale,
   '{"customer_phone":"61999999999"}'::jsonb,
   'Telefone corrigido após contato');
 select count(*) into v_n from public.used_sale_revisions
 where sale_id=v_sale and actor_id=v_ws and action='corrected';
 if v_n<>1 then raise exception 'WS nao conseguiu corrigir venda';end if;

 -- Somente WS registra, inclusive lançamentos antigos.
 perform set_config('request.jwt.claim.sub',v_power::text,true);
 v_denied:=false;
 begin
  perform public.register_direct_battery_sale(
   p_request_id=>'20260200-0000-4000-8000-000000000002'::uuid,
   p_brand=>'Heliar',p_model=>'50Ah',p_transfer_price_cents=>2000,
   p_recovery_cost_cents=>0,p_sale_price_cents=>9000,
   p_customer_name=>'Nao deveria registrar',p_payment_method=>'pix');
 exception when others then v_denied:=true;end;
 if not v_denied then raise exception 'Power conseguiu cadastrar nova venda';end if;
 v_denied:=false;
 begin
  perform public.register_historical_battery_sale(
   p_request_id=>'20260200-0000-4000-8000-000000000003'::uuid,
   p_sold_at_local=>'2025-10-10 10:00',
   p_brand=>'Heliar',p_model=>'50Ah',p_transfer_price_cents=>2000,
   p_recovery_cost_cents=>0,p_sale_price_cents=>9000,
   p_customer_name=>'Nao deveria registrar',p_payment_method=>'pix');
 exception when others then v_denied:=true;end;
 if not v_denied then raise exception 'Power conseguiu registrar venda antiga';end if;
 perform set_config('request.jwt.claim.sub',v_admin::text,true);
 v_denied:=false;
 begin
  perform public.register_direct_battery_sale(
   p_request_id=>'20260200-0000-4000-8000-000000000004'::uuid,
   p_brand=>'Moura',p_model=>'70Ah',p_transfer_price_cents=>2500,
   p_recovery_cost_cents=>0,p_sale_price_cents=>9500,
   p_customer_name=>'Admin nao lanca',p_payment_method=>'pix');
 exception when others then v_denied:=true;end;
 if not v_denied then raise exception 'Admin conseguiu cadastrar nova venda fora do fluxo WS';end if;

 -- Cancelamento notifica ambas as contas, inclusive quem fez a ação.
 perform set_config('request.jwt.claim.sub',v_power::text,true);
 perform public.cancel_used_battery_sale(v_sale,'Venda duplicada, cancelamento alinhado com Wanderson');
 select count(*) into v_n from public.used_sale_revisions
 where sale_id=v_sale and action='cancelled' and actor_id=v_power;
 if v_n<>1 then raise exception 'Cancelamento do Sandro nao foi auditado';end if;
 select count(*) into v_n from public.pbws_notifications
 where recipient_id=v_ws and title='Venda cancelada' and created_at>now()-interval '3 minutes';
 if v_n<1 then raise exception 'WS nao recebeu cancelamento';end if;
 select count(*) into v_n from public.pbws_notifications
 where recipient_id=v_power and title='Venda cancelada' and created_at>now()-interval '3 minutes';
 if v_n<1 then raise exception 'Power nao recebeu confirmacao do cancelamento';end if;
 if has_function_privilege('anon','public.correct_used_battery_sale(uuid,jsonb,text)','EXECUTE')
  then raise exception 'Funcao de correcao aberta para visitante';end if;

 raise notice 'PASSOU: WS exclusiva para cadastro; Sandro/WS editam; avisos para ambos; log e cancelamento intactos';
end;
$verify$;
