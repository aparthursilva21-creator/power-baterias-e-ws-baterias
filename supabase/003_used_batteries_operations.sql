-- Power Baterias × WS Baterias
-- 003: Funções transacionais de cadastro, venda e acerto.
-- Executar DEPOIS de 002_used_batteries_schema.sql, no projeto NOVO.
-- O app não pode editar vendas/acertos diretamente: somente via RPC segura.
begin;

-- Operação: WS / administrador podem cadastrar bateria recebida.
-- Não há dívida ao Sandro até o momento da venda.
create or replace function public.register_used_battery(
  p_brand text,
  p_model text,
  p_transfer_price_cents bigint,
  p_asking_price_cents bigint,
  p_amperage_ah integer default null,
  p_serial_number text default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $func$
declare
  v_id uuid;
begin
  if public.current_app_role() not in ('ws','admin') or public.current_app_role() is null then
    raise exception 'Acesso negado: somente WS ou administrador cadastram baterias';
  end if;
  if p_brand is null or btrim(p_brand) = '' or char_length(p_brand) > 100
     or p_model is null or btrim(p_model) = '' or char_length(p_model) > 120 then
    raise exception 'Marca e modelo são obrigatórios e devem ser curtos';
  end if;
  if p_transfer_price_cents is null or p_transfer_price_cents <= 0
     or p_asking_price_cents is null or p_asking_price_cents < 0 then
    raise exception 'Os preços informados são inválidos';
  end if;
  insert into public.used_batteries (
    code, brand, model, amperage_ah, serial_number,
    transfer_price_cents, asking_price_cents, notes, created_by
  )
  values (
    'WS-' || lpad(nextval('public.used_battery_code_seq')::text, 6, '0'),
    btrim(p_brand), btrim(p_model), p_amperage_ah, nullif(btrim(p_serial_number), ''),
    p_transfer_price_cents, p_asking_price_cents, p_notes, auth.uid()
  )
  returning id into v_id;

  insert into public.used_battery_activity (battery_id, action, description, actor_id)
  values (v_id, 'received', 'Bateria recebida da Power; acerto nasce apenas após venda', auth.uid());
  return v_id;
end;
$func$;

-- WS / administrador: prepara e altera bateria, nunca após venda ou descarte.
create or replace function public.update_used_battery(
  p_battery_id uuid,
  p_status text,
  p_transfer_price_cents bigint,
  p_recovery_cost_cents bigint,
  p_asking_price_cents bigint,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  v_battery public.used_batteries%rowtype;
begin
  if public.current_app_role() not in ('ws','admin') or public.current_app_role() is null then
    raise exception 'Acesso negado';
  end if;
  select * into v_battery from public.used_batteries where id = p_battery_id for update;
  if not found then raise exception 'Bateria não encontrada'; end if;
  if v_battery.status in ('sold','discarded') then
    raise exception 'Essa bateria está encerrada e não pode ser alterada';
  end if;
  if p_status not in ('received','restoring','available','discarded') or p_status is null then
    raise exception 'Situação inválida';
  end if;
  if p_transfer_price_cents is null or p_transfer_price_cents <= 0
     or p_recovery_cost_cents is null or p_recovery_cost_cents < 0
     or p_asking_price_cents is null or p_asking_price_cents < 0 then
    raise exception 'Os valores não podem ser negativos';
  end if;

  update public.used_batteries
  set status = p_status,
      transfer_price_cents = p_transfer_price_cents,
      recovery_cost_cents = p_recovery_cost_cents,
      asking_price_cents = p_asking_price_cents,
      notes = coalesce(p_note, notes),
      updated_at = now()
  where id = p_battery_id;

  insert into public.used_battery_activity (battery_id, action, description, actor_id)
  values (
    p_battery_id, 'edited',
    'Anterior: ' || v_battery.status || ', repasse ' ||
    v_battery.transfer_price_cents || ', recuperação ' || v_battery.recovery_cost_cents ||
    ', venda ' || v_battery.asking_price_cents ||
    ' | Novo: ' || p_status || ', repasse ' || p_transfer_price_cents ||
    ', recuperação ' || p_recovery_cost_cents || ', venda ' || p_asking_price_cents ||
    coalesce(' | ' || nullif(btrim(p_note), ''), ''),
    auth.uid()
  );
end;
$func$;

-- Venda + baixa do estoque + acerto PENDENTE, tudo na mesma transação.
-- FOR UPDATE + UNIQUE(battery_id) impedem vender duas vezes por concorrência.
create or replace function public.register_used_battery_sale(
  p_battery_id uuid,
  p_customer_name text,
  p_sale_price_cents bigint,
  p_payment_method text,
  p_warranty_days integer default 30,
  p_customer_phone text default null,
  p_vehicle_plate text default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $func$
declare
  v_battery public.used_batteries%rowtype;
  v_sale_id uuid;
  v_settlement_id uuid;
begin
  if public.current_app_role() not in ('ws','admin') or public.current_app_role() is null then
    raise exception 'Acesso negado: somente WS ou administrador registram vendas';
  end if;
  if p_customer_name is null or btrim(p_customer_name) = ''
     or char_length(p_customer_name) > 160 then
    raise exception 'Informe o nome do cliente';
  end if;
  if p_sale_price_cents is null or p_sale_price_cents <= 0 then
    raise exception 'Valor de venda inválido';
  end if;
  if p_payment_method not in ('pix','cash','card','other') or p_payment_method is null then
    raise exception 'Forma de pagamento inválida';
  end if;
  if p_warranty_days is null or p_warranty_days not between 0 and 365 then
    raise exception 'Prazo de garantia inválido';
  end if;

  select * into v_battery
  from public.used_batteries
  where id = p_battery_id
  for update;

  if not found then raise exception 'Bateria não encontrada'; end if;
  if v_battery.status <> 'available' then
    raise exception 'A bateria precisa estar disponível antes de ser vendida';
  end if;

  insert into public.used_battery_sales (
    battery_id, customer_name, customer_phone, vehicle_plate,
    sale_price_cents, payment_method, warranty_days, sold_by, notes
  )
  values (
    p_battery_id, btrim(p_customer_name), nullif(btrim(p_customer_phone), ''),
    nullif(btrim(p_vehicle_plate), ''), p_sale_price_cents,
    p_payment_method, p_warranty_days, auth.uid(), p_notes
  ) returning id into v_sale_id;

  update public.used_batteries
    set status = 'sold', updated_at = now()
    where id = p_battery_id;

  -- Somente AQUI surge o acerto devido à Power Baterias.
  insert into public.used_battery_settlements
    (battery_id, sale_id, owed_cents, paid_cents, waived_cents)
  values (p_battery_id, v_sale_id, v_battery.transfer_price_cents, 0, 0)
  returning id into v_settlement_id;

  insert into public.used_settlement_events (
    settlement_id, action, old_owed_cents, new_owed_cents,
    old_paid_cents, new_paid_cents, old_waived_cents, new_waived_cents,
    reason, actor_id
  ) values (
    v_settlement_id, 'created', 0, v_battery.transfer_price_cents,
    0, 0, 0, 0, 'Acerto gerado automaticamente ao vender a bateria', auth.uid()
  );
  insert into public.used_battery_activity (battery_id, action, description, actor_id)
  values (p_battery_id, 'sold', 'Venda registrada e acerto criado', auth.uid());

  return v_sale_id;
end;
$func$;

-- Sandro (power) / Arthur (admin) controlam o acerto após a venda.
-- action:
--   payment       -> registra pagamento, parcial ou completo (+centavos)
--   correct_paid  -> corrige valor pago com delta assinado (+ ou -), exige motivo
--   adjust_owed   -> revisa valor TOTAL do acerto (não abaixo do já pago)
--   waive         -> dispensa saldo que falta, exige motivo
--   reopen        -> reabre acerto anteriormente dispensado, exige motivo
-- NUNCA apaga históricos ou registra acertos de bateria não vendida.
create or replace function public.manage_used_settlement(
  p_settlement_id uuid,
  p_action text,
  p_amount_cents bigint default null,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  v_old public.used_battery_settlements%rowtype;
  v_new_owed bigint;
  v_new_paid bigint;
  v_new_waived bigint;
  v_reason text;
  v_event text;
begin
  if public.current_app_role() not in ('power','admin') or public.current_app_role() is null then
    raise exception 'Acesso negado: somente Sandro ou administrador alteram acertos';
  end if;

  select * into v_old from public.used_battery_settlements
  where id = p_settlement_id for update;
  if not found then raise exception 'Acerto não encontrado'; end if;

  v_new_owed := v_old.owed_cents;
  v_new_paid := v_old.paid_cents;
  v_new_waived := v_old.waived_cents;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  case p_action
    when 'payment' then
      if p_amount_cents is null or p_amount_cents <= 0 then
        raise exception 'Informe um pagamento positivo';
      end if;
      if v_old.waived_cents > 0 then
        raise exception 'Acerto dispensado. Reabra antes de registrar pagamento';
      end if;
      if p_amount_cents > v_old.owed_cents - v_old.paid_cents then
        raise exception 'Pagamento maior que o saldo pendente';
      end if;
      v_new_paid := v_old.paid_cents + p_amount_cents;
      v_reason := coalesce(v_reason, 'Pagamento registrado por gestor Power');
      v_event := 'payment';

    when 'correct_paid' then
      if p_amount_cents is null or p_amount_cents = 0 then
        raise exception 'Informe o ajuste do pagamento (+/- centavos)';
      end if;
      if v_reason is null then
        raise exception 'Informe o motivo da correção de pagamento';
      end if;
      v_new_paid := v_old.paid_cents + p_amount_cents;
      if v_new_paid < 0 or v_new_paid + v_old.waived_cents > v_old.owed_cents then
        raise exception 'Correção ultrapassa os limites do acerto';
      end if;
      v_event := 'payment_correction';

    when 'adjust_owed' then
      if p_amount_cents is null or p_amount_cents <= 0 then
        raise exception 'Informe um valor positivo; para dispensar use a ação waive';
      end if;
      if v_reason is null then raise exception 'Informe o motivo do ajuste'; end if;
      if p_amount_cents < v_old.paid_cents + v_old.waived_cents then
        raise exception 'Valor novo não pode ser menor que o já pago ou dispensado';
      end if;
      if p_amount_cents = v_old.owed_cents then
        raise exception 'O valor já está igual ao informado';
      end if;
      v_new_owed := p_amount_cents;
      v_event := 'amount_adjustment';

    when 'waive' then
      if v_reason is null then raise exception 'Informe por que o acerto foi dispensado'; end if;
      if v_old.owed_cents <= v_old.paid_cents + v_old.waived_cents then
        raise exception 'Não há saldo para dispensar';
      end if;
      v_new_waived := v_old.owed_cents - v_old.paid_cents;
      v_event := 'waiver';

    when 'reopen' then
      if v_reason is null then raise exception 'Informe o motivo da reabertura'; end if;
      if v_old.waived_cents = 0 then
        raise exception 'Este acerto não está dispensado';
      end if;
      v_new_waived := 0;
      v_event := 'reopen';

    else
      raise exception 'Tipo de operação inválido';
  end case;

  update public.used_battery_settlements
  set owed_cents = v_new_owed, paid_cents = v_new_paid,
      waived_cents = v_new_waived, updated_at = now()
  where id = p_settlement_id;

  insert into public.used_settlement_events (
    settlement_id, action, old_owed_cents, new_owed_cents,
    old_paid_cents, new_paid_cents, old_waived_cents, new_waived_cents,
    reason, actor_id
  ) values (
    p_settlement_id, v_event, v_old.owed_cents, v_new_owed,
    v_old.paid_cents, v_new_paid, v_old.waived_cents, v_new_waived,
    v_reason, auth.uid()
  );
end;
$func$;

-- Fechar as permissões: chamadas REST RPC só para sessões autenticadas.
revoke all on function public.register_used_battery(text,text,bigint,bigint,integer,text,text) from public, anon;
revoke all on function public.update_used_battery(uuid,text,bigint,bigint,bigint,text) from public, anon;
revoke all on function public.register_used_battery_sale(uuid,text,bigint,text,integer,text,text,text) from public, anon;
revoke all on function public.manage_used_settlement(uuid,text,bigint,text) from public, anon;

grant execute on function public.register_used_battery(text,text,bigint,bigint,integer,text,text) to authenticated;
grant execute on function public.update_used_battery(uuid,text,bigint,bigint,bigint,text) to authenticated;
grant execute on function public.register_used_battery_sale(uuid,text,bigint,text,integer,text,text,text) to authenticated;
grant execute on function public.manage_used_settlement(uuid,text,bigint,text) to authenticated;

commit;
