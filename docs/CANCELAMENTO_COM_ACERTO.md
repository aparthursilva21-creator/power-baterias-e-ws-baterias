# Como Sandro corrige e cancela uma venda com acerto já lançado

## Editar uma venda já lançada

Em **Vendas → Editar venda**, Sandro pode alterar diretamente **nome do cliente, WhatsApp e placa**. Para valores, bateria, garantia e data real da venda, abra **Editar outros dados da venda**.

É obrigatório explicar o motivo. As correções registram autor, data e hora e os dados **antes/depois**. A conta WS recebe um aviso, assim como a conta do Sandro.

A edição do preço final da venda **não altera automaticamente o repasse combinado** com a Power. Ajustes de repasse continuam em **Acertos**, com auditoria independente.

## Cancelar venda com acerto não pago

Em **Vendas → Cancelar venda**, confira a bateria, cliente e preço. Digite um motivo e a palavra **CANCELAR**. Sandro, Wanderson e administrador podem cancelar vendas **sem pagamento, dispensa ou lote anterior**, com histórico.

## Cancelar venda com acerto já lançado/pago

Se o acerto tem pagamento, dispensa ou participou de lote, apenas **Sandro ou o administrador** podem confirmar o cancelamento. O sistema exige uma caixa de confirmação sobre o histórico financeiro.

O cancelamento:

1. Mantém todos os registros do pagamento, autor, valor e data originais.
2. Marca a venda como cancelada, retirando-a das vendas ativas e faturamento.
3. Cria uma **pendência de conciliação financeira** na aba **Acertos**.
4. Registra autor, momento, motivo, bateria, cliente e os dados financeiros originais na auditoria.
5. Gera notificação às contas WS e Power.

**Importante:** cancelar a venda **não devolve dinheiro, não corrige transferência bancária, não reduz um pagamento anterior e não altera automaticamente outra venda**. O acerto existente continua preservado no banco. O relatório de pagamentos registrados mantém o histórico de entradas, inclusive de vendas canceladas, e destaca as pendências de conciliação.

## Resolver uma pendência financeira

Sandro abre **Acertos → Conciliação de vendas canceladas → Conferir**, seleciona **o que realmente aconteceu** e descreve com justificativa verificável:

- Valor devolvido de fato à WS;
- Valor compensado manualmente em outro acerto;
- Pagamento registrado incorretamente;
- Outra solução, com explicação.

Ao salvar, a pendência passa para **Conferida**, com nova auditoria e aviso. A escolha é uma declaração de conferência; o sistema **não realiza PIX nem desconta automaticamente** valores de outros acertos. Verifique a movimentação real e o comprovante antes de finalizar.

## Vales do Wanderson

Os **vales** não foram misturados a cancelamentos, despesas ou acertos de bateria nesta atualização. A regra exata de origem, responsável, vencimento e eventual abatimento precisa ser definida antes do módulo, para não duplicar dívidas nem descontar valores de forma incorreta.

## Referências

- `supabase/021_paid_cancellation_reviews.sql`: funções e tabelas de conciliação protegidas por RLS.
- `tests/paid-cancellation-workflow.sql`: autorizações, auditoria, manutenção do pagamento e resolução.
- `app.js`: edição do cliente e cancelamento com conferência.
- `report-pdf.js`: indicadores de pendências em relatórios.

Nenhuma venda real é cancelada ou modificada durante a instalação. A operação sempre exige a ação manual de uma conta autorizada.
