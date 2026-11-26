-- 021 — Cancelamentos após acerto com pendência de conciliação e auditoria.
-- A venda só é cancelada após confirmação explícita; nenhum pagamento é apagado ou estornado.
begin;

create table public.used_sale_financial_reviews (
 id uuid primary key default gen_random_uuid(),
 sale_id uuid not null unique references public.used_battery_sales(id),
 settlement_id uuid not null references public.used_battery_settlements(id),
 paid_at_cancellation_cents bigint not null check (paid_at_cancellation_cents>=0),
 waived_at_cancellation_cents bigint not null check (waived_at_cancellation_cents>=0),
 owed_at_cancellation_cents bigint not null check (owed_at_cancellation_cents>0),
 batch_related boolean not null default false,
 status text not null default 'pending' check(status in ('pending','resolved')),
 cancel_reason text not null,
 created_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id),
 resolved_at timestamptz,
 resolved_by uuid references auth.users(id),
 resolution_method text check(resolution_method in ('refunded','compensated','record_error','other')),
 resolution_note text,
 constraint review_resolution_consistency check(
  (status='pending' and resolved_at is null and resolved_by is null and resolution_method is null and resolution_note is null)
  or (status='resolved' and resolved_at is not null and resolved_by is not null and
      resolution_method is not null and char_length(btrim(resolution_note)) between 8 and 500)
 )
);
create index used_sale_financial_reviews_pending_idx
 on public.used_sale_financial_reviews(created_at desc) where status='pending';

create table public.used_sale_financial_review_events(
 id uuid primary key default gen_random_uuid(),
 review_id uuid not null references public.used_sale_financial_reviews(id),
 event text not null check(event in ('opened','resolved')),
 before_data jsonb,
 after_data jsonb not null,
 reason text not null,
 actor_id uuid not null references auth.users(id),
 occurred_at timestamptz not null default now()
);
create index used_sale_financial_review_events_time_idx
 on public.used_sale_financial_review_events(occurred_at desc);

alter table public.used_sale_financial_reviews enable row level security;
alter table public.used_sale_financial_review_events enable row level security;
revoke all on public.used_sale_financial_reviews,public.used_sale_financial_review_events
 from public,anon,authenticated;
grant select on public.used_sale_financial_reviews,public.used_sale_financial_review_events to authenticated;
create policy "Authorized review read" on public.used_sale_financial_reviews
 for select to authenticated using ((select public.is_authorized_user()));
create policy "Authorized review events read" on public.used_sale_financial_review_events
 for select to authenticated using ((select public.is_authorized_user()));

-- Permite somente Sandro/admin cancelar uma venda com pagamento, dispensa ou lote,
-- após reconhecer que a movimentação financeira anterior precisa ser reconciliada.
create function public.cancel_used_battery_sale_with_review(
 p_sale_id uuid,p_reason text,p_acknowledge_financial_history boolean
) returns void
language plpgsql security definer set search_path=''
as $cancel$
declare
 v_sale public.used_battery_sales%rowtype;
 v_settlement public.used_battery_settlements%rowtype;
 v_b public.used_batteries%rowtype;
 v_role text;
 v_batch boolean;
 v_review public.used_sale_financial_reviews%rowtype;
 v_before jsonb;
 v_after jsonb;
begin
 v_role:=public.current_app_role();
 if auth.uid() is null or v_role not in ('power','admin') then
   raise exception 'Apenas Sandro ou administrador podem cancelar vendas com acerto financeiro anterior';
 end if;
 if p_acknowledge_financial_history is distinct from true then
   raise exception 'Confirme que o acerto anterior deverá ser reconciliado';
 end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 5 and 500 then
   raise exception 'Explique o motivo do cancelamento (mínimo 5 caracteres)';
 end if;
 select * into v_sale from public.used_battery_sales
 where id=p_sale_id for update;
 if not found or v_sale.cancelled_at is not null then
   raise exception 'Venda não encontrada ou já cancelada';
 end if;
 select * into v_settlement from public.used_battery_settlements
 where sale_id=v_sale.id for update;
 if not found then raise exception 'Acerto não encontrado';end if;
 select * into v_b from public.used_batteries where id=v_sale.battery_id for update;
 if not found then raise exception 'Bateria não encontrada';end if;
 select exists(select 1 from public.used_settlement_batch_items where settlement_id=v_settlement.id)
   into v_batch;
 if v_settlement.paid_cents=0 and v_settlement.waived_cents=0 and not v_batch then
   raise exception 'Essa venda não tem acerto pago; use o cancelamento comum';
 end if;
 v_before:=jsonb_build_object('sale',to_jsonb(v_sale),'battery',to_jsonb(v_b),
   'settlement',to_jsonb(v_settlement));
 update public.used_battery_sales set cancelled_at=now(),cancelled_by=auth.uid(),
 cancellation_reason=btrim(p_reason) where id=v_sale.id;
 insert into public.used_sale_financial_reviews(
   sale_id,settlement_id,paid_at_cancellation_cents,
   waived_at_cancellation_cents,owed_at_cancellation_cents,
   batch_related,cancel_reason,created_by
 )values(
   v_sale.id,v_settlement.id,v_settlement.paid_cents,
   v_settlement.waived_cents,v_settlement.owed_cents,
   v_batch,btrim(p_reason),auth.uid()
 ) returning * into v_review;
 v_after:=jsonb_build_object(
  'sale',(select to_jsonb(x) from public.used_battery_sales x where x.id=v_sale.id),
  'battery',to_jsonb(v_b),'settlement',to_jsonb(v_settlement),
  'financial_review',to_jsonb(v_review));
 insert into public.used_sale_revisions(sale_id,action,reason,before_data,after_data,actor_id)
 values(v_sale.id,'cancelled',btrim(p_reason),v_before,v_after,auth.uid());
 insert into public.used_sale_financial_review_events(review_id,event,before_data,after_data,reason,actor_id)
 values(v_review.id,'opened',null,to_jsonb(v_review),
  'Cancelamento: conferir pagamento ou dispensa previamente registrado',auth.uid());
 perform pbws_private.notify_roles(array['power','ws','admin'],'sale',
  'Venda cancelada — conferir acerto',
  'Sandro cancelou a venda de '||v_b.brand||' '||v_b.model||
  '. O acerto anterior foi preservado. Conciliação financeira pendente.',
  'settlements',auth.uid());
end;
$cancel$;
revoke all on function public.cancel_used_battery_sale_with_review(uuid,text,boolean)
 from public,anon,authenticated;
grant execute on function public.cancel_used_battery_sale_with_review(uuid,text,boolean)
 to authenticated;

create function public.resolve_used_sale_financial_review(
 p_review_id uuid,p_resolution_method text,p_reason text
) returns void
language plpgsql security definer set search_path=''
as $resolve$
declare v_review public.used_sale_financial_reviews%rowtype;
 v_sale public.used_battery_sales%rowtype;
 v_b public.used_batteries%rowtype;
 v_after public.used_sale_financial_reviews%rowtype;
begin
 if auth.uid() is null or public.current_app_role() not in ('power','admin') then
  raise exception 'Somente Sandro ou administrador podem finalizar a conferência financeira';
 end if;
 if p_resolution_method not in ('refunded','compensated','record_error','other')
    or p_resolution_method is null then raise exception 'Selecione como o acerto foi resolvido';end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 8 and 500 then
    raise exception 'Explique como a situação financeira foi resolvida';end if;
 select * into v_review from public.used_sale_financial_reviews where id=p_review_id for update;
 if not found or v_review.status<>'pending' then
   raise exception 'Essa conferência não existe ou já está concluída';
 end if;
 select * into v_sale from public.used_battery_sales where id=v_review.sale_id;
 select * into v_b from public.used_batteries where id=v_sale.battery_id;
 update public.used_sale_financial_reviews
 set status='resolved',resolved_at=now(),resolved_by=auth.uid(),
 resolution_method=p_resolution_method,resolution_note=btrim(p_reason)
 where id=v_review.id returning * into v_after;
 insert into public.used_sale_financial_review_events
   (review_id,event,before_data,after_data,reason,actor_id)
 values(v_review.id,'resolved',to_jsonb(v_review),to_jsonb(v_after),btrim(p_reason),auth.uid());
 perform pbws_private.notify_roles(array['power','ws','admin'],'settlement',
  'Conciliação de venda cancelada concluída',
  'O acerto cancelado de '||v_b.brand||' '||v_b.model||
  ' foi conferido por Sandro. Confira a justificativa no histórico.',
  'settlements',auth.uid());
end;
$resolve$;
revoke all on function public.resolve_used_sale_financial_review(uuid,text,text)
 from public,anon,authenticated;
grant execute on function public.resolve_used_sale_financial_review(uuid,text,text)
 to authenticated;

-- Relatórios contabilizam pagamentos antigos como históricos, sem fingir
-- que o dinheiro foi devolvido no cancelamento. Destacam pendências separadamente.
create or replace function public.get_power_ws_period_report(
  p_start date,p_end date
) returns jsonb
language plpgsql stable security definer set search_path=''
as $report$
declare
  v_role text;
  v_start timestamptz;
  v_end timestamptz;
  v_count bigint;
  v_revenue bigint;
  v_repasse bigint;
  v_recovery bigint;
  v_expenses bigint;
  v_power_expenses bigint;
  v_paid bigint;
  v_pending bigint;
  v_settled bigint;
  v_review_paid bigint;
  v_review_count bigint;
  v_cancelled_received bigint;
begin
  v_role:=public.current_app_role();
  if auth.uid() is null or v_role not in ('admin','ws','power') then
    raise exception 'Não autorizado a consultar relatórios';
  end if;
  if p_start is null or p_end is null or p_start<'2000-01-01'::date
     or p_end<=p_start or p_end>p_start+366 then
    raise exception 'Selecione um período válido de até 366 dias';
  end if;
  v_start:=p_start::timestamp at time zone 'America/Sao_Paulo';
  v_end:=p_end::timestamp at time zone 'America/Sao_Paulo';

  select count(*),
    coalesce(sum(s.sale_price_cents),0),
    coalesce(sum(st.owed_cents-st.waived_cents),0),
    coalesce(sum(b.recovery_cost_cents),0),
    count(*) filter(where st.paid_cents+st.waived_cents=st.owed_cents)
  into v_count,v_revenue,v_repasse,v_recovery,v_settled
  from public.used_battery_sales s
    join public.used_batteries b on b.id=s.battery_id
    join public.used_battery_settlements st on st.sale_id=s.id
  where s.cancelled_at is null and s.sold_at>=v_start and s.sold_at<v_end;

  -- Recebimentos históricos continuam registrados mesmo se a venda for cancelada.
  -- Se houver conciliação, o valor aparece também como pendência, não desaparece.
  select coalesce(sum(e.new_paid_cents-e.old_paid_cents),0)
  into v_paid
  from public.used_settlement_events e
  join public.used_battery_settlements st on st.id=e.settlement_id
  where e.effective_at>=v_start and e.effective_at<v_end;

  select coalesce(sum(e.new_paid_cents-e.old_paid_cents),0)
  into v_cancelled_received
  from public.used_settlement_events e
  join public.used_battery_settlements st on st.id=e.settlement_id
  join public.used_battery_sales s on s.id=st.sale_id
  where s.cancelled_at is not null
    and e.effective_at>=v_start and e.effective_at<v_end;

  select count(*),coalesce(sum(paid_at_cancellation_cents),0)
  into v_review_count,v_review_paid
  from public.used_sale_financial_reviews where status='pending';

  select coalesce(sum(st.owed_cents-st.paid_cents-st.waived_cents),0)
  into v_pending
  from public.used_battery_settlements st
    join public.used_battery_sales s on s.id=st.sale_id
  where s.cancelled_at is null;

  if v_role in ('ws','admin') then
    select coalesce(sum(amount_cents),0) into v_expenses
    from public.ws_expenses
    where spent_on>=p_start and spent_on<p_end;
  else
    v_expenses:=null;
  end if;
  if v_role in ('power','admin') then
    select coalesce(sum(amount_cents),0) into v_power_expenses
    from public.power_expenses
    where spent_on>=p_start and spent_on<p_end;
  else
    v_power_expenses:=null;
  end if;

  return jsonb_build_object(
    'period_start',p_start,'period_end_exclusive',p_end,'role',v_role,
    'sales_count',v_count,'sales_revenue_cents',v_revenue,
    'power_repasse_sales_month_cents',v_repasse,
    'recovery_cost_sales_month_cents',v_recovery,
    'ws_expenses_cents',v_expenses,'power_expenses_cents',v_power_expenses,
    'ws_estimated_profit_cents',case when v_expenses is null then null
      else v_revenue-v_repasse-v_recovery-v_expenses end,
    'power_received_in_month_cents',v_paid,
    'power_cancelled_receipts_in_period_cents',v_cancelled_received,
    'financial_reviews_pending_count',v_review_count,
    'financial_reviews_pending_paid_cents',v_review_paid,
    'power_pending_total_now_cents',v_pending,
    'fully_settled_sales_in_month',v_settled
  );
end;
$report$;


revoke all on function public.get_power_ws_period_report(date,date)
 from public,anon,authenticated;
grant execute on function public.get_power_ws_period_report(date,date) to authenticated;
commit;
