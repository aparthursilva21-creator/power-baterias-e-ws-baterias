-- Emulador mínimo do schema Auth da Supabase para CI. Nunca usar em produção.
create role authenticated;
create role anon;
create schema auth;
create table auth.users (id uuid primary key, email text not null, email_confirmed_at timestamptz);
create table auth.identities (user_id uuid not null, provider text not null);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $auth_role$
  select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user);
$auth_role$;
grant usage on schema public, auth to authenticated;
grant execute on function auth.uid() to authenticated;
insert into auth.users values
 ('00000000-0000-4000-8000-000000000001','admin@example.test',now()),
 ('00000000-0000-4000-8000-000000000002','sandro@example.test',now()),
 ('00000000-0000-4000-8000-000000000003','wanderson@example.test',now());
insert into auth.identities values
 ('00000000-0000-4000-8000-000000000001','google'),
 ('00000000-0000-4000-8000-000000000002','google'),
 ('00000000-0000-4000-8000-000000000003','google');
