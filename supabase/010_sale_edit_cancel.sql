-- 010 — Correcoes e cancelamentos seguros de vendas. Nao apaga dados existentes.
-- Aplicar somente no projeto pbEws; tabelas antigas sao mantidas para auditoria.
begin;
alter table public.used_battery_sales
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id),
  add column if not exists cancellation_reason text;
create index if not exists used_sales_active_idx
  on public.used_battery_sales(sold_at desc) where cancelled_at is null;

create table if not exists public.used_sale_revisions (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.used_battery_sales(id),
  action text not null check (action in ('corrected','cancelled')),
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  before_data jsonb not null,
  after_data jsonb not null,
  actor_id uuid not null references auth.users(id),
  occurred_at timestamptz not null default now()
);
create index if not exists used_sale_revisions_time_idx
  on public.used_sale_revisions(occurred_at desc);
alter table public.used_sale_revisions enable row level security;
revoke all on public.used_sale_revisions from public,anon,authenticated;
grant select on public.used_sale_revisions to authenticated;
create policy "read authorized sale revisions" on public.used_sale_revisions
  for select to authenticated using ((select public.is_authorized_user()));

-- Corrige informações da bateria, comprador, garantia e valor de venda,
-- preservando data original, usuario vendedor e valores de acerto.
-- Alterar quanto Sandro deve receber continua exclusivo da aba Acertos.
create function public.correct_used_battery_sale(
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
begin
  v_role:=public.current_app_role();
  if auth.uid() is null or v_role not in ('admin','ws') then
    raise exception 'Somente WS e administrador podem corrigir vendas';
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
   'payment_method','warranty_days','recovery_cost_cents','notes')
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
    'Venda corrigida',
    'Uma venda da bateria '||v_b.code||
    ' foi corrigida. Motivo registrado no histórico.',
    'sales',auth.uid());
end;
$fn$;

-- Cancelamento administrativo: preserva registro e trilha de auditoria.
-- Nunca permite cancelamento de venda com repasse marcado como pago ou dispensado.
create function public.cancel_used_battery_sale(
  p_sale_id uuid,p_reason text
) returns void
language plpgsql security definer set search_path=''
as $fn$
declare
  v_sale public.used_battery_sales%rowtype;
  v_st public.used_battery_settlements%rowtype;
  v_before jsonb;
  v_after jsonb;
begin
  if auth.uid() is null or public.current_app_role()<>'admin' then
    raise exception 'Somente administrador pode cancelar vendas';
  end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 5 and 500 then
    raise exception 'Informe o motivo do cancelamento';
  end if;
  select * into v_sale from public.used_battery_sales
  where id=p_sale_id for update;
  if not found or v_sale.cancelled_at is not null then
    raise exception 'Venda não encontrada ou já cancelada';
  end if;
  select * into v_st from public.used_battery_settlements
    where sale_id=v_sale.id for update;
  if not found then raise exception 'Acerto vinculado não encontrado'; end if;
  if v_st.paid_cents>0 or v_st.waived_cents>0 or exists (
    select 1 from public.used_settlement_batch_items
    where settlement_id=v_st.id
  ) then
    raise exception 'Há pagamento/dispensa registrado. Corrija o acerto e reconcilie os valores antes de cancelar; acertos em lote exigem revisão administrativa';
  end if;
  v_before:=to_jsonb(v_sale);
  update public.used_battery_sales set
    cancelled_at=now(),cancelled_by=auth.uid(),
    cancellation_reason=btrim(p_reason)
  where id=v_sale.id;
  select to_jsonb(s) into v_after from public.used_battery_sales s
    where s.id=v_sale.id;
  insert into public.used_sale_revisions
    (sale_id,action,reason,before_data,after_data,actor_id)
  values(v_sale.id,'cancelled',btrim(p_reason),v_before,v_after,auth.uid());
  perform pbws_private.notify_roles(
    array['power','ws','admin'],'sale',
    'Venda cancelada',
    'O lançamento de uma bateria foi cancelado pelo administrador. Consulte o histórico.',
    'sales',auth.uid());
end;
$fn$;

-- Proteção final: acertos cancelados não podem ser alterados nem quitados.
create function pbws_private.prevent_settlement_on_cancelled_sale()
returns trigger language plpgsql security definer set search_path=''
as $fn$
begin
  if exists(select 1 from public.used_battery_sales s
   where s.id=new.sale_id and s.cancelled_at is not null) then
    raise exception 'Não é possível alterar um acerto de venda cancelada';
  end if;
  return new;
end;
$fn$;
create trigger prevent_cancelled_sale_settlement_change
 before update on public.used_battery_settlements
 for each row execute function pbws_private.prevent_settlement_on_cancelled_sale();

-- Recalcular relatório mensal sem vendas canceladas e sem pagamentos dessas vendas.
create or replace function public.get_power_ws_monthly_report(
  p_month date
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $func$
declare
  v_role text;
  v_start timestamptz;
  v_end timestamptz;
  v_from_date date;
  v_to_date date;
  v_count bigint;
  v_revenue bigint;
  v_repasse bigint;
  v_recovery bigint;
  v_expenses bigint;
  v_paid_month bigint;
  v_pending bigint;
  v_settled bigint;
begin
  v_role := public.current_app_role();
  if v_role is null then raise exception 'Acesso não autorizado'; end if;
  if p_month is null then raise exception 'Informe o mês'; end if;
  v_from_date := date_trunc('month', p_month::timestamp)::date;
  v_to_date := (v_from_date + interval '1 month')::date;
  v_start := v_from_date::timestamp at time zone 'America/Sao_Paulo';
  v_end := v_to_date::timestamp at time zone 'America/Sao_Paulo';

  select count(*),
    coalesce(sum(s.sale_price_cents),0),
    coalesce(sum(st.owed_cents - st.waived_cents),0),
    coalesce(sum(b.recovery_cost_cents),0),
    count(*) filter (where st.paid_cents + st.waived_cents = st.owed_cents)
  into v_count,v_revenue,v_repasse,v_recovery,v_settled
  from public.used_battery_sales s
    join public.used_batteries b on b.id=s.battery_id
    join public.used_battery_settlements st on st.sale_id=s.id
  where s.cancelled_at is null and s.sold_at >= v_start and s.sold_at < v_end;

  select coalesce(sum(e.new_paid_cents - e.old_paid_cents),0)
  into v_paid_month from public.used_settlement_events e
  join public.used_battery_settlements st on st.id=e.settlement_id
  join public.used_battery_sales s on s.id=st.sale_id
  where s.cancelled_at is null and e.occurred_at >= v_start and e.occurred_at < v_end;

  select coalesce(sum(owed_cents-paid_cents-waived_cents),0)
  into v_pending from public.used_battery_settlements st
  join public.used_battery_sales s on s.id=st.sale_id
  where s.cancelled_at is null;

  if v_role in ('ws','admin') then
    select coalesce(sum(amount_cents),0) into v_expenses
    from public.ws_expenses
    where spent_on >= v_from_date and spent_on < v_to_date;
  else
    v_expenses := null;
  end if;

  return jsonb_build_object(
    'month',to_char(v_from_date,'YYYY-MM'),
    'role',v_role,
    'sales_count',v_count,
    'sales_revenue_cents',v_revenue,
    'power_repasse_sales_month_cents',v_repasse,
    'recovery_cost_sales_month_cents',v_recovery,
    'ws_expenses_cents',v_expenses,
    'ws_estimated_profit_cents',
      case when v_expenses is null then null
      else v_revenue-v_repasse-v_recovery-v_expenses end,
    'power_received_in_month_cents',v_paid_month,
    'power_pending_total_now_cents',v_pending,
    'fully_settled_sales_in_month',v_settled
  );
end;
$func$;

revoke all on function public.correct_used_battery_sale(uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.cancel_used_battery_sale(uuid,text) from public,anon,authenticated;
grant execute on function public.correct_used_battery_sale(uuid,jsonb,text) to authenticated;
grant execute on function public.cancel_used_battery_sale(uuid,text) to authenticated;
commit;
