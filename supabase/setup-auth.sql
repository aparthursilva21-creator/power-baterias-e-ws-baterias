-- POWER BATERIAS × WS BATERIAS — Etapa 2: controle de acesso
-- Executar SOMENTE no SQL Editor do NOVO projeto Supabase.
-- NÃO executar no banco de produção da Power Baterias.
-- Não incluir senhas nem dados pessoais reais no repositório.

create table if not exists public.authorized_users (
  email text primary key,
  role text not null check (role in ('admin', 'power', 'ws')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint email_lowercase check (email = lower(trim(email)))
);

alter table public.authorized_users enable row level security;
-- Sem políticas de leitura/escrita para anon/authenticated.
-- Cadastro/alteração de acesso somente no SQL Editor por administrador de banco.

create or replace function public.is_authorized_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.authorized_users au
    join auth.users u on u.id = auth.uid()
    join auth.identities i on i.user_id = u.id and i.provider = 'google'
    where au.email = lower(trim(u.email))
      and au.active = true
      and u.email_confirmed_at is not null
  );
$$;

revoke all on function public.is_authorized_user() from public, anon;
grant execute on function public.is_authorized_user() to authenticated;

-- Depois de receber os e-mails corretos, configure as TRÊS contas no SQL Editor:
-- insert into public.authorized_users (email,role) values
-- ('email-do-arthur@gmail.com','admin'),
-- ('email-do-pai@gmail.com','power'),
-- ('email-do-irmao@gmail.com','ws')
-- on conflict (email) do update set role = excluded.role, active = true;

-- Regra para TODAS as tabelas operacionais que serão criadas na próxima etapa:
-- habilitar RLS e permitir acesso somente se public.is_authorized_user() = true.
-- Ocultar telas no frontend sozinho NÃO protege dados em banco.
