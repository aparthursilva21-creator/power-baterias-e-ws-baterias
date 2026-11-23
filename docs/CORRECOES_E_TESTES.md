# Corrigir ou cancelar vendas — Power × WS

## Lançou alguma informação errada?

1. Abra **Vendas**.
2. Localize o lançamento e toque em **Corrigir**.
3. Ajuste marca/modelo, amperagem, número de série, nome/telefone do cliente, placa, valor da venda, custo de recuperação, pagamento, garantia ou observações.
4. Informe **por que está corrigindo** e salve.

O registro é atualizado nos celulares. A data e o usuário da venda original permanecem. A alteração aparece em **Histórico**, com autor, data, hora e dados anteriores e novos guardados para conferência.

**Importante:** mudar o valor que o Wanderson deve ao Sandro deve ser feito em **Acertos** por Sandro ou pelo administrador. Esse valor não é editado pela função de correção da venda.

## Venda duplicada ou lançada só para teste?

1. Arthur entra com a conta de **administrador**.
2. Abra **Vendas → Cancelar** na venda errada.
3. Explique o motivo e digite **CANCELAR** para confirmar.

A venda cancelada deixa de contar no painel, nas garantias, nos relatórios mensais e nas cobranças, mas continua guardada no banco com identificação do responsável. Isso é proposital para não apagar o histórico financeiro de uma empresa.

**Se houver pagamento/dispensa anotados no acerto:** o sistema bloqueia o cancelamento. O pagamento tem que ser verificado e corrigido antes, com histórico. Acertos realizados em lote requerem revisão administrativa antes do cancelamento. O sistema não estorna dinheiro real sozinho.

## Limpeza inicial de testes

Em 22/11/2026 foi solicitada a limpeza do único lançamento fictício existente: uma Moura WS-000001, venda de R$ 190,00 e acerto fictício de R$ 60,00. A operação foi feita de maneira controlada, com conferência de que não havia outras vendas, despesas nem acertos em lote. O registro de limpeza foi preservado em `pbws_test_reset_log`, sem informações pessoais do cliente.

As **contas de acesso Google, configurações do sistema e inscrições Push não foram apagadas**.

## Responsabilidades

- **Wanderson (WS):** pode corrigir suas próprias vendas, justificando a alteração.
- **Arthur (admin):** pode corrigir e cancelar vendas, sempre com motivo.
- **Sandro (Power):** pode acompanhar as vendas e ajustar pagamentos/valores de repasse na aba **Acertos**.

Não use o cancelamento como substituto de devolução de dinheiro, troca em garantia ou emissão/cancelamento de nota fiscal. Esses processos demandam conferência separada.
