-- 007: central de notificacoes privada + inscricoes Web Push (Power × WS).
-- Nao modifica vendas/acertos existentes. Todas as gravacoes sao no servidor.
begin;

create schema if not exists pbws_private;
revoke all on schema pbws_private from public, anon, authenticated;

create table public.pbws_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('sale','settlement','reminder','settlement_update')),
  title text not null check (char_length(title) between 1 and 130),
  body text not null check (char_length(body) between 1 and 350),
  target text not null default 'dashboard'
    check (target in ('dashboard','sales','settlements','reports')),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index pbws_notif_recipient_idx on public.pbws_notifications
  (recipient_id, created_at desc);
create index pbws_notif_unread_idx on public.pbws_notifications
  (recipient_id, created_at desc) where read_at is null;

create table public.pbws_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 30 and 2048),
  p256dh text not null check (char_length(p256dh) between 40 and 150),
  auth_secret text not null check (char_length(auth_secret) between 12 and 80),
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz
);
create index pbws_push_by_user on public.pbws_push_subscriptions(user_id);

create table public.pbws_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.pbws_notifications(id) on delete cascade,
  subscription_id uuid not null references public.pbws_push_subscriptions(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','processing','sent','failed')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  unique(notification_id,subscription_id)
);
create index pbws_push_pending on public.pbws_push_deliveries(next_attempt_at)
  where status in ('pending','processing');

create table public.pbws_push_settings (
  id boolean primary key default true check(id),
  vapid_public_key text,
  vapid_private_secret_id uuid,
  dispatcher_secret_id uuid not null,
  created_at timestamptz not null default now()
);
-- O token de disparo fica criptografado no Vault, fora do GitHub.
insert into public.pbws_push_settings (id,dispatcher_secret_id)
values (
  true,
  vault.create_secret(
    encode(extensions.gen_random_bytes(32),'hex'),
    'pbws_push_dispatch_token',
    'Chave interna de webhook do projeto Power WS'
  )
);

alter table public.pbws_notifications enable row level security;
alter table public.pbws_push_subscriptions enable row level security;
alter table public.pbws_push_deliveries enable row level security;
alter table public.pbws_push_settings enable row level security;

revoke all on public.pbws_notifications,public.pbws_push_subscriptions,
  public.pbws_push_deliveries,public.pbws_push_settings
  from public,anon,authenticated;
grant select on public.pbws_notifications,public.pbws_push_subscriptions
  to authenticated;

create policy "read own notifications" on public.pbws_notifications for select to authenticated
  using (recipient_id = (select auth.uid())
    and (select public.current_app_role()) is not null);
create policy "read own push devices" on public.pbws_push_subscriptions for select to authenticated
  using (user_id = (select auth.uid())
    and (select public.current_app_role()) is not null);

-- Internal helper: o servidor, e nunca o navegador, escolhe os destinatarios.
create function pbws_private.notify_roles(
  p_roles text[], p_kind text, p_title text,p_body text,p_target text,
  p_actor uuid default null
) returns integer
language plpgsql security definer set search_path = ''
as $func$
declare v_count integer;
begin
  insert into public.pbws_notifications
    (recipient_id, actor_id, kind, title, body, target)
  select distinct u.id,p_actor,p_kind,left(p_title,130),left(p_body,350),p_target
  from public.authorized_users a
  join auth.users u on lower(btrim(u.email))=lower(btrim(a.email))
  join auth.identities i on i.user_id=u.id and i.provider='google'
  where a.active=true and a.role=any(p_roles)
    and u.email_confirmed_at is not null
    and (p_actor is null or u.id<>p_actor);
  get diagnostics v_count=row_count;
  return v_count;
end;
$func$;
revoke all on function pbws_private.notify_roles(text[],text,text,text,text,uuid)
  from public,anon,authenticated;

-- A venda nova gera alerta para Sandro + administrador.
create function pbws_private.on_sale_notification()
returns trigger language plpgsql security definer set search_path = ''
as $func$
declare
  v_b public.used_batteries%rowtype;
begin
  select * into v_b from public.used_batteries where id=new.battery_id;
  perform pbws_private.notify_roles(
    array['power','admin'],'sale',
    'Nova venda registrada',
    'Bateria '||coalesce(v_b.brand,'')||' '||coalesce(v_b.model,'')||
    ' vendida. Repasse previsto: R$ '||
    to_char(coalesce(v_b.transfer_price_cents,0)::numeric/100,'FM999999999990D00')||'.',
    'settlements',new.sold_by
  );
  return new;
end;
$func$;
create trigger pbws_after_sale_notify
after insert on public.used_battery_sales
for each row execute function pbws_private.on_sale_notification();

-- Liquidacoes avulsas alertam Wanderson; lote gera alerta unico abaixo.
create function pbws_private.on_settlement_event_notification()
returns trigger language plpgsql security definer set search_path = ''
as $func$
declare v_message text;
begin
  if new.batch_id is not null or new.action not in
    ('payment','waiver','reopen','payment_correction','amount_adjustment')
    then return new;
  end if;

  v_message := case new.action
    when 'payment' then 'Sandro registrou um pagamento de R$ '||
      to_char((new.new_paid_cents-new.old_paid_cents)::numeric/100,'FM999999999990D00')||'.'
    when 'waiver' then 'Sandro dispensou um saldo pendente.'
    when 'reopen' then 'Um acerto foi reaberto e precisa ser conferido.'
    when 'payment_correction' then 'Um pagamento anterior foi corrigido.'
    else 'O valor de repasse de uma bateria foi ajustado.'
  end;
  perform pbws_private.notify_roles(
    array['ws','admin'],'settlement_update',
    'Atualizacao de acerto',v_message,'settlements',new.actor_id
  );
  return new;
end;
$func$;
create trigger pbws_after_settlement_event_notify
after insert on public.used_settlement_events
for each row execute function pbws_private.on_settlement_event_notification();

-- So avisar uma vez por lote, evitando 10 notificacoes para 10 baterias.
create function pbws_private.on_settlement_batch_notification()
returns trigger language plpgsql security definer set search_path = ''
as $func$
declare v_items integer;
begin
  if new.total_paid_cents=old.total_paid_cents
     and new.total_waived_cents=old.total_waived_cents then return new; end if;
  select count(*) into v_items from public.used_settlement_batch_items where batch_id=new.id;
  perform pbws_private.notify_roles(
    array['ws','admin'],'settlement',
    'Acerto em lote confirmado',
    'Sandro concluiu o acerto de '||v_items::text||
    ' bateria(s). Recebido: R$ '||
    to_char(new.total_paid_cents::numeric/100,'FM999999999990D00')||'.',
    'settlements',new.created_by
  );
  return new;
end;
$func$;
create trigger pbws_after_batch_notify
after update on public.used_settlement_batches
for each row execute function pbws_private.on_settlement_batch_notification();

-- Cada dispositivo ativo recebe sua entrega quando uma notificacao e criada.
create function pbws_private.on_notification_delivery()
returns trigger language plpgsql security definer set search_path = ''
as $func$
begin
  insert into public.pbws_push_deliveries(notification_id,subscription_id)
  select new.id,s.id from public.pbws_push_subscriptions s
  where s.user_id=new.recipient_id and s.disabled_at is null;
  return new;
end;
$func$;
create trigger pbws_queue_push
after insert on public.pbws_notifications
for each row execute function pbws_private.on_notification_delivery();

-- Ler apenas as mensagens da propria conta.
create function public.pbws_mark_notifications_read(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = ''
as $func$
declare v_count int;
begin
  if auth.uid() is null or public.current_app_role() is null then
    raise exception 'Conta nao autorizada';
  end if;
  if p_ids is not null and cardinality(p_ids)>200 then
    raise exception 'Selecione ate 200 mensagens';
  end if;
  update public.pbws_notifications
  set read_at=now()
  where recipient_id=auth.uid() and read_at is null
  and (p_ids is null or id=any(p_ids));
  get diagnostics v_count=row_count;
  return v_count;
end;
$func$;

-- Vincular a inscricao do navegador ao usuario autenticado.
create function public.pbws_save_push_subscription(
  p_endpoint text,p_p256dh text,p_auth text,p_user_agent text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $func$
declare v_id uuid; v_hostname text;
begin
  if auth.uid() is null or public.current_app_role() is null then
    raise exception 'Conta nao autorizada';
  end if;
  if p_endpoint is null or char_length(p_endpoint) not between 30 and 2048
     or left(p_endpoint,8)<>'https://' then
    raise exception 'Endpoint de notificacao invalido';
  end if;
  v_hostname:=lower(split_part(split_part(substring(p_endpoint from 9), '/',1),':',1));
  if v_hostname not in ('fcm.googleapis.com','updates.push.services.mozilla.com',
                         'push.services.mozilla.com','updates.push.services.mozilla.org')
     and v_hostname !~ '(^|[.])push[.]apple[.]com$' then
    raise exception 'Provedor de notificacao nao aceito';
  end if;
  if char_length(coalesce(p_p256dh,'')) not between 40 and 150
     or char_length(coalesce(p_auth,'')) not between 12 and 80 then
    raise exception 'Chaves de inscricao invalidas';
  end if;

  insert into public.pbws_push_subscriptions
    (user_id,endpoint,p256dh,auth_secret,user_agent,updated_at,disabled_at)
  values (auth.uid(),p_endpoint,p_p256dh,p_auth,left(p_user_agent,250),now(),null)
  on conflict(endpoint) do update set
    user_id=excluded.user_id,
    p256dh=excluded.p256dh,
    auth_secret=excluded.auth_secret,
    user_agent=excluded.user_agent,
    updated_at=now(), disabled_at=null
  returning id into v_id;
  return v_id;
end;
$func$;

create function public.pbws_disable_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = ''
as $func$
begin
  if auth.uid() is null or public.current_app_role() is null then
    raise exception 'Conta nao autorizada';
  end if;
  update public.pbws_push_subscriptions
  set disabled_at=now(),updated_at=now()
  where endpoint=p_endpoint and user_id=auth.uid();
end;
$func$;

-- Sandro pode cobrar um ou varios acertos por push e pela central.
-- Limite de 1 lembrete a cada 45 minutos para evitar spam.
create function public.pbws_remind_ws(p_settlement_ids uuid[] default null)
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
  select count(*),coalesce(sum(owed_cents-paid_cents-waived_cents),0)
  into v_count,v_total from public.used_battery_settlements
  where owed_cents>paid_cents+waived_cents
    and (p_settlement_ids is null or id=any(p_settlement_ids));

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

-- Somente service_role pode ler credenciais de entrega descriptografadas.
create function public.pbws_push_server_config()
returns jsonb language plpgsql stable security definer set search_path = ''
as $func$
declare v_public text;v_private text;v_dispatch text;
begin
  if auth.role() <> 'service_role' then raise exception 'Somente servidor'; end if;
  select p.vapid_public_key,priv.decrypted_secret,dispatch.decrypted_secret
  into v_public,v_private,v_dispatch
  from public.pbws_push_settings p
  join vault.decrypted_secrets dispatch on dispatch.id=p.dispatcher_secret_id
  left join vault.decrypted_secrets priv on priv.id=p.vapid_private_secret_id
  where p.id=true;
  return jsonb_build_object('public_key',v_public,'private_key',v_private,'dispatch',v_dispatch);
end;
$func$;

create function public.pbws_push_initialize_keys(p_public text,p_private text)
returns text language plpgsql security definer set search_path = ''
as $func$
declare v_existing text;v_secret uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Somente servidor'; end if;
  if char_length(coalesce(p_public,'')) not between 85 and 100
    or char_length(coalesce(p_private,'')) not between 40 and 65 then
    raise exception 'Chaves VAPID invalidas';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(72025589);
  select vapid_public_key into v_existing from public.pbws_push_settings where id=true;
  if v_existing is not null then return v_existing; end if;
  v_secret:=vault.create_secret(p_private,'pbws_vapid_private','Chave VAPID privada do Power WS');
  update public.pbws_push_settings
  set vapid_public_key=p_public,vapid_private_secret_id=v_secret where id=true;
  return p_public;
end;
$func$;

-- Servidor captura entregas atomicas, recuperando tentativas presas ha 3 min.
create function public.pbws_push_claim_deliveries(p_limit integer default 12)
returns table(
 delivery_id uuid,endpoint text,p256dh text,auth_secret text,
 title text,body text,target text
) language sql security definer set search_path = ''
as $func$
  with pending as (
    select d.id from public.pbws_push_deliveries d
    join public.pbws_push_subscriptions s on s.id=d.subscription_id
    join public.pbws_notifications n on n.id=d.notification_id
    join auth.users u on u.id=n.recipient_id
    join public.authorized_users a on a.email=lower(btrim(u.email))
    where auth.role()='service_role'
      and a.active=true and s.disabled_at is null
      and d.attempts<5
      and ((d.status='pending' and d.next_attempt_at<=now())
        or (d.status='processing' and d.last_attempt_at<now()-interval '3 minutes'))
    order by d.next_attempt_at,d.id
    for update of d skip locked
    limit greatest(1,least(coalesce(p_limit,12),30))
  ),claimed as (
    update public.pbws_push_deliveries d
    set status='processing',attempts=d.attempts+1,last_attempt_at=now()
    from pending p where d.id=p.id returning d.*
  )
  select d.id,s.endpoint,s.p256dh,s.auth_secret,n.title,n.body,n.target
  from claimed d
  join public.pbws_push_subscriptions s on s.id=d.subscription_id
  join public.pbws_notifications n on n.id=d.notification_id;
$func$;

create function public.pbws_push_complete_delivery(
 p_delivery_id uuid,p_success boolean,p_gone boolean default false,p_error text default null
) returns void language plpgsql security definer set search_path = ''
as $func$
declare v_sub uuid;
begin
  if auth.role()<>'service_role' then raise exception 'Somente servidor'; end if;
  update public.pbws_push_deliveries
  set status=case when p_success then 'sent'
                  when p_gone or attempts>=5 then 'failed'
                  else 'pending' end,
      delivered_at=case when p_success then now() else delivered_at end,
      next_attempt_at=now() + interval '1 minute' *
        (case when attempts=1 then 1 when attempts=2 then 3 else 10 end),
      last_error=case when p_success then null else left(p_error,300) end
  where id=p_delivery_id and status='processing'
  returning subscription_id into v_sub;
  if p_gone and v_sub is not null then
    update public.pbws_push_subscriptions
    set disabled_at=now(),updated_at=now()
    where id=v_sub;
  end if;
end;
$func$;

-- Nenhuma RPC privilegiada acessivel ao publico.
revoke execute on function public.pbws_push_server_config() from public,anon,authenticated;
revoke execute on function public.pbws_push_initialize_keys(text,text) from public,anon,authenticated;
revoke execute on function public.pbws_push_claim_deliveries(integer) from public,anon,authenticated;
revoke execute on function public.pbws_push_complete_delivery(uuid,boolean,boolean,text)
  from public,anon,authenticated;
grant execute on function public.pbws_push_server_config() to service_role;
grant execute on function public.pbws_push_initialize_keys(text,text) to service_role;
grant execute on function public.pbws_push_claim_deliveries(integer) to service_role;
grant execute on function public.pbws_push_complete_delivery(uuid,boolean,boolean,text)
 to service_role;

revoke execute on function public.pbws_mark_notifications_read(uuid[]) from public,anon;
revoke execute on function public.pbws_save_push_subscription(text,text,text,text) from public,anon;
revoke execute on function public.pbws_disable_push_subscription(text) from public,anon;
revoke execute on function public.pbws_remind_ws(uuid[]) from public,anon;
grant execute on function public.pbws_mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.pbws_save_push_subscription(text,text,text,text)
 to authenticated;
grant execute on function public.pbws_disable_push_subscription(text) to authenticated;
grant execute on function public.pbws_remind_ws(uuid[]) to authenticated;

commit;
