-- 009: lembrete diario apenas quando ha acertos pendentes.
-- 09:00 horario de Brasilia, sem duplicar se o cron repetir.
begin;

create function pbws_private.send_pending_daily_digest()
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

  select count(*),coalesce(sum(owed_cents-paid_cents-waived_cents),0)
  into v_count,v_total
  from public.used_battery_settlements
  where owed_cents>paid_cents+waived_cents;
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
revoke all on function pbws_private.send_pending_daily_digest()
  from public,anon,authenticated;

-- Cron Supabase executa em UTC; 12h UTC = 09h em Brasilia.
select cron.schedule(
  'pbws-daily-pending-09-brt',
  '0 12 * * *',
  'select pbws_private.send_pending_daily_digest();'
);
commit;
