-- Testes reais em Postgres de laboratório, com DO e RLS em papel autenticado.
insert into public.authorized_users(email,role) values
 ('admin@example.test','admin'),('sandro@example.test','power'),('wanderson@example.test','ws');
set role authenticated;
do $tests$
declare
 b1 uuid; b2 uuid; sale1 uuid; sale2 uuid; settle1 uuid; settle2 uuid;
 batch uuid; expense uuid; summary jsonb; n int; paid bigint; waived bigint;
 caught boolean;
begin
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
 if public.current_app_role()<>'ws' then raise exception 'role ws nao reconhecida'; end if;
 b1:=public.register_used_battery('Moura','60Ah',6000,20000,60,'SERIE-001','teste',1500);
 select count(*) into n from public.used_battery_settlements;
 if n<>0 then raise exception 'recebimento criou divida antes da venda'; end if;

 perform public.update_used_battery(b1,'available',6000,1500,20000,'recuperada');
 sale1:=public.register_used_battery_sale(b1,'Cliente Teste',20000,'pix',30,'111','AAA1A11','teste');
 select id into settle1 from public.used_battery_settlements where sale_id=sale1;
 if settle1 is null then raise exception 'venda nao gerou acerto'; end if;
 select count(*) into n from public.used_battery_settlements where battery_id=b1 and owed_cents=6000 and paid_cents=0;
 if n<>1 then raise exception 'acerto de venda errado'; end if;

 caught:=false;
 begin
   perform public.register_used_battery_sale(b1,'Venda duplicada',21000,'pix',30);
 exception when others then caught:=true; end;
 if not caught then raise exception 'aceitou venda duplicada'; end if;

 caught:=false;
 begin
   perform public.manage_used_settlement(settle1,'waive',null,'nao permitido');
 exception when others then caught:=true; end;
 if not caught then raise exception 'WS conseguiu dispensar acerto'; end if;

 b2:=public.register_used_battery('Heliar','70Ah',8000,25000,70,'SERIE-002','teste',1000);
 perform public.update_used_battery(b2,'available',8000,1000,25000,'recuperada');
 sale2:=public.register_used_battery_sale(b2,'Outro Cliente',25000,'cash',60);
 select id into settle2 from public.used_battery_settlements where sale_id=sale2;

 expense:=public.register_ws_expense(
    'gasoline',3500,(now() at time zone 'America/Sao_Paulo')::date,'Gasolina para entregas');
 if expense is null then raise exception 'despesa nao cadastrada'; end if;

 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 if public.current_app_role()<>'power' then raise exception 'role power nao reconhecida'; end if;

 batch:=public.settle_used_batteries_batch(jsonb_build_array(
   jsonb_build_object('settlement_id',settle1,'new_owed_cents',7000,
     'paid_now_cents',7000,'waive_remaining',false,'reason','Valor ajustado por Sandro'),
   jsonb_build_object('settlement_id',settle2,'new_owed_cents',8000,
     'paid_now_cents',4000,'waive_remaining',true,'reason','Dispensa autorizada por Sandro')
 ),'pix','REC-2026-01','teste de acerto combinado');
 if batch is null then raise exception 'nao gerou lote'; end if;
 select total_paid_cents,total_waived_cents into paid,waived
   from public.used_settlement_batches where id=batch;
 if paid<>11000 or waived<>4000 then
    raise exception 'total do lote incorreto: % + %',paid,waived;
 end if;
 select count(*) into n from public.used_battery_settlements
   where battery_id in (b1,b2) and owed_cents=paid_cents+waived_cents;
 if n<>2 then raise exception 'baterias nao foram encerradas'; end if;
 select count(*) into n from public.used_settlement_batch_items where batch_id=batch;
 if n<>2 then raise exception 'lote nao tem itens'; end if;
 select count(*) into n from public.used_settlement_events
   where batch_id=batch and occurred_at is not null and actor_id is not null;
 if n<2 then raise exception 'auditoria do lote ausente'; end if;

 caught:=false;
 begin
   perform public.settle_used_batteries_batch(jsonb_build_array(
      jsonb_build_object('settlement_id',settle1,'paid_now_cents',100)
   ),'pix');
 exception when others then caught:=true; end;
 if not caught then raise exception 'duplicou acerto encerrado'; end if;

 summary:=public.get_power_ws_monthly_report((now() at time zone 'America/Sao_Paulo')::date);
 if (summary->>'sales_count')::bigint<>2 then raise exception 'relatorio do Sandro incorreto'; end if;
 if summary->>'ws_expenses_cents'<>'null' and summary->'ws_expenses_cents' <> 'null'::jsonb then
   raise exception 'Sandro visualizou gasto interno WS';
 end if;

 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
 summary:=public.get_power_ws_monthly_report((now() at time zone 'America/Sao_Paulo')::date);
 if (summary->>'ws_expenses_cents')::bigint<>3500 then raise exception 'despesa nao entrou no resumo'; end if;
 select count(*) into n from public.used_battery_sales where sold_at is not null and sold_by is not null;
 if n<>2 then raise exception 'venda sem data ou responsavel'; end if;
 select count(*) into n from public.used_settlement_batches where settled_at is not null and created_by is not null;
 if n<>1 then raise exception 'lote sem data ou responsavel'; end if;

 raise notice 'PASSOU: recebimento, venda unica, perfiis, lote, despesa, relatorio, auditoria';
end;
$tests$;
