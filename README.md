# Power Baterias × WS Baterias

Sistema privado de gestão de baterias usadas, vendas, garantias, repasses e relatórios.

**Site:** https://aparthursilva21-creator.github.io/power-baterias-e-ws-baterias/

**[Guia de ativação do banco e do celular](docs/ATIVACAO_FINAL.md)**

## Arquitetura

- HTML, CSS e JavaScript sem build, hospedados no GitHub Pages;
- Supabase Auth (Google OAuth);
- PostgreSQL com RLS, funções de negócio SECURITY DEFINER e auditoria;
- Atualização via Supabase Realtime com recarregamento periódico como fallback;
- PWA para Android e iPhone.

## Banco

Rodar apenas no **Supabase novo da parceria**, nesta ordem:

1. \`supabase/setup-auth.sql\` (se ainda não foi executado);
2. \`supabase/002_used_batteries_schema.sql\`;
3. \`supabase/003_used_batteries_operations.sql\`;
4. \`supabase/004_batches_expenses_reports.sql\`;
5. \`supabase/005_staff_realtime.sql\`.

O sistema antigo da Power Baterias não é alterado por estes arquivos.

## Qualidade

Os testes são executados em **GitHub Actions**. Eles não substituem a homologação real com as três contas no Supabase e celulares.

**Atenção:** nunca publicar segredos OAuth, chaves service_role ou dados de clientes no GitHub.
