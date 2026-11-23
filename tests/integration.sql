-- Testes de integração em PostgreSQL isolado, SEM dados reais.
insert into public.authorized_users(email,role) values
 ('admin@example.test','admin'),('sandro@example.test','power'),('wanderson@example.test','ws');
set role authenticated;
do $tests$
declare
 req1 uuid := '11111111-1111-4111-8111-111111111111';
 req2 uuid := '22222222-2222-4222-8222-222222222222';
 sale1 uuid; sale2 uuid; repeated uuid; b1 uuid; b2 uuid; s1 uuid; s2 uuid;
 batch uuid; expense uuid; summary jsonb; n int; paid bigint; waived bigint;
 blocked boolean;
begin
 -- Wanderson lança bateria já vendida: sem cadastro prévio de estoque.
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
 if public.current_app_role()<>'ws' then raise exception 'Perfil WS inválido'; end if;
 sale1:=public.register_direct_battery_sale(
   p_request_id=>req1, p_brand=>'Moura', p_model=>'60Ah',
   p_transfer_price_cents=>6000, p_recovery_cost_cents=>1500,
   p_sale_price_cents=>20000, p_customer_name=>'Cliente Exemplo',
   p_payment_method=>'pix', p_warranty_days=>30,
   p_amperage_ah=>60, p_serial_number=>'SERIE-1'
 );
 if sale1 is null then raise exception 'Venda não criada'; end if;
 repeated:=public.register_direct_battery_sale(
   p_request_id=>req1, p_brand=>'Moura', p_model=>'60Ah',
   p_transfer_price_cents=>6000, p_recovery_cost_cents=>1500,
   p_sale_price_cents=>20000, p_customer_name=>'Cliente Exemplo',
   p_payment_method=>'pix', p_warranty_days=>30
 );
 if repeated <> sale1 then raise exception 'Repetição criou nova venda'; end if;
 select count(*) into n from public.used_battery_sales;
 if n<>1 then raise exception 'Venda duplicada após repetição'; end if;
 select count(*) into n from public.used_batteries;
 if n<>1 then raise exception 'Cadastro duplicado de bateria'; end if;
 select battery_id into b1 from public.used_battery_sales where id=sale1;
 select id into s1 from public.used_battery_settlements where sale_id=sale1;
 if s1 is null then raise exception 'Venda não criou acerto'; end if;
 select count(*) into n from public.used_batteries
   where id=b1 and status='sold' and transfer_price_cents=6000
     and recovery_cost_cents=1500;
 if n<>1 then raise exception 'Bateria não entrou diretamente como vendida'; end if;
 select count(*) into n from public.used_battery_settlements
   where id=s1 and owed_cents=6000 and paid_cents=0;
 if n<>1 then raise exception 'Acerto pendente incorreto'; end if;

 blocked:=false;
 begin
  perform public.register_used_battery('Antigo','estoque',6000,15000);
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'API antiga de estoque ainda liberada'; end if;
 blocked:=false;
 begin
  perform public.manage_used_settlement(s1,'waive',null,'não pode');
 exception when others then blocked:=true; end;
 if not blocked then raise exception 'WS alterou acerto sem autorização'; end if;

 -- Segundo lançamento direto, sem relação com saldo anterior.
 sale2:=public.register_direct_battery_sale(
   p_request_id=>req2,p_brand=>'Heliar',p_model=>'70Ah',
   p_transfer_price_cents=>8000,p_recovery_cost_cents=>1000,
   p_sale_price_cents=>25000,p_customer_name=>'Outra Pessoa',
   p_payment_method=>'cash',p_warranty_days=>60
 );
 select battery_id into b2 from public.used_battery_sales where id=sale2;
 select id into s2 from public.used_battery_settlements where sale_id=sale2;

 blocked:=false;
 begin
  perform public.register_direct_battery_sale(
   p_request_id=>'33333333-3333-4333-8333-333333333333',
   p_brand=>'Invalida',p_model=>'1',p_transfer_price_cents=>0,
   p_recovery_cost_cents=>0,p_sale_price_cents=>1200,
   p_customer_name=>'Cliente',p_payment_method=>'pix'
  );
 exception when others then blocked:=true; end;
 if not blocked then raise exception 'Aceitou repasse zero'; end if;
 select count(*) into n from public.used_batteries;
 if n<>2 then raise exception 'Venda com erro deixou bateria órfã'; end if;

 expense:=public.register_ws_expense(
  'gasoline',3500,(now() at time zone 'America/Sao_Paulo')::date,'Gasolina da entrega');
 if expense is null then raise exception 'Despesa não registrada'; end if;

 -- Sandro vê as vendas mas só ele/admin marca como recebido.
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 if public.current_app_role()<>'power' then raise exception 'Perfil Power inválido'; end if;
 blocked:=false;
 begin
  perform public.register_direct_battery_sale(
   p_request_id=>'44444444-4444-4444-8444-444444444444',
   p_brand=>'Moura',p_model=>'45Ah',p_transfer_price_cents=>4000,
   p_recovery_cost_cents=>0,p_sale_price_cents=>10000,
   p_customer_name=>'Cliente',p_payment_method=>'pix'
  );
 exception when others then blocked:=true; end;
 if not blocked then raise exception 'Sandro lançou venda indevidamente'; end if;

 batch:=public.settle_used_batteries_batch(jsonb_build_array(
   jsonb_build_object('settlement_id',s1,'new_owed_cents',7000,
    'paid_now_cents',7000,'waive_remaining',false,'reason','Ajuste autorizado por Sandro'),
   jsonb_build_object('settlement_id',s2,'new_owed_cents',8000,
    'paid_now_cents',4000,'waive_remaining',true,'reason','Dispensa autorizada por Sandro')
 ),'pix','LOTE-001','Conciliação de duas baterias');
 select total_paid_cents,total_waived_cents into paid,waived
  from public.used_settlement_batches where id=batch;
 if paid<>11000 or waived<>4000 then raise exception 'Soma do lote incorreta'; end if;
 select count(*) into n from public.used_battery_settlements
  where battery_id in (b1,b2) and owed_cents=paid_cents+waived_cents;
 if n<>2 then raise exception 'Acertos não ficaram quitados'; end if;
 select count(*) into n from public.used_settlement_events
  where batch_id=batch and actor_id is not null and occurred_at is not null;
 if n<2 then raise exception 'Falta auditoria do acerto'; end if;
 blocked:=false;
 begin
  perform public.settle_used_batteries_batch(jsonb_build_array(
   jsonb_build_object('settlement_id',s1,'paid_now_cents',100)
  ),'pix');
 exception when others then blocked:=true; end;
 if not blocked then raise exception 'Acerto quitado foi repetido'; end if;

 summary:=public.get_power_ws_monthly_report((now() at time zone 'America/Sao_Paulo')::date);
 if (summary->>'sales_count')::bigint<>2 then raise exception 'Relatório Power incorreto'; end if;
 if (summary->'ws_expenses_cents') <> 'null'::jsonb then
  raise exception 'Sandro visualizou despesas privadas da WS';
 end if;

 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
 summary:=public.get_power_ws_monthly_report((now() at time zone 'America/Sao_Paulo')::date);
 if (summary->>'ws_expenses_cents')::bigint<>3500 then
  raise exception 'Despesas ausentes no relatório WS';
 end if;
 select count(*) into n from public.used_battery_sales
  where sold_at is not null and sold_by is not null;
 if n<>2 then raise exception 'Venda sem data e responsável'; end if;
 select count(*) into n from public.used_settlement_batches
  where settled_at is not null and created_by is not null;
 if n<>1 then raise exception 'Acerto sem hora e responsável'; end if;
 raise notice 'PASSOU: venda direta sem estoque, idempotência, perfis, lote, despesas, auditoria e relatórios';
end;
$tests$;
