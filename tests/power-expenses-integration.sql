-- Testes de despesas da Power sem confundir com despesas WS.
set role authenticated;
do $power$
declare
 v_power uuid:='00000000-0000-4000-8000-000000000002';
 v_ws uuid:='00000000-0000-4000-8000-000000000003';
 v_admin uuid:='00000000-0000-4000-8000-000000000001';
 d date; t timestamp; expense uuid; summary jsonb; n int; blocked boolean;
begin
 d:=((now() at time zone 'America/Sao_Paulo') - interval '82 days')::date;
 t:=d::timestamp+interval '9 hours 40 minutes';
 perform set_config('request.jwt.claim.sub',v_power::text,true);
 expense:=public.register_power_expense(
   'gasoline',4200,d,'Gasolina antiga Power',t,true
 );
 select count(*) into n from public.power_expenses where id=expense
  and spent_on=d and spent_at at time zone 'America/Sao_Paulo'=t
  and is_historical and created_by=v_power
  and created_at>now()-interval '3 minutes';
 if n<>1 then raise exception 'Despesa antiga Power foi cadastrada incorretamente';end if;
 summary:=public.get_power_ws_monthly_report(d);
 if (summary->>'power_expenses_cents')::bigint<>4200
   or summary->'ws_expenses_cents'<>'null'::jsonb then
   raise exception 'Sandro recebeu relatorio com contas misturadas';end if;

 perform public.correct_power_expense(
  expense,4700,d,'Gasolina corrigida Power','Nota de gasolina com valor diferente',
  t+interval '20 minutes'
 );
 select count(*) into n from public.power_expense_events where expense_id=expense
   and action='corrected' and actor_id=v_power
   and before_data is not null and after_data is not null;
 if n<>1 then raise exception 'Correção Power sem trilha de auditoria'; end if;

 perform set_config('request.jwt.claim.sub',v_ws::text,true);
 select count(*) into n from public.power_expenses;
 if n<>0 then raise exception 'WS acessou despesas privadas da Power';end if;
 blocked:=false;
 begin
  perform public.register_power_expense('gasoline',500,d,'Sem acesso Power');
 exception when others then blocked:=true;end;
 if not blocked then raise exception 'WS conseguiu alterar caixa Power';end if;
 summary:=public.get_power_ws_monthly_report(d);
 if summary->'power_expenses_cents'<>'null'::jsonb then
  raise exception 'WS teve dados financeiros da Power';end if;

 perform set_config('request.jwt.claim.sub',v_admin::text,true);
 select count(*) into n from public.power_expenses;
 if n<>1 then raise exception 'Administrador não vê Power';end if;
 summary:=public.get_power_ws_monthly_report(d);
 if (summary->>'power_expenses_cents')::bigint<>4700 then
  raise exception 'Administrador não viu despesa Power atualizada';end if;

 raise notice 'PASSOU: despesas Power, correção auditada, relatórios separados e permissão WS negada';
end;
$power$;
