-- 008 — entrega automatica Web Push por webhook + repeticao de tentativas.
-- Necessita 007_notifications e a Edge Function pbws-push implantadas.
begin;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create function pbws_private.dispatch_push_request()
returns bigint
language plpgsql security definer set search_path=''
as $func$
declare v_token text; v_request_id bigint;
begin
  select sec.decrypted_secret into v_token
  from public.pbws_push_settings settings
  join vault.decrypted_secrets sec on sec.id=settings.dispatcher_secret_id
  where settings.id=true;
  if v_token is null then
    raise exception 'Token interno Web Push nao encontrado no Vault';
  end if;
  select net.http_post(
    url=>'https://drnhyzinnttrnqrbdpei.supabase.co/functions/v1/pbws-push',
    body=>'{"action":"dispatch"}'::jsonb,
    headers=>jsonb_build_object(
      'Content-Type','application/json',
      'x-pbws-dispatch',v_token
    ),
    timeout_milliseconds=>10000
  ) into v_request_id;
  return v_request_id;
end;
$func$;
revoke all on function pbws_private.dispatch_push_request()
  from public,anon,authenticated;

-- Faz disparo assim que ha entregas novas (apenas apos COMMIT).
create function pbws_private.trigger_push_request()
returns trigger
language plpgsql security definer set search_path=''
as $func$
begin
  perform pbws_private.dispatch_push_request();
  return null;
end;
$func$;
create trigger pbws_after_push_queue
after insert on public.pbws_push_deliveries
for each statement execute function pbws_private.trigger_push_request();

-- A cada 5 minutos: retoma envios que falharam, sem precisar abrir o site.
select cron.schedule(
  'pbws-push-retry-every-5-min',
  '*/5 * * * *',
  'select pbws_private.dispatch_push_request();'
);

commit;
