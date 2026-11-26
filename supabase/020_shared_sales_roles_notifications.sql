-- 020: trabalho compartilhado Sandro/WS, lançamento exclusivo da WS e alertas para ambos.
-- Ajusta apenas funções e políticas; sem excluir ou alterar vendas existentes.
begin;

create or replace function public.correct_used_battery_sale(
  p_sale_id uuid, p_patch jsonb, p_reason text
) returns void
language plpgsql security definer set search_path=''
as $fn$
declare
  v_role text;
  v_sale public.used_battery_sales%rowtype;
  v_b public.used_batteries%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_brand text;
  v_model text;
  v_customer text;
  v_sale_price bigint;
  v_cost bigint;
  v_warranty int;
  v_amperage int;
  v_method text;
  v_invalid text;
  v_date timestamptz;
begin
  v_role:=public.current_app_role();
  if auth.uid() is null or v_role not in ('admin','ws','power') then
    raise exception 'Seu perfil não pode corrigir vendas';
  end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 5 and 500 then
    raise exception 'Explique a correção (mínimo 5 caracteres)';
  end if;
  if p_patch is null or jsonb_typeof(p_patch)<>'object' then
    raise exception 'Dados da correção inválidos';
  end if;
  select key into v_invalid from jsonb_object_keys(p_patch) key
   where key not in ('brand','model','amperage_ah','serial_number',
   'customer_name','customer_phone','vehicle_plate','sale_price_cents',
   'payment_method','warranty_days','recovery_cost_cents','notes','sold_at_local')
   limit 1;
  if v_invalid is not null then
    raise exception 'Campo não pode ser alterado: %',v_invalid;
  end if;
  select * into v_sale from public.used_battery_sales
   where id=p_sale_id for update;
  if not found or v_sale.cancelled_at is not null then
    raise exception 'Venda não encontrada ou já cancelada';
  end if;
  -- Power e WS podem corrigir qualquer venda ativa; autor original permanece na auditoria.
  if p_patch?'sold_at_local' then
    -- Todas as vendas podem ter data real corrigida, não apenas importações.
    -- O momento de registro e o responsável original permanecem imutáveis.
    if nullif(btrim(p_patch->>'sold_at_local'),'') is null then
      raise exception 'Informe data e hora válidas da venda';
    end if;
    v_date:=(p_patch->>'sold_at_local')::timestamp at time zone 'America/Sao_Paulo';
    if v_date is null or v_date<'2000-01-01'::timestamptz or v_date>now() then
      raise exception 'A data da venda deve ser válida e não pode estar no futuro';
    end if;
    -- Não permitir que a venda passe a ter horário posterior a pagamento
    -- já confirmado. Eventos antigos e normais usam effective_at.
    if exists (
      select 1 from public.used_settlement_events e
      join public.used_battery_settlements st on st.id=e.settlement_id
      where st.sale_id=v_sale.id
        and e.action in ('payment','payment_correction','historical_payment')
        and e.new_paid_cents > e.old_paid_cents
        and e.effective_at < v_date
    ) then
      raise exception 'A data da venda não pode ser posterior ao pagamento já registrado';
    end if;
  end if;
  select * into v_b from public.used_batteries
   where id=v_sale.battery_id for update;
  if not found then raise exception 'Bateria vinculada não encontrada'; end if;
  v_before:=jsonb_build_object('sale',to_jsonb(v_sale),'battery',to_jsonb(v_b));
  v_brand:=coalesce(p_patch->>'brand',v_b.brand);
  v_model:=coalesce(p_patch->>'model',v_b.model);
  v_customer:=coalesce(p_patch->>'customer_name',v_sale.customer_name);
  v_sale_price:=coalesce((p_patch->>'sale_price_cents')::bigint,v_sale.sale_price_cents);
  v_cost:=coalesce((p_patch->>'recovery_cost_cents')::bigint,v_b.recovery_cost_cents);
  v_warranty:=coalesce((p_patch->>'warranty_days')::int,v_sale.warranty_days);
  v_amperage:=coalesce((p_patch->>'amperage_ah')::int,v_b.amperage_ah);
  v_method:=coalesce(p_patch->>'payment_method',v_sale.payment_method);
  if char_length(btrim(v_brand)) not between 1 and 100
    or char_length(btrim(v_model)) not between 1 and 120
    or char_length(btrim(v_customer)) not between 1 and 160 then
    raise exception 'Marca, modelo e cliente são obrigatórios';
  end if;
  if v_sale_price<=0 or v_cost<0 or
     v_warranty not between 0 and 365 or
     (v_amperage is not null and v_amperage not between 1 and 500) then
    raise exception 'Preço, custo, garantia ou amperagem inválidos';
  end if;
  if v_method not in ('pix','cash','card','other') then
    raise exception 'Forma de pagamento inválida';
  end if;
  if char_length(coalesce(p_patch->>'serial_number',''))>120
    or char_length(coalesce(p_patch->>'customer_phone',''))>30
    or char_length(coalesce(p_patch->>'vehicle_plate',''))>15
    or char_length(coalesce(p_patch->>'notes',''))>1200 then
    raise exception 'Um dos campos de texto ultrapassa o tamanho permitido';
  end if;

  update public.used_batteries set
    brand=btrim(v_brand), model=btrim(v_model), amperage_ah=v_amperage,
    serial_number=case when p_patch?'serial_number'
      then nullif(btrim(p_patch->>'serial_number'),'') else serial_number end,
    recovery_cost_cents=v_cost,asking_price_cents=v_sale_price,
    updated_at=now()
  where id=v_b.id;

  update public.used_battery_sales set
    customer_name=btrim(v_customer),
    customer_phone=case when p_patch?'customer_phone'
      then nullif(btrim(p_patch->>'customer_phone'),'') else customer_phone end,
    vehicle_plate=case when p_patch?'vehicle_plate'
      then nullif(btrim(p_patch->>'vehicle_plate'),'') else vehicle_plate end,
    sale_price_cents=v_sale_price,payment_method=v_method,
    warranty_days=v_warranty,
    sold_at=coalesce(v_date,v_sale.sold_at),
    notes=case when p_patch?'notes'
      then nullif(btrim(p_patch->>'notes'),'') else notes end
  where id=p_sale_id;

  select jsonb_build_object('sale',to_jsonb(s),'battery',to_jsonb(b))
  into v_after
  from public.used_battery_sales s
  join public.used_batteries b on b.id=s.battery_id
  where s.id=p_sale_id;
  if v_before=v_after then raise exception 'Nenhum dado foi alterado'; end if;
  insert into public.used_sale_revisions
    (sale_id,action,reason,before_data,after_data,actor_id)
  values(p_sale_id,'corrected',btrim(p_reason),v_before,v_after,auth.uid());

  perform pbws_private.notify_roles(
    array['power','ws','admin'],'sale',
    case when v_date is not null and v_date is distinct from v_sale.sold_at
      then 'Data e hora da venda corrigidas' else 'Venda corrigida' end,
    case when v_date is not null and v_date is distinct from v_sale.sold_at
      then 'Data e hora da venda de '||v_brand||' '||v_model||' foram corrigidas por '||
        case v_role when 'power' then 'Sandro' when 'ws' then 'Wanderson' else 'administrador' end||'. Consulte o histórico.'
      else 'Venda de '||v_brand||' '||v_model||' corrigida por '||
        case v_role when 'power' then 'Sandro' when 'ws' then 'Wanderson' else 'administrador' end||'. Consulte o histórico.'
    end,
    'sales',auth.uid());
end;
$fn$;
create or replace function public.register_historical_battery_sale(
  p_request_id uuid,
  p_sold_at_local timestamp without time zone,
  p_brand text,
  p_model text,
  p_transfer_price_cents bigint,
  p_recovery_cost_cents bigint,
  p_sale_price_cents bigint,
  p_customer_name text,
  p_payment_method text,
  p_warranty_days integer default 30,
  p_amperage_ah integer default null,
  p_serial_number text default null,
  p_customer_phone text default null,
  p_vehicle_plate text default null,
  p_notes text default null,
  p_paid_at_local timestamp without time zone default null,
  p_prior_paid_cents bigint default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_battery_id uuid;
  v_sale_id uuid;
  v_settlement_id uuid;
  v_existing_seller uuid;
  v_sold_at timestamptz;
  v_paid_at timestamptz;
  v_role text;
begin
  v_role:=public.current_app_role();
  if auth.uid() is null or v_role <> 'ws' then
    raise exception 'Somente a WS Baterias registra vendas, inclusive antigas';
  end if;
  if p_sold_at_local is null then raise exception 'Informe data e horário da venda anterior'; end if;
  v_sold_at:=p_sold_at_local at time zone 'America/Sao_Paulo';
  if v_sold_at < '2000-01-01'::timestamptz or v_sold_at > now() then
    raise exception 'Venda histórica precisa ter uma data passada válida';
  end if;
  if p_prior_paid_cents is null or p_prior_paid_cents < 0 or
     (p_prior_paid_cents>0 and p_paid_at_local is null) or
     (p_prior_paid_cents=0 and p_paid_at_local is not null) then
    raise exception 'Informe a data do acerto antigo quando houver pagamento';
  end if;
  if p_prior_paid_cents > 0 then
    v_paid_at:=p_paid_at_local at time zone 'America/Sao_Paulo';
    if v_paid_at < v_sold_at or v_paid_at > now() then
      raise exception 'Pagamento antigo precisa ocorrer entre a venda e hoje';
    end if;
  end if;
  if p_request_id is null then
    raise exception 'Identificador de lançamento obrigatório';
  end if;

  -- Evita que dois pedidos simultâneos com o mesmo identificador avancem juntos.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));
  select id, sold_by into v_sale_id, v_existing_seller
    from public.used_battery_sales
    where client_request_id = p_request_id;
  if found then
    if v_existing_seller <> auth.uid() then
      raise exception 'Identificador de venda já utilizado por outra conta';
    end if;
    return v_sale_id;
  end if;

  if char_length(btrim(coalesce(p_brand, ''))) not between 1 and 100
     or char_length(btrim(coalesce(p_model, ''))) not between 1 and 120 then
    raise exception 'Informe marca e modelo da bateria';
  end if;
  if p_amperage_ah is not null and p_amperage_ah not between 1 and 500 then
    raise exception 'Amperagem inválida';
  end if;
  if char_length(coalesce(p_serial_number, '')) > 120 then
    raise exception 'Número de série muito longo';
  end if;
  if p_transfer_price_cents is null or p_transfer_price_cents <= 0
     or p_recovery_cost_cents is null or p_recovery_cost_cents < 0
     or p_sale_price_cents is null or p_sale_price_cents <= 0 then
    raise exception 'Informe valores de venda e repasse válidos';
  end if;
  if char_length(btrim(coalesce(p_customer_name, ''))) not between 1 and 160 then
    raise exception 'Informe o nome do cliente';
  end if;
  if char_length(coalesce(p_customer_phone,'')) > 30
     or char_length(coalesce(p_vehicle_plate,'')) > 15
     or char_length(coalesce(p_notes,'')) > 1200 then
    raise exception 'Dados opcionais muito longos';
  end if;
  if p_payment_method not in ('pix','cash','card','other') or p_payment_method is null then
    raise exception 'Forma de pagamento inválida';
  end if;
  if p_warranty_days is null or p_warranty_days not between 0 and 365 then
    raise exception 'Garantia deve ser de 0 a 365 dias';
  end if;

  if p_prior_paid_cents > p_transfer_price_cents then
    raise exception 'Pagamento antigo não pode superar o valor devido ao Sandro';
  end if;

  -- Cadastro técnico preservado para vincular venda, garantia e acerto.
  insert into public.used_batteries (
    code,brand,model,amperage_ah,serial_number,
    transfer_price_cents,recovery_cost_cents,asking_price_cents,
    status,notes,created_by
  ) values (
    'WS-' || lpad(nextval('public.used_battery_code_seq')::text,6,'0'),
    btrim(p_brand),btrim(p_model),p_amperage_ah,
    nullif(btrim(coalesce(p_serial_number,'')),''),
    p_transfer_price_cents,p_recovery_cost_cents,p_sale_price_cents,
    'sold',p_notes,auth.uid()
  ) returning id into v_battery_id;

  -- Hora e identidade reais são definidas pelo servidor.
  insert into public.used_battery_sales (
    battery_id,customer_name,customer_phone,vehicle_plate,
    sale_price_cents,payment_method,warranty_days,sold_by,notes,client_request_id,
    sold_at,recorded_by,is_historical
  ) values (
    v_battery_id,btrim(p_customer_name),
    nullif(btrim(coalesce(p_customer_phone,'')),''),
    nullif(btrim(coalesce(p_vehicle_plate,'')),''),
    p_sale_price_cents,p_payment_method,p_warranty_days,auth.uid(),
    p_notes,p_request_id,
    v_sold_at,auth.uid(),true
  ) returning id into v_sale_id;

  -- Acerto só surge quando a venda existe; nunca antes.
  insert into public.used_battery_settlements(
    battery_id,sale_id,owed_cents,paid_cents,waived_cents
  ) values (
    v_battery_id,v_sale_id,p_transfer_price_cents,p_prior_paid_cents,0
  ) returning id into v_settlement_id;

  insert into public.used_settlement_events(
    settlement_id,action,old_owed_cents,new_owed_cents,
    old_paid_cents,new_paid_cents,old_waived_cents,new_waived_cents,
    reason,actor_id
  ) values (
    v_settlement_id,'created',0,p_transfer_price_cents,
    0,0,0,0,'Acerto vinculado a venda histórica cadastrada posteriormente',auth.uid()
  );

  if p_prior_paid_cents > 0 then
    insert into public.used_settlement_events(
      settlement_id,action,old_owed_cents,new_owed_cents,
      old_paid_cents,new_paid_cents,old_waived_cents,new_waived_cents,
      reason,actor_id,effective_at
    ) values (
      v_settlement_id,'historical_payment',
      p_transfer_price_cents,p_transfer_price_cents,
      0,p_prior_paid_cents,0,0,
      'Pagamento histórico informado durante a importação da venda',
      auth.uid(),v_paid_at
    );
  end if;

  insert into public.used_battery_activity(battery_id,action,description,actor_id)
  values (v_battery_id,'sold',
          'Venda histórica informada em '||to_char(v_sold_at at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||
          ' (cadastro realizado posteriormente)',
          auth.uid());

  return v_sale_id;
end;
$function$;
create or replace function public.register_direct_battery_sale(
  p_request_id uuid,
  p_brand text,
  p_model text,
  p_transfer_price_cents bigint,
  p_recovery_cost_cents bigint,
  p_sale_price_cents bigint,
  p_customer_name text,
  p_payment_method text,
  p_warranty_days integer default 30,
  p_amperage_ah integer default null,
  p_serial_number text default null,
  p_customer_phone text default null,
  p_vehicle_plate text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_battery_id uuid;
  v_sale_id uuid;
  v_settlement_id uuid;
  v_existing_seller uuid;
begin
  if auth.uid() is null or public.current_app_role() <> 'ws' then
    raise exception 'Apenas WS ou administrador podem lançar vendas';
  end if;
  if p_request_id is null then
    raise exception 'Identificador de lançamento obrigatório';
  end if;

  -- Evita que dois pedidos simultâneos com o mesmo identificador avancem juntos.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));
  select id, sold_by into v_sale_id, v_existing_seller
    from public.used_battery_sales
    where client_request_id = p_request_id;
  if found then
    if v_existing_seller <> auth.uid() then
      raise exception 'Identificador de venda já utilizado por outra conta';
    end if;
    return v_sale_id;
  end if;

  if char_length(btrim(coalesce(p_brand, ''))) not between 1 and 100
     or char_length(btrim(coalesce(p_model, ''))) not between 1 and 120 then
    raise exception 'Informe marca e modelo da bateria';
  end if;
  if p_amperage_ah is not null and p_amperage_ah not between 1 and 500 then
    raise exception 'Amperagem inválida';
  end if;
  if char_length(coalesce(p_serial_number, '')) > 120 then
    raise exception 'Número de série muito longo';
  end if;
  if p_transfer_price_cents is null or p_transfer_price_cents <= 0
     or p_recovery_cost_cents is null or p_recovery_cost_cents < 0
     or p_sale_price_cents is null or p_sale_price_cents <= 0 then
    raise exception 'Informe valores de venda e repasse válidos';
  end if;
  if char_length(btrim(coalesce(p_customer_name, ''))) not between 1 and 160 then
    raise exception 'Informe o nome do cliente';
  end if;
  if char_length(coalesce(p_customer_phone,'')) > 30
     or char_length(coalesce(p_vehicle_plate,'')) > 15
     or char_length(coalesce(p_notes,'')) > 1200 then
    raise exception 'Dados opcionais muito longos';
  end if;
  if p_payment_method not in ('pix','cash','card','other') or p_payment_method is null then
    raise exception 'Forma de pagamento inválida';
  end if;
  if p_warranty_days is null or p_warranty_days not between 0 and 365 then
    raise exception 'Garantia deve ser de 0 a 365 dias';
  end if;

  -- Registro histórico da bateria (já vendida, nunca criada como estoque).
  insert into public.used_batteries (
    code,brand,model,amperage_ah,serial_number,
    transfer_price_cents,recovery_cost_cents,asking_price_cents,
    status,notes,created_by
  ) values (
    'WS-' || lpad(nextval('public.used_battery_code_seq')::text,6,'0'),
    btrim(p_brand),btrim(p_model),p_amperage_ah,
    nullif(btrim(coalesce(p_serial_number,'')),''),
    p_transfer_price_cents,p_recovery_cost_cents,p_sale_price_cents,
    'sold',p_notes,auth.uid()
  ) returning id into v_battery_id;

  -- Hora e identidade reais são definidas pelo servidor.
  insert into public.used_battery_sales (
    battery_id,customer_name,customer_phone,vehicle_plate,
    sale_price_cents,payment_method,warranty_days,sold_by,notes,client_request_id
  ) values (
    v_battery_id,btrim(p_customer_name),
    nullif(btrim(coalesce(p_customer_phone,'')),''),
    nullif(btrim(coalesce(p_vehicle_plate,'')),''),
    p_sale_price_cents,p_payment_method,p_warranty_days,auth.uid(),
    p_notes,p_request_id
  ) returning id into v_sale_id;

  -- Acerto só surge quando a venda existe; nunca antes.
  insert into public.used_battery_settlements(
    battery_id,sale_id,owed_cents,paid_cents,waived_cents
  ) values (
    v_battery_id,v_sale_id,p_transfer_price_cents,0,0
  ) returning id into v_settlement_id;

  insert into public.used_settlement_events(
    settlement_id,action,old_owed_cents,new_owed_cents,
    old_paid_cents,new_paid_cents,old_waived_cents,new_waived_cents,
    reason,actor_id
  ) values (
    v_settlement_id,'created',0,p_transfer_price_cents,
    0,0,0,0,'Acerto gerado automaticamente com a venda direta',auth.uid()
  );

  insert into public.used_battery_activity(battery_id,action,description,actor_id)
  values (v_battery_id,'sold',
          'Bateria e venda registradas juntas; acerto pendente criado',
          auth.uid());

  return v_sale_id;
end;
$function$;
create or replace function pbws_private.notify_roles(
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
    -- Em movimentos de venda e acerto, o autor também recebe confirmação no celular.
    ;
  get diagnostics v_count=row_count;
  return v_count;
end;
$func$;
create or replace function pbws_private.on_sale_notification()
returns trigger language plpgsql security definer set search_path = ''
as $func$
declare
  v_b public.used_batteries%rowtype;
begin
  select * into v_b from public.used_batteries where id=new.battery_id;
  perform pbws_private.notify_roles(
    array['power','ws','admin'],'sale',
    'Nova venda registrada',
    'Bateria '||coalesce(v_b.brand,'')||' '||coalesce(v_b.model,'')||
    ' vendida. Repasse previsto: R$ '||
    to_char(coalesce(v_b.transfer_price_cents,0)::numeric/100,'FM999999999990D00')||'.',
    'sales',new.sold_by
  );
  return new;
end;
$func$;

-- Sandro não cria rascunhos de uma venda que não poderá finalizar.
drop policy if exists "Draft owner inserts within role" on public.pbws_sale_drafts;
drop policy if exists "Draft owner updates within role" on public.pbws_sale_drafts;
create policy "Draft owner inserts within role"
 on public.pbws_sale_drafts for insert to authenticated
 with check(owner_id=(select auth.uid()) and (select public.is_authorized_user())
  and (select public.current_app_role())='ws');
create policy "Draft owner updates within role"
 on public.pbws_sale_drafts for update to authenticated
 using(owner_id=(select auth.uid()) and (select public.is_authorized_user()))
 with check(owner_id=(select auth.uid()) and (select public.is_authorized_user())
  and (select public.current_app_role())='ws');

revoke all on function public.correct_used_battery_sale(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.correct_used_battery_sale(uuid,jsonb,text) to authenticated;
commit;
