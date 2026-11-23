# Lançamentos antigos — Power Baterias × WS Baterias

## Por que existem duas datas?

A **data da venda ou do gasto** representa quando a movimentação realmente aconteceu. É a data utilizada nos relatórios e, no caso de vendas, no prazo de garantia.

A **data de registro** representa quando alguém cadastrou a informação no sistema. Essa data é gerada automaticamente no servidor e **não pode ser inventada pelo operador**. Permanece no histórico para conferência.

Exemplo: venda em **15/10/2026 às 14h30**, lançada somente **23/11/2026**. A receita aparecerá no relatório de outubro, mas o histórico mostrará quem cadastrou em novembro.

## 1. Lançar venda antiga

Abra **Vendas → Lançar venda antiga**.

1. Informe **data e hora da venda real**, no horário de Brasília.
2. Preencha marca, modelo, preço, cliente, garantia e quanto deve ser repassado à Power.
3. Se a dívida ainda está pendente, deixe **Valor já pago ao Sandro = R$ 0,00**.
4. Se o pagamento já aconteceu, informe **quanto foi pago** (total ou parcial) e **a data e hora verdadeiras do acerto**.
5. Salve. O banco cria a venda e seu acerto na mesma transação, sem estoque.

O sistema coloca a venda no mês de ocorrência e o pagamento no mês em que foi efetivamente feito. Se o pagamento foi total, a bateria aparece como **Acertada**; se foi parcial, continua pendente somente o restante.

**Acesso:** Wanderson, Arthur e Sandro podem lançar vendas antigas. Sandro não recebe permissão para registrar vendas do dia feitas pela WS. Cada um pode corrigir suas próprias vendas antigas, inclusive a data, sempre explicando o motivo. Arthur pode corrigir qualquer lançamento.

**Não são aceitas datas futuras.** Use as datas efetivas de negócios já ocorridos; não altere o relógio do celular.

## 2. Registrar gasto antigo da WS

Abra **Despesas → Gasto antigo**. Arthur deve selecionar primeiro **WS Baterias** ou **Power Baterias**.

1. Escolha a categoria (gasolina, entrega, materiais etc.).
2. Informe a data real do gasto.
3. Se souber a hora, informe-a também; se não souber, pode deixar o horário vazio.
4. Digite o valor e uma descrição.
5. Salve. A despesa entrará no mês do gasto, e a data/hora do cadastro continuará no histórico.

**Acesso:** agora a aba **Despesas** é separada por empresa. **Wanderson vê e lança os gastos da WS**; **Sandro vê e lança os gastos da Power**; **Arthur pode consultar e selecionar as duas empresas**. Os valores não são misturados entre elas. As despesas da Power aparecem separadamente nos relatórios de Sandro e Arthur.

## 3. Os acertos e os relatórios

- Quando a venda é antiga, mas o acerto **ainda não foi pago**, ela aparece como pendente para Sandro.
- Quando a venda e o acerto já ocorreram, informe o pagamento antigo na própria importação; isso evita cobranças duplicadas.
- O relatório mensal agrupa as vendas e as despesas por **data real** e os pagamentos por **data efetiva do acerto**, mantendo separadamente o histórico do lançamento.
- Importações de vendas antigas não geram alerta Push como se fossem vendas de hoje.

## Observação sobre correções

Os botões **Corrigir** e **Cancelar** mantêm o histórico. Ao corrigir uma **venda antiga**, o formulário permite ajustar também sua data e hora originais, exigindo justificativa e impedindo que a venda fique posterior a um pagamento antigo já registrado. Essas mudanças podem alterar relatórios e garantia; confira antes de salvar.

## Implantação

Migração `supabase/013_historical_entries.sql`, instalada no projeto **pbEws**. Testes automáticos simulam lançamento retroativo, acerto parcial com data antiga, despesas anteriores, fuso horário de Brasília, permissões e preservação do registro normal.

Não executar o instalador completo novamente em um projeto que já esteja em funcionamento.
