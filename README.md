# Power Baterias × WS Baterias

Sistema privado de **lançamento direto de vendas de baterias usadas**, garantias, acertos com Sandro, despesas e relatórios. **Não existe módulo de estoque**: cada bateria entra no histórico no momento da venda.

**Site:** https://aparthursilva21-creator.github.io/power-baterias-e-ws-baterias/

**[Guia de ativação do banco e do celular](docs/ATIVACAO_FINAL.md)**

**[Notificações: sininho, cobrança de acertos e Push no Android/iPhone](docs/NOTIFICACOES.md)**

## Arquitetura

- HTML, CSS e JavaScript sem build, hospedados no GitHub Pages;
- Supabase Auth (Google OAuth);
- PostgreSQL com RLS, funções de negócio SECURITY DEFINER e auditoria;
- Atualização via Supabase Realtime com recarregamento periódico como fallback;
- PWA para Android e iPhone.

## Banco

Rodar no **Supabase novo da parceria**, após executar \`supabase/setup-auth.sql\` uma única vez. Para instalar a operação, use o arquivo **[INSTALAR_FINAL.sql](supabase/INSTALAR_FINAL.sql)**, que inclui na ordem as migrações 002 a 006. Não execute o instalador mais de uma vez sem verificar o resultado.

O sistema antigo da Power Baterias não é alterado por estes arquivos.

## Qualidade

Os testes são executados em **GitHub Actions**. Eles não substituem a homologação real com as três contas no Supabase e celulares.

**Atenção:** nunca publicar segredos OAuth, chaves service_role ou dados de clientes no GitHub.

## Venda direta (sem estoque)

Em **Vendas → Registrar venda**, o vendedor informa a bateria, o preço real, o valor devido ao Sandro, o custo de recuperação, o cliente e a garantia. A transação registra tudo em um único lançamento, com horário e autor gerados pelo banco. O Sandro recebe o acerto pendente automaticamente. A migração `006_direct_sale_no_stock.sql` desabilita as antigas funções de cadastro de estoque para clientes autenticados.

## Notificações

A cada venda registrada, Sandro recebe um aviso; ao confirmar um acerto, Wanderson recebe a confirmação. Sandro pode enviar lembrete manual pela aba **Acertos → Cobrar WS**. Existe um resumo automático de pendências às **09h (Brasília)**, apenas quando há acertos em aberto. O sininho guarda os avisos mesmo que o Push seja bloqueado. Para recebê-los na tela bloqueada, cada usuário deve ativar Push no próprio celular.
