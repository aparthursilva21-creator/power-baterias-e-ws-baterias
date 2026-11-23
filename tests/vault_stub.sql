-- Stub de Vault somente para Postgres de teste em CI; jamais executar no Supabase.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema vault;
create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  secret text not null,
  name text not null
);
create view vault.decrypted_secrets as
  select id,secret as decrypted_secret from vault.secrets;
create function vault.create_secret(
  new_secret text,new_name text default null,new_description text default null
) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into vault.secrets(secret,name)
  values(new_secret,coalesce(new_name,'test'))
  returning id into v_id;
  return v_id;
end;
$$;
