-- 005 — Auditoria de usuário, permissões e atualização entre celulares.
-- Executar no Supabase da parceria DEPOIS de 002, 003 e 004.
-- Nunca executar no banco antigo Power Baterias.
begin;

-- Rótulo identificável dos operadores cadastrados.
-- Somente contas autorizadas veem esta lista restrita; não expõe tokens.
create or replace function public.get_power_ws_team()
returns table (id uuid, email text, role text)
language sql stable security definer
set search_path = ''
as $func$
  select u.id, u.email::text, a.role
  from public.authorized_users a
  join auth.users u on lower(btrim(u.email)) = lower(btrim(a.email))
  where a.active = true and public.current_app_role() is not null
  order by a.role;
$func$;
revoke all on function public.get_power_ws_team() from public, anon;
grant execute on function public.get_power_ws_team() to authenticated;

-- A identidade (auth.uid) é registrada no banco em todos os writes.
-- Tabelas de auditoria não têm políticas para insert/update/delete pelo cliente.
-- Endurecer a sequência: só as funções SECURITY DEFINER gravam códigos.
revoke all on sequence public.used_battery_code_seq from public, anon, authenticated;

-- Publicar alterações para os navegadores de Sandro, Wanderson e Arthur.
-- Se a publicação não existir neste ambiente, mantém polling no app como fallback.
do $realtime$
declare
  v_name text;
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach v_name in array array[
      'used_batteries','used_battery_sales','used_battery_settlements',
      'used_settlement_batches','used_settlement_batch_items',
      'used_settlement_events','used_battery_activity',
      'ws_expenses','ws_expense_events'
    ] loop
      if not exists(
        select 1 from pg_publication_tables
        where pubname='supabase_realtime' and schemaname='public' and tablename=v_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I',v_name);
      end if;
    end loop;
  end if;
end;
$realtime$;

commit;
