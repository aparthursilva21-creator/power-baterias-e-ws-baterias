# Cancelamento de vendas e relatórios diários, mensais e anuais

## Excluir uma venda (Sandro, Wanderson ou administrador)

1. Abra **Vendas** e localize a venda pelo **nome da bateria**, cliente e data.
2. Clique em **Excluir venda**.
3. Confira a bateria, valor e o aviso financeiro.
4. Informe uma justificativa real, com no mínimo 5 caracteres.
5. Digite **CANCELAR** exatamente e confirme.

**Não apagamos o registro original.** A exclusão marca a venda como **cancelada**, retira-a do painel e dos totais financeiros, preserva seu registro completo no Supabase e grava um evento de auditoria. O histórico mostra data e hora da ação, autor, cliente, marca/modelo da bateria, preço e motivo informado.

A exclusão é permitida às contas autorizadas da **Power Baterias (Sandro)**, **WS Baterias (Wanderson)** e **administrador (Arthur)**.

### Proteção dos acertos

Não é permitido cancelar uma venda cujo acerto com Sandro já tenha **pagamento, dispensa ou participação em acerto em lote**. O sistema bloqueia e informa que o valor precisa ser reconciliado antes, para não apagar uma venda que gerou movimentação financeira real. A correção depende de revisão da operação e dos comprovantes, e não estorna dinheiro automaticamente.

O botão **Excluir venda** não é exclusão permanente do banco, inclusive por segurança dos registros de vendas e auditorias.

### Histórico de alterações

Na aba **Histórico** são mantidos os eventos de venda, correção, cancelamento, acerto, pagamento e despesas. As exclusões passam a registrar **antes e depois**, autor da ação, motivo e data/hora do servidor. Alterações anteriores não são apagadas.

## Relatórios — Diário, Mensal e Anual

1. Abra **Relatórios** e escolha o **Tipo de relatório**:
   - **Diário:** escolha a data desejada.
   - **Mensal:** escolha mês e ano.
   - **Anual:** informe o ano.
2. Clique em **Consultar período**. Também pode clicar em **Atualizar**.
3. O resumo é calculado pelo servidor Supabase; a tabela lista as vendas ativas dentro do período.
4. Clique em **Baixar PDF** para salvar um relatório operacional em formato A4, com resumo financeiro, vendas e despesas. Para planilhas, use **Exportar vendas CSV**.

### O que entra no relatório

- Quantidade de vendas e faturamento da WS **pela data real da venda**;
- Repasse previsto à Power, custos de recuperação e lucro estimado operacional da WS, conforme perfil;
- Valores efetivamente pagos à Power **pela data do acerto**;
- Despesas WS ou Power **pela data do gasto**, sem misturar as empresas;
- Saldo pendente **total atual**, sinalizado como total de todos os períodos;
- Relação de vendas e gastos do período, respeitando as permissões de cada perfil.

**Sandro:** vê relatórios de vendas/repasses e suas despesas Power. **Wanderson:** vê seus dados WS, sem acessar despesas privadas da Power. **Arthur:** pode acompanhar ambas.

Os relatórios **não incluem vendas canceladas**. Dados do mês/ano são filtrados usando o horário **America/Sao_Paulo**, para não transferir vendas entre dias por causa de fuso horário.

### PDF e privacidade

O arquivo PDF é gerado dentro do navegador, sem enviar nomes de clientes para um serviço de PDF de terceiros. Os totais vêm da consulta autenticada ao banco e as linhas detalhadas são obtidas dos registros visíveis à conta. O PDF é um **relatório gerencial interno**, não uma nota fiscal nem uma demonstração contábil.

### Referências técnicas

- `supabase/019_cancel_and_period_reports.sql` — RPC de cancelamento com auditoria e RPC `get_power_ws_period_report(p_start, p_end)`, com limite de 366 dias.
- `report-pdf.js` — gerador de relatórios A4 em PDF, com paginação das vendas/despesas.
- `app.js` — filtro diário, mensal e anual, consulta RPC, PDFs/CSV e botão de exclusão para Power/WS/admin.
- `tests/cancel-period-integration.sql` — confirma auditoria, papéis de usuários, bloqueio de exclusões de vendas pagas e agrupamento de períodos.
- `tests/browser-smoke.mjs` — valida os botões, modos de relatório e arquivos PDF no navegador.

Esta atualização não exclui nem modifica registros existentes durante a implantação. Cada exclusão exige uma ação manual, autorizada e justificada, após a publicação.
