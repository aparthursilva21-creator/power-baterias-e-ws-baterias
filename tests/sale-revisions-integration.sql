-- Testes de correção e cancelamento, sem mexer em registros reais.
set role authenticated;
do $tests$
declare
 v_admin uuid:='00000000-0000-4000-8000-000000000001';
 v_ws uuid:='00000000-0000-4000-8000-000000000003';
 v_power uuid:='00000000-0000-4000-8000-000000000002';
 v_sale uuid;v_test uuid;v_st uuid; v_out jsonb;v_n integer;v_blocked boolean;
begin
 perform set_config('request.jwt.claim.sub',v_ws::text,true);
 select s.id into v_sale from public.used_battery_sales s
 where s.client_request_id='11111111-1111-4111-8111-111111111111'::uuid;
 perform public.correct_used_battery_sale(v_sale,jsonb_build_object(
 'customer_name','Cliente corrigido','sale_price_cents',21000,
 'warranty_days',45,'brand','Moura Atualizada'),'Ajuste de digitação de teste');
 select count(*) into v_n from public.used_sale_revisions
 where sale_id=v_sale and action='corrected' and actor_id=v_ws;
 if v_n<>1 then raise exception 'Correcao nao auditada'; end if;
 select count(*) into v_n from public.used_battery_sales s
 join public.used_batteries b on b.id=s.battery_id
 where s.id=v_sale and s.sale_price_cents=21000 and s.warranty_days=45
 and s.customer_name='Cliente corrigido' and b.brand='Moura Atualizada';
 if v_n<>1 then raise exception 'Campos de venda nao atualizados'; end if;
 select owed_cents into v_n from public.used_battery_settlements where sale_id=v_sale;
 if v_n<>7000 then raise exception 'Correção alterou indevidamente o repasse da Power'; end if;

 v_blocked:=false;
 begin
  perform public.cancel_used_battery_sale(v_sale,'WS sem autorização');
 exception when others then v_blocked:=true;end;
 if not v_blocked then raise exception 'WS conseguiu cancelar venda'; end if;

 perform set_config('request.jwt.claim.sub',v_admin::text,true);
 v_blocked:=false;
 begin
  perform public.cancel_used_battery_sale(v_sale,'Já recebeu pagamento');
 exception when others then v_blocked:=true;end;
 if not v_blocked then raise exception 'Cancelou venda ja paga'; end if;

 perform set_config('request.jwt.claim.sub',v_ws::text,true);
 v_test:=public.register_direct_battery_sale(
  p_request_id=>'77777777-7777-4777-8777-777777777777'::uuid,
  p_brand=>'Teste',p_model=>'Teste 45',
  p_transfer_price_cents=>3000,p_recovery_cost_cents=>0,
  p_sale_price_cents=>10000,p_customer_name=>'Cliente Teste',
  p_payment_method=>'cash');
 perform set_config('request.jwt.claim.sub',v_admin::text,true);
 perform public.cancel_used_battery_sale(v_test,'Venda ficticia lançada só para testar');
 select count(*) into v_n from public.used_battery_sales
 where id=v_test and cancelled_at is not null and cancelled_by=v_admin;
 if v_n<>1 then raise exception 'Cancelamento nao auditado'; end if;

 v_blocked:=false;
 select id into v_st from public.used_battery_settlements where sale_id=v_test;
 begin
  perform public.manage_used_settlement(v_st,'payment',3000,'teste');
 exception when others then v_blocked:=true;end;
 if not v_blocked then raise exception 'Permitiu pagamento de venda cancelada'; end if;
 v_blocked:=false;
 begin
   perform public.pbws_remind_ws(array[v_st]);
 exception when others then
   if sqlerrm like '%Nao ha acertos pendentes%' then
     v_blocked:=true;
   else
     raise;
   end if;
 end;
 if not v_blocked then raise exception 'Enviou cobranca de venda cancelada'; end if;

 v_out:=public.get_power_ws_monthly_report((now() at time zone 'America/Sao_Paulo')::date);
 if (v_out->>'sales_count')::int<>3 then
  raise exception 'Relatorio incluiu venda cancelada: %',v_out->>'sales_count'; end if;
 if (v_out->>'power_pending_total_now_cents')::bigint<>3300 then
  raise exception 'Relatorio incluiu pendencia cancelada'; end if;
 raise notice 'PASSOU: correção, motivos, permissão, veto de pagamento, cancelamento e relatórios';
end;
$tests$;
