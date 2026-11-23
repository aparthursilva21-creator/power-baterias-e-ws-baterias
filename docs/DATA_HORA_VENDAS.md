# Data e hora da venda: lançamento e correção com auditoria

## O que o Wanderson pode fazer

**Venda de hoje:** abra **Vendas → Venda de hoje**. No campo **Data e hora reais da venda**, deixe vazio para registrar o horário do servidor ou escolha o dia e a hora verdadeiros (horário de Brasília), inclusive quando a venda já aconteceu mais cedo e só está sendo registrada agora. Confirme a venda normalmente. A notinha da WS usa a data efetiva escolhida.

**Venda antiga:** abra **Vendas → Lançar venda antiga** e informe obrigatoriamente quando aconteceu. Também é possível informar um acerto já pago, com data e valor.

**Venda já registrada:** abra **Vendas → Corrigir** na linha da venda. A data e hora atuais são preenchidas, podendo ser substituídas. Digite um **motivo obrigatório** e clique em **Salvar correção**.

O Wanderson corrige vendas registradas pela própria conta; Arthur pode corrigir as vendas; Sandro mantém a permissão que já tinha de corrigir importações históricas feitas pela própria conta.

## Como a auditoria funciona

A atualização preserva a **data de cadastro no sistema** (`recorded_at`), o **responsável pelo registro** (`recorded_by`) e o **vendedor** (`sold_by`). Não é possível editar esses campos pela interface de correção.

O banco armazena em `used_sale_revisions`, dentro da mesma transação da alteração, os dados **antes e depois** (`before_data` e `after_data`), o responsável da correção (`actor_id`), o motivo (`reason`) e o momento da correção (`occurred_at`).

A aba **Histórico** mostra o código da bateria e, quando a data foi alterada, **ANTES: DD/MM/AAAA HH:MM → DEPOIS: DD/MM/AAAA HH:MM**, além de motivo, data/hora da correção e responsável. A aba **Vendas** identifica alterações recentes de data com o indicador **Data/hora corrigida**.

## Proteções

- Não são aceitas datas no futuro.
- Uma data corrigida não pode ser posterior a um pagamento já registrado para o acerto vinculado.
- O usuário deve fornecer um motivo de pelo menos 5 caracteres.
- O banco conserva a data e hora originais no histórico de auditoria e não apaga os registros anteriores.
- Mudar a data efetiva da venda altera o mês de receita dos relatórios, o cálculo do prazo de garantia e a data apresentada na notinha reemitida.
- **Não** altera o valor do repasse ao Sandro nem a data dos pagamentos anteriores.

Os lançamentos já realizados **não têm seus valores ou datas modificados pela instalação desta atualização**; as alterações acontecem somente quando um usuário autorizado corrige uma venda.

## Implementação técnica

- `supabase/018_sale_datetime_audit.sql` atualiza a RPC `correct_used_battery_sale` para aceitar `sold_at_local` em vendas normais e históricas com auditoria obrigatória.
- `app.js` apresenta a data/hora no cadastro e na correção e mostra valores antigos/novos na aba Histórico.
- `tests/historical-integration.sql` valida datas, auditoria, mês de receita, bloqueio de datas futuras e preservação do cadastro.
- `tests/browser-smoke.mjs` valida os formulários e a apresentação dos logs no celular e no computador.
