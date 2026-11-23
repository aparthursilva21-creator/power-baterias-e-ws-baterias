-- 012: impedir notificacoes de cobranca de vendas canceladas.
begin;
create or replace function public.pbws_remind_ws(p_settlement_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path = ''
as $func$
declare v_count int; v_total bigint; v_created int;
begin
  if auth.uid() is null or public.current_app_role() not in ('power','admin') then
    raise exception 'Somente Sandro ou administrador podem enviar cobrancas';
  end if;
  if p_settlement_ids is not null and cardinality(p_settlement_ids) not between 1 and 100 then
    raise exception 'Selecione entre 1 e 100 acertos';
  end if;
  if exists (
    select 1 from public.pbws_notifications
    where actor_id=auth.uid() and kind='reminder'
      and created_at>now()-interval '45 minutes'
  ) then
    raise exception 'Um lembrete ja foi enviado. Aguarde 45 minutos antes de reenviar';
  end if;
  select count(*),coalesce(sum(st.owed_cents-st.paid_cents-st.waived_cents),0)
  into v_count,v_total
  from public.used_battery_settlements st
  join public.used_battery_sales s on s.id=st.sale_id
  where s.cancelled_at is null
    and st.owed_cents>st.paid_cents+st.waived_cents
    and (p_settlement_ids is null or st.id=any(p_settlement_ids));

  if v_count=0 then raise exception 'Nao ha acertos pendentes para cobrar'; end if;
  v_created:=pbws_private.notify_roles(
    array['ws'],'reminder','Acertos pendentes com Sandro',
    'Voce tem '||v_count::text||' bateria(s) para acertar. Total: R$ '||
    to_char(v_total::numeric/100,'FM999999999990D00')||
    '. Abra Acertos para conferir.',
    'settlements',auth.uid()
  );
  if v_created=0 then
    raise exception 'Wanderson precisa entrar com o Google antes de receber lembretes';
  end if;
  return jsonb_build_object('count',v_count,'total_cents',v_total,'recipients',v_created);
end;
$func$;

create or replace function pbws_private.send_pending_daily_digest()
returns void
language plpgsql security definer set search_path=''
as $fn$
declare v_count integer;v_total bigint;v_day date;
begin
  perform pg_catalog.pg_advisory_xact_lock(72025591);
  v_day:=(now() at time zone 'America/Sao_Paulo')::date;
  if exists(
    select 1 from public.pbws_notifications
    where kind='reminder' and actor_id is null
      and (created_at at time zone 'America/Sao_Paulo')::date=v_day
  ) then return; end if;

  select count(*),coalesce(sum(st.owed_cents-st.paid_cents-st.waived_cents),0)
  into v_count,v_total
  from public.used_battery_settlements st
  join public.used_battery_sales s on s.id=st.sale_id
  where s.cancelled_at is null
    and st.owed_cents>st.paid_cents+st.waived_cents;
  if v_count=0 then return; end if;

  perform pbws_private.notify_roles(
    array['ws'],'reminder',
    'Resumo de acertos pendentes',
    'Existem '||v_count::text||' bateria(s) para acertar com Sandro. Saldo: R$ '||
    to_char(v_total::numeric/100,'FM999999999990D00')||'.',
    'settlements',null
  );
  perform pbws_private.notify_roles(
    array['power'],'reminder',
    'Acertos aguardando pagamento',
    'Wanderson possui '||v_count::text||' bateria(s) pendente(s). Total: R$ '||
    to_char(v_total::numeric/100,'FM999999999990D00')||'.',
    'settlements',null
  );
end;
$fn$;
commit;
