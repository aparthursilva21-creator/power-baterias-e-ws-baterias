-- 016: Rascunhos temporários de venda, privados por conta, sem valores em localStorage.
-- A venda só existe financeiramente depois do RPC de confirmação.
begin;

create table public.pbws_sale_drafts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('sale','historical_sale')),
  form_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(form_data) = 'object' and pg_column_size(form_data) <= 12000),
  request_id uuid not null,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  primary key(owner_id,kind)
);
create index pbws_sale_drafts_expiry on public.pbws_sale_drafts(expires_at);

-- O servidor decide o prazo: nunca confiar no relógio do aparelho.
create function pbws_private.stamp_sale_draft()
returns trigger language plpgsql security invoker set search_path=''
as $fn$
begin
  new.updated_at = now();
  new.expires_at = now() + interval '30 minutes';
  return new;
end;
$fn$;
create trigger pbws_sale_draft_clock
  before insert or update on public.pbws_sale_drafts
  for each row execute function pbws_private.stamp_sale_draft();

alter table public.pbws_sale_drafts enable row level security;
revoke all on public.pbws_sale_drafts from public,anon,authenticated;
grant select,insert,update,delete on public.pbws_sale_drafts to authenticated;

create policy "Draft owner reads only their own"
on public.pbws_sale_drafts for select to authenticated
using (
  owner_id=(select auth.uid()) and (select public.is_authorized_user())
);
create policy "Draft owner inserts within role"
on public.pbws_sale_drafts for insert to authenticated
with check (
  owner_id=(select auth.uid()) and (select public.is_authorized_user())
  and (
    (kind='sale' and (select public.current_app_role()) in ('ws','admin'))
    or (kind='historical_sale' and (select public.current_app_role()) in ('ws','admin','power'))
  )
);
create policy "Draft owner updates within role"
on public.pbws_sale_drafts for update to authenticated
using (
  owner_id=(select auth.uid()) and (select public.is_authorized_user())
)
with check (
  owner_id=(select auth.uid()) and (select public.is_authorized_user())
  and (
    (kind='sale' and (select public.current_app_role()) in ('ws','admin'))
    or (kind='historical_sale' and (select public.current_app_role()) in ('ws','admin','power'))
  )
);
create policy "Draft owner deletes only their own"
on public.pbws_sale_drafts for delete to authenticated
using (
  owner_id=(select auth.uid()) and (select public.is_authorized_user())
);
commit;
