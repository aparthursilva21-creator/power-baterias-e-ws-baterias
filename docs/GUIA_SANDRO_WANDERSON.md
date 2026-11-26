# Guia de uso compartilhado — Power Baterias × WS Baterias

## O que cada pessoa faz

**Wanderson (WS Baterias)** registra as vendas de hoje e as vendas antigas com data real. Também pode conferir, corrigir e cancelar vendas, com justificativa.

**Sandro (Power Baterias)** acompanha todas as vendas e os valores de repasse, gerencia os acertos e pode **corrigir ou cancelar qualquer venda ativa lançada pela WS**, independentemente de quem a cadastrou. Não precisa fazer um lançamento novo para corrigir informações.

**Administrador** acompanha todas as operações, relatórios e auditoria, mas novos lançamentos de venda seguem o fluxo da WS.

Não há aprovação dupla automática. A equipe combina o ajuste entre si e a pessoa responsável faz a alteração. O sistema registra quem atuou, o horário da ação, motivo e dados anteriores/novos. Isso permite revisão conjunta sem travar o trabalho.

## Como corrigir uma venda

1. Abra **Vendas**, localize a bateria pelo nome, cliente e data.
2. Clique em **Corrigir**.
3. Ajuste os campos necessários (marca/modelo, cliente, valores de venda, garantia, data e hora etc.).
4. Preencha **Motivo da correção** e salve.

O banco grava a correção com responsável, motivo e valores antes/depois, mantendo a identificação de quem cadastrou originalmente. Um aviso de venda corrigida é enviado às caixas de notificações de Sandro e Wanderson.

**Importante:** a alteração do valor de repasse ao Sandro é feita na área **Acertos**, com sua própria auditoria. A alteração do preço da venda não reajusta automaticamente o repasse.

## Como cancelar uma venda

Abra **Vendas → Excluir venda**, escreva um motivo e digite `CANCELAR` para confirmar. A venda é cancelada logicamente e sai dos totais, mas permanece auditada. Uma notificação informa ambos.

Se a venda possuir acerto já pago, dispensado ou associado a lote, o cancelamento é bloqueado até a conciliação financeira, para evitar que uma dívida ou recebimento desapareça indevidamente.

## Como receber notificações no celular

O sistema registra avisos na **central do sininho** em caso de venda nova, correção e cancelamento. Ambos recebem o aviso, inclusive a conta que executou a ação.

Para receber notificações **fora do site**, cada pessoa precisa ativar Web Push no próprio aparelho:

1. Abra o sistema autenticado no celular.
2. Na **Início**, toque em **Abrir notificações** (ou no ícone do sininho).
3. Na área **Avisos no celular**, toque em **Ativar notificações** e conceda permissão.
4. Confira o aviso indicando que este aparelho está registrado.

No iPhone, instale o site pela opção **Adicionar à Tela de Início** no Safari e abra pelo ícone antes de ativar. No Android, use um navegador com suporte a Push.

Sem permissão ativa, a notificação aparece no **sininho dentro do sistema**, mas não será mostrada pelo sistema operacional quando o site estiver fechado. A entrega externa também depende da internet e do serviço de notificações do aparelho.

## Interface mais simples

A nova versão troca o verde neon por **fundo claro, verde discreto e maior contraste**, com botões maiores e melhor leitura. A tela inicial exibe poucos indicadores principais e atalhos para Vendas, Acertos e Notificações.

No celular, a barra inferior mostra **Início, Vendas, Acertos e Relatórios**; outras opções ficam em **Mais**. Em Vendas, as linhas são organizadas em cartões para facilitar a leitura e a escolha de **Corrigir**, **Excluir venda** ou **Notinha WS**.

## Relatórios

A aba **Relatórios** continua com seleção **Diário, Mensal e Anual**, permitindo baixar PDF ou CSV. Toda venda cancelada deixa de contar nos totais, sem perder o registro de auditoria.

## Segurança

As regras de acesso também são validadas no **Supabase**, não apenas nos botões. Cadastro exclusivo WS; correção e cancelamento para WS/Power/admin; auditoria transacional. Nenhuma venda existente é alterada apenas por instalar a atualização.

Arquivos: `app.js`, `calm-ui.css`, `supabase/020_shared_sales_roles_notifications.sql`, `tests/shared-sales-workflow.sql`.
