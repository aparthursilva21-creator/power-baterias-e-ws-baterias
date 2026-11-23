-- 006 — Venda direta, sem estoque na operação.
-- WS lança bateria + cliente + valor vendido no mesmo formulário.
-- Uma transação gera venda, cadastro histórico da bateria e dívida pendente à Power.
-- Execute APENAS no Supabase pbEws, depois da migração 005.
begin;

-- Chave idempotente: evita duas vendas se o celular repetir a mesma solicitação.
alter table public.used_battery_sales
  add column if not exists client_request_id uuid;

create unique index if not exists used_battery_sale_request_unique
  on public.used_battery_sales(client_request_id)
  where client_request_id is not null;

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
  if auth.uid() is null or public.current_app_role() not in ('ws','admin') then
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

-- Remover a possibilidade de usar o fluxo antigo por API.
-- Tabelas históricas são preservadas para não perder vendas/acertos.
revoke execute on function public.register_used_battery(text,text,bigint,bigint,integer,text,text,bigint)
  from public,anon,authenticated;
revoke execute on function public.update_used_battery(uuid,text,bigint,bigint,bigint,text)
  from public,anon,authenticated;
revoke execute on function public.register_used_battery_sale(uuid,text,bigint,text,integer,text,text,text)
  from public,anon,authenticated;

revoke all on function public.register_direct_battery_sale(
  uuid,text,text,bigint,bigint,bigint,text,text,integer,integer,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.register_direct_battery_sale(
  uuid,text,text,bigint,bigint,bigint,text,text,integer,integer,text,text,text,text
) to authenticated;

commit;
