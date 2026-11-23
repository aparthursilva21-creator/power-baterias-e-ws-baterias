-- 017: apagar rascunhos vencidos sem tocar em vendas confirmadas.
-- A recuperação deixa de funcionar após 30 minutos da última gravação;
-- o job periódico remove os dados pessoais de rascunhos abandonados.
begin;
do $job$
begin
 if exists (select 1 from pg_catalog.pg_namespace where nspname='cron') then
  execute $schedule$
    select cron.schedule(
      'pbws-sale-drafts-purge',
      '*/30 * * * *',
      'delete from public.pbws_sale_drafts where expires_at <= now();'
    );
  $schedule$;
 end if;
end;
$job$;
commit;
