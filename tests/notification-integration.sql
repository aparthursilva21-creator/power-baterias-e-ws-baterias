-- Teste isolado da central de alertas (executar depois do fluxo empresarial).
set role authenticated;
do $notifications$
declare
  v_ws uuid:='00000000-0000-4000-8000-000000000003';
  v_power uuid:='00000000-0000-4000-8000-000000000002';
  v_admin uuid:='00000000-0000-4000-8000-000000000001';
  n integer; v_sale uuid; v_reminder jsonb; v_pending uuid;
  blocked boolean;
begin
  perform set_config('request.jwt.claim.sub',v_power::text,true);
  select count(*) into n from public.pbws_notifications
  where recipient_id=v_power and kind='sale';
  if n<>2 then raise exception 'Sandro deveria receber aviso por cada venda'; end if;
  perform set_config('request.jwt.claim.sub',v_ws::text,true);
  select count(*) into n from public.pbws_notifications
  where recipient_id=v_ws and kind='settlement';
  if n<>1 then raise exception 'WS deve receber um unico aviso do lote'; end if;
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  select count(*) into n from public.pbws_notifications
  where recipient_id=v_admin and kind in ('sale','settlement');
  if n<>3 then raise exception 'Administrador perdeu alertas'; end if;

  perform set_config('request.jwt.claim.sub',v_ws::text,true);
  v_sale:=public.register_direct_battery_sale(
    p_request_id=>'abababab-1234-4000-8000-000000000001'::uuid,
    p_brand=>'Teste',p_model=>'45Ah',
    p_transfer_price_cents=>3300,p_recovery_cost_cents=>0,
    p_sale_price_cents=>11000,p_customer_name=>'Pessoa de teste',
    p_payment_method=>'cash'
  );
  select id into v_pending from public.used_battery_settlements where sale_id=v_sale;

  perform set_config('request.jwt.claim.sub',v_power::text,true);
  blocked:=false;
  begin
    perform public.pbws_remind_ws(array[v_pending]);
  exception when others then blocked:=true; end;
  if not blocked then raise exception 'WS conseguiu enviar cobranca'; end if;

  perform set_config('request.jwt.claim.sub',v_power::text,true);
  v_reminder:=public.pbws_remind_ws(array[v_pending]);
  if (v_reminder->>'count')::int<>1 then raise exception 'Lembrete gerou contagem errada'; end if;
  perform set_config('request.jwt.claim.sub',v_ws::text,true);
  select count(*) into n from public.pbws_notifications
  where recipient_id=v_ws and kind='reminder';
  if n<>1 then raise exception 'Lembrete nao chegou na caixa da WS'; end if;

  blocked:=false;
  begin
    perform public.pbws_remind_ws(array[v_pending]);
  exception when others then blocked:=true; end;
  if not blocked then raise exception 'Lembrete duplicado nao foi barrado'; end if;

  select count(*) into n from public.pbws_notifications
   where recipient_id=v_ws and read_at is not null;
  if n<>0 then raise exception 'Notificacoes WS iniciaram lidas'; end if;

  perform set_config('request.jwt.claim.sub',v_ws::text,true);
  perform public.pbws_mark_notifications_read(null);
  select count(*) into n from public.pbws_notifications
   where recipient_id=v_ws and read_at is null;
  if n<>0 then raise exception 'WS nao marcou suas mensagens como lidas'; end if;
  perform set_config('request.jwt.claim.sub',v_power::text,true);
  select count(*) into n from public.pbws_notifications
   where recipient_id=v_power and read_at is null;
  if n<1 then raise exception 'WS marcou mensagem do Sandro por engano'; end if;

  raise notice 'PASSOU: venda, lote, lembrete, cooldown, leitura e isolacao de usuario';
end;
$notifications$;
