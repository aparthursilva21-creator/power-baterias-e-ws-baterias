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

Rodar no **Supabase novo da parceria**, após executar \`supabase/setup-auth.sql\` uma única vez. Para instalar a operação, use o arquivo **[INSTALAR_FINAL.sql](supabase/INSTALAR_FINAL.sql)**, que inclui na ordem as migrações 002 a 005. Não execute o instalador mais de uma vez sem verificar o resultado.

O sistema antigo da Power Baterias não é alterado por estes arquivos.

## Qualidade

Os testes são executados em **GitHub Actions**. Eles não substituem a homologação real com as três contas no Supabase e celulares.

**Atenção:** nunca publicar segredos OAuth, chaves service_role ou dados de clientes no GitHub.
