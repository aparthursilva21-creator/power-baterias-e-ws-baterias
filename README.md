# Power Baterias × WS Baterias

Sistema privado de **lançamento direto de vendas de baterias usadas**, garantias, acertos com Sandro, despesas e relatórios. **Não existe módulo de estoque**: cada bateria entra no histórico no momento da venda.

**Site:** https://aparthursilva21-creator.github.io/power-baterias-e-ws-baterias/

**[Guia de ativação do banco e do celular](docs/ATIVACAO_FINAL.md)**

**[Notificações: sininho, cobrança de acertos e Push no Android/iPhone](docs/NOTIFICACOES.md)**

**[Como lançar vendas e gastos antigos, com datas e acertos históricos](docs/LANCAMENTOS_ANTIGOS.md)**

**[Como gerar e compartilhar a notinha azul da WS Baterias](docs/COMPROVANTE_WS.md)**

**[Continuar uma venda após consultar o WhatsApp, sem perder os campos](docs/CONTINUIDADE_WHATSAPP.md)**

**[Alterar data e hora de venda com registro de quem corrigiu](docs/DATA_HORA_VENDAS.md)**

**[Excluir vendas com histórico e consultar relatórios por dia/mês/ano em PDF](docs/CANCELAMENTOS_E_RELATORIOS.md)**

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

## Lançamentos retroativos

Em **Vendas → Lançar venda antiga**, use a data/hora real do negócio e informe também se o repasse à Power já foi pago e quando. Em **Despesas → Gasto antigo**, informe a data real, o horário quando conhecido e o valor. As datas de cadastro e os responsáveis permanecem separados no banco para auditoria. A aba **Despesas** usa caixas separados: Sandro vê gastos Power, Wanderson vê gastos WS e Arthur pode alternar entre as duas empresas. Relatórios também apresentam as despesas Power isoladas do lucro WS.

## Comprovante de venda WS Baterias

Ao confirmar uma venda, o sistema abre automaticamente o comprovante WS (não fiscal). É possível baixar o PDF, imprimir e compartilhar no celular. Uma segunda via pode ser gerada em **Vendas → Notinha WS**. O documento usa o tema azul WS, destaca **marca/modelo/amperagem da bateria sem códigos internos**, exibe quantidade e preço em formato de comprovante comercial e protege valores internos de repasse e custos de recuperação.

## Continuidade do aplicativo no celular

Ao alternar para o WhatsApp, o sistema mantém o login Google e não desmonta o formulário ao receber novamente o evento de sessão ativa. Vendas não concluídas ganham **rascunho privado no Supabase, válido por até 30 minutos após a última edição**, para recuperação após o celular encerrar a página. O botão **Descartar rascunho** limpa uma tentativa; o salvamento de uma venda real também o apaga. Dados de clientes não são guardados no armazenamento permanente do navegador.

## Exclusões e relatórios por período

Sandro, Wanderson e Arthur podem **excluir/cancelar uma venda com motivo obrigatório**, preservando registro, responsável e auditoria completa. Vendas com acertos já pagos, dispensados ou em lote agora **podem ser canceladas por Sandro ou administrador com confirmação**, preservando os pagamentos anteriores e criando uma **conciliação financeira pendente** em Acertos. A aba **Relatórios** permite **Diário, Mensal e Anual** e exporta **PDF e CSV**, com totais calculados pelo Supabase em horário de Brasília.

## Uso compartilhado Power e WS

**[Guia de uso conjunto: Sandro e Wanderson, correções, cancelamentos e notificações](docs/GUIA_SANDRO_WANDERSON.md)**

A interface foi simplificada para leitura no celular, com fundo claro e verde discreto. **Wanderson registra as vendas; Sandro e Wanderson podem corrigir/cancelar vendas**, sempre com justificativa, antes/depois e notificação para ambos. Os avisos no sistema funcionam automaticamente; para recebê-los com o aplicativo fechado, cada celular deve ativar Push no sininho. Relatórios diários, mensais e anuais com PDF foram mantidos.

**[Cancelar uma venda com acerto lançado e editar o nome do cliente](docs/CANCELAMENTO_COM_ACERTO.md)** — o sistema preserva o dinheiro registrado, exige motivo e guarda o histórico. Os vales do Wanderson serão definidos separadamente dos acertos.
