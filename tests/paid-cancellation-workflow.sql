-- Teste exclusivo CI PostgreSQL efêmero. Não executar em produção.
set role authenticated;
do $checks$
declare
 v_ws uuid:='00000000-0000-4000-8000-000000000003';
 v_sandro uuid:='00000000-0000-4000-8000-000000000002';
 v_sale uuid;v_settlement uuid;v_review uuid;
 v_denied boolean;v_n integer;
 v_before bigint;v_after bigint;
 v_day date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 perform set_config('request.jwt.claim.sub',v_ws::text,true);
 v_sale:=public.register_direct_battery_sale(
  p_request_id=>'02100000-0000-4000-8000-000000000021'::uuid,
  p_brand=>'Heliar',p_model=>'70Ah',
  p_transfer_price_cents=>7500,p_recovery_cost_cents=>1500,
  p_sale_price_cents=>24000,p_customer_name=>'Cliente antes da correção',
  p_payment_method=>'pix'
 );
 select id into v_settlement from public.used_battery_settlements where sale_id=v_sale;
 if v_settlement is null then raise exception 'Venda não criou acerto';end if;
 perform set_config('request.jwt.claim.sub',v_sandro::text,true);
 perform public.manage_used_settlement(v_settlement,'payment',5000,'Pagamento comprovado');

 -- Sandro consegue corrigir dados do cliente mesmo com pagamento já registrado.
 perform public.correct_used_battery_sale(v_sale,'{"customer_name":"Cliente corrigido pelo Sandro","customer_phone":"61999999999"}'::jsonb,
 'Nome informado incorretamente no lançamento');
 select count(*) into v_n from public.used_sale_revisions
 where sale_id=v_sale and action='corrected' and actor_id=v_sandro
 and before_data->'sale'->>'customer_name'='Cliente antes da correção'
 and after_data->'sale'->>'customer_name'='Cliente corrigido pelo Sandro';
 if v_n<>1 then raise exception 'Sandro não corrigiu nome do cliente auditavelmente';end if;

 -- A venda paga não pode ser cancelada via fluxo comum.
 v_denied:=false;
 begin perform public.cancel_used_battery_sale(v_sale,'Cancelamento com pagamento anterior');
 exception when others then v_denied:=true;end;
 if not v_denied then raise exception 'Fluxo simples cancelou uma venda paga';end if;

 v_denied:=false;
 begin perform public.cancel_used_battery_sale_with_review(v_sale,'Confirmação ausente',false);
 exception when others then v_denied:=true;end;
 if not v_denied then raise exception 'Cancelamento pago ignorou confirmação';end if;

 perform set_config('request.jwt.claim.sub',v_ws::text,true);
 v_denied:=false;
 begin perform public.cancel_used_battery_sale_with_review(v_sale,'WS tentou cancelar venda paga',true);
 exception when others then v_denied:=true;end;
 if not v_denied then raise exception 'WS cancelou venda paga sem Sandro';end if;

 perform set_config('request.jwt.claim.sub',v_sandro::text,true);
 select (r->>'power_received_in_month_cents')::bigint into v_before
 from public.get_power_ws_period_report(v_day,v_day+1) r;
 perform public.cancel_used_battery_sale_with_review(v_sale,
  'Venda duplicada, pagamento anterior necessita revisão',true);

 select count(*) into v_n from public.used_battery_sales where id=v_sale
 and cancelled_at is not null and cancelled_by=v_sandro;
 if v_n<>1 then raise exception 'Sandro não conseguiu cancelar a venda paga';end if;
 select id into v_review from public.used_sale_financial_reviews
 where sale_id=v_sale and paid_at_cancellation_cents=5000
 and status='pending' and created_by=v_sandro;
 if v_review is null then raise exception 'Conciliação não foi criada';end if;
 select count(*) into v_n from public.used_sale_revisions
 where sale_id=v_sale and action='cancelled' and actor_id=v_sandro
 and after_data->'financial_review'->>'status'='pending';
 if v_n<>1 then raise exception 'Cancelamento sem histórico financeiro';end if;
 select count(*) into v_n from public.used_battery_settlements
 where id=v_settlement and paid_cents=5000 and owed_cents=7500;
 if v_n<>1 then raise exception 'Pagamento anterior foi apagado';end if;
 select (r->>'power_received_in_month_cents')::bigint into v_after
 from public.get_power_ws_period_report(v_day,v_day+1) r;
 if v_before<>v_after then raise exception 'Cancelamento fez pagamento sumir do relatório';end if;
 select (r->>'financial_reviews_pending_count')::integer into v_n
 from public.get_power_ws_period_report(v_day,v_day+1) r;
 if v_n<1 then raise exception 'Relatório não mostra pendência';end if;

 perform set_config('request.jwt.claim.sub',v_ws::text,true);
 v_denied:=false;
 begin perform public.resolve_used_sale_financial_review(v_review,'refunded','WS não pode quitar');
 exception when others then v_denied:=true;end;
 if not v_denied then raise exception 'WS resolveu conciliação sem permissão';end if;

 perform set_config('request.jwt.claim.sub',v_sandro::text,true);
 perform public.resolve_used_sale_financial_review(v_review,'record_error',
  'O pagamento foi lançado por engano e conferido com o Wanderson');
 select count(*) into v_n from public.used_sale_financial_reviews
 where id=v_review and status='resolved' and resolved_by=v_sandro
 and resolution_method='record_error';
 if v_n<>1 then raise exception 'Resolução não foi auditada';end if;
 select count(*) into v_n from public.used_sale_financial_review_events
 where review_id=v_review and event='resolved' and actor_id=v_sandro;
 if v_n<>1 then raise exception 'Faltou log de conciliação';end if;
 v_denied:=false;
 begin perform public.resolve_used_sale_financial_review(v_review,'refunded','Confirmação duplicada');
 exception when others then v_denied:=true;end;
 if not v_denied then raise exception 'Conciliação marcada duas vezes';end if;
 if has_function_privilege('anon','public.cancel_used_battery_sale_with_review(uuid,text,boolean)','execute')
 or has_function_privilege('anon','public.resolve_used_sale_financial_review(uuid,text,text)','execute')
 then raise exception 'Visitantes possuem acesso financeiro';end if;

 raise notice 'PASSOU: editar cliente, cancelar venda com acerto pago, preservar pagamentos, conciliação e logs';
end;
$checks$;
