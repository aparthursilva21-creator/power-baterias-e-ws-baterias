-- 011 — Registro mínimo de limpeza de dados de testes, sem informações do cliente.
begin;
create table if not exists public.pbws_test_reset_log(
 id uuid primary key default gen_random_uuid(),
 executed_at timestamptz not null default now(),
 operation text not null check (operation in ('clear_fixture')),
 original_sale_count integer not null check (original_sale_count>=0),
 original_settlement_count integer not null check (original_settlement_count>=0),
 original_paid_cents bigint not null check (original_paid_cents>=0),
 note text not null
);
alter table public.pbws_test_reset_log enable row level security;
revoke all on public.pbws_test_reset_log from public,anon,authenticated;
grant select on public.pbws_test_reset_log to authenticated;
create policy "admin_only_reset_log" on public.pbws_test_reset_log
 for select to authenticated using ((select public.current_app_role())='admin');
commit;
