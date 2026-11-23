-- Banco de testes local: rascunhos de vendas nunca criam venda/acerto.
set role authenticated;
do $draft_tests$
declare
 v_ws uuid:='00000000-0000-4000-8000-000000000003';
 v_power uuid:='00000000-0000-4000-8000-000000000002';
 v_admin uuid:='00000000-0000-4000-8000-000000000001';
 v_id uuid:='daaaa000-0000-4000-8000-000000000001';
 v_before int;v_after int;v_count int;v_blocked boolean;
begin
 perform set_config('request.jwt.claim.sub',v_ws::text,true);
 select count(*) into v_before from public.used_battery_sales;
 insert into public.pbws_sale_drafts(owner_id,kind,form_data,request_id,expires_at)
 values(v_ws,'sale','{"customer":"Cliente WS","price":"150.00"}'::jsonb,v_id,now()+interval '365 days');
 select count(*) into v_count from public.pbws_sale_drafts where owner_id=v_ws
   and kind='sale' and form_data->>'customer'='Cliente WS'
   and expires_at between now()+interval '29 minutes' and now()+interval '31 minutes';
 if v_count<>1 then raise exception 'Trigger nao impôs 30 minutos de vida ao rascunho'; end if;
 update public.pbws_sale_drafts set form_data='{"customer":"Cliente editado","price":"175.00"}'
 where owner_id=v_ws and kind='sale';
 select count(*) into v_count from public.pbws_sale_drafts where owner_id=v_ws
    and form_data->>'customer'='Cliente editado';
 if v_count<>1 then raise exception 'WS nao atualizou proprio rascunho';end if;

 perform set_config('request.jwt.claim.sub',v_power::text,true);
 select count(*) into v_count from public.pbws_sale_drafts where owner_id=v_ws;
 if v_count<>0 then raise exception 'Power leu rascunho privado da WS';end if;
 v_blocked:=false;
 begin
   insert into public.pbws_sale_drafts(owner_id,kind,form_data,request_id)
   values(v_ws,'historical_sale','{"price":"100"}',gen_random_uuid());
 exception when others then v_blocked:=true;end;
 if not v_blocked then raise exception 'Power criou rascunho em nome da WS';end if;
 v_blocked:=false;
 begin
   insert into public.pbws_sale_drafts(owner_id,kind,form_data,request_id)
   values(v_power,'sale','{"price":"100"}',gen_random_uuid());
 exception when others then v_blocked:=true;end;
 if not v_blocked then raise exception 'Power criou rascunho de venda nova';end if;
 insert into public.pbws_sale_drafts(owner_id,kind,form_data,request_id)
 values(v_power,'historical_sale','{"sold_when":"2026-10-01T12:00"}',gen_random_uuid());
 select count(*) into v_count from public.pbws_sale_drafts where owner_id=v_power;
 if v_count<>1 then raise exception 'Power nao pode rascunhar venda antiga';end if;

 perform set_config('request.jwt.claim.sub',v_admin::text,true);
 select count(*) into v_count from public.pbws_sale_drafts;
 if v_count<>0 then raise exception 'Administrador viu rascunhos pessoais alheios';end if;
 insert into public.pbws_sale_drafts(owner_id,kind,form_data,request_id)
 values(v_admin,'sale','{"customer":"Cliente admin"}',gen_random_uuid());

 perform set_config('request.jwt.claim.sub',v_ws::text,true);
 delete from public.pbws_sale_drafts where owner_id=v_power;
 select count(*) into v_count from public.pbws_sale_drafts where owner_id=v_ws;
 if v_count<>1 then raise exception 'WS perdeu propria anotacao ao excluir de outra conta';end if;
 delete from public.pbws_sale_drafts where owner_id=v_ws;
 select count(*) into v_count from public.pbws_sale_drafts where owner_id=v_ws;
 if v_count<>0 then raise exception 'WS nao consegue descartar o proprio rascunho';end if;

 select count(*) into v_after from public.used_battery_sales;
 if v_before<>v_after then raise exception 'Rascunho mexeu nas vendas confirmadas';end if;
 raise notice 'PASSOU: rascunho privado, tempo de 30 min, permissoes, exclusao e zero impacto financeiro';
end;
$draft_tests$;
