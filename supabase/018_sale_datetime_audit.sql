-- 018: data e hora reais podem ser corrigidas em QUALQUER venda da WS.
-- A data de cadastro, autor original e trilha before_data/after_data permanecem.
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
  if v_role='ws' and v_sale.sold_by<>auth.uid() then
    raise exception 'WS só pode corrigir as próprias vendas';
  end if;
  if v_role='power' and (not v_sale.is_historical or v_sale.recorded_by<>auth.uid()) then
    raise exception 'Sandro só pode corrigir vendas antigas registradas pela própria conta';
  end if;
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
      then 'A venda da bateria '||v_b.code||' teve data/hora alterada. Veja o histórico.'
      else 'Uma venda da bateria '||v_b.code||' foi corrigida. Motivo registrado no histórico.'
    end,
    'sales',auth.uid());
end;
$fn$;
commit;
