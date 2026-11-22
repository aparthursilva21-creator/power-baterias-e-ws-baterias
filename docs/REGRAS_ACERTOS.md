# Regra de negócio — repasses entre Power Baterias e WS Baterias

## Regra aprovada pela operação

Wanderson (WS) recebe a bateria usada do Sandro (Power), sem pagar antecipadamente. O valor de repasse é registrado por bateria. A obrigação financeira **só surge quando a WS vende aquela bateria**.

A venda gera, numa única operação de banco:

1. o registro da venda e garantia;
2. a alteração do status da bateria para vendida;
3. **um** acerto pendente, no valor negociado de repasse;
4. eventos de auditoria com usuário e data.

Baterias recebidas, em recuperação ou disponíveis **não entram no total devido**.

## Papéis

| Perfil | Quem | Pode fazer |
| --- | --- | --- |
| `admin` | Arthur | Cadastro, venda, atualização de bateria e gerenciamento de acertos |
| `power` | Sandro | Consultar estoque e vendas; registrar, ajustar, corrigir e dispensar acertos |
| `ws` | Wanderson | Cadastrar/recuperar baterias, registrar vendas e consultar acertos (sem editar) |

As permissões de escrita estão verificadas nas funções do banco, não apenas em botões da interface.

## Estados do acerto

- **Pendente**: valor do repasse ainda não pago nem dispensado;
- **Parcial**: recebeu parte do valor, ainda existe saldo;
- **Quitado**: pagamento integral;
- **Dispensado**: Sandro dispensou o saldo pendente e informou um motivo;
- **Reaberto**: uma dispensa anterior foi revertida; o saldo volta a ficar pendente.

Exemplo: bateria comprada por R$ 60 e vendida por R$ 200. Nasce um acerto de R$ 60, não de R$ 200. Um pagamento de R$ 40 deixa R$ 20 pendentes. Uma dispensa posterior dos R$ 20 encerra o acerto com R$ 40 pagos e R$ 20 dispensados.

O sistema não apaga o registro antigo: as alterações ficam em `used_settlement_events`.

## Operações disponíveis no banco

- `register_used_battery`: recebe a bateria, sem criar acerto.
- `update_used_battery`: atualiza recuperação, disponibilidade e preços antes da venda.
- `register_used_battery_sale`: registra a venda, baixa o estoque e cria acerto pendente de forma transacional.
- `manage_used_settlement`:
  - `payment`: registra pagamento parcial ou integral;
  - `correct_paid`: retifica o valor registrado como pago, com motivo;
  - `adjust_owed`: muda o total devido, com motivo;
  - `waive`: dispensa o restante, com motivo;
  - `reopen`: restaura saldo dispensado, com motivo.

Moeda armazenada em centavos inteiros. Ex.: R$ 60,00 corresponde a `6000`.

## Implantação no NOVO Supabase

**Atenção:** ainda não está rodando no banco; estes arquivos estão apenas versionados no GitHub.

1. Confirme que está no projeto novo de Power × WS, **não** no projeto da loja antiga.
2. Confirme que `setup-auth.sql` já foi executado (tabela `authorized_users` e função `is_authorized_user()`).
3. Abra **SQL Editor > New query** no projeto novo e execute integralmente `supabase/002_used_batteries_schema.sql`.
4. Em uma nova consulta, execute `supabase/003_used_batteries_operations.sql`.
5. Confira se as duas consultas retornaram sucesso, sem erro.
6. Antes de usar dados reais, precisamos conectar o frontend às RPCs e testar os três perfis, dupla venda, pagamento parcial, dispensa e correção.

As operações na interface atualmente são **simulação em localStorage** e **não** utilizam estas tabelas. Não registre dados reais no protótipo.

## Próximos testes de aceitação

- [ ] Uma bateria recebida não gera dívida.
- [ ] Uma venda cria exatamente um acerto pendente para Sandro.
- [ ] Uma tentativa de vender bateria já vendida deve falhar, sem gravar metade.
- [ ] Wanderson consegue visualizar, mas não consegue pagar/dispensar acertos.
- [ ] Sandro paga parcialmente e o saldo reduz corretamente.
- [ ] Sandro dispensa um saldo com justificativa obrigatória.
- [ ] Sandro corrige pagamento anterior com justificativa e trilha de auditoria.
- [ ] Revogação de usuário bloqueia leitura e escrita no banco.
- [ ] Dois celulares veem os mesmos dados após sincronização.
- [ ] Erros de internet não duplicam vendas.

## Pendências antes do uso diário

Precisamos desenvolver a interface conectada ao Supabase (sem localStorage para operações reais), testes de integração em banco separado, relatórios, cancelamentos/estornos de vendas, backups, proteção de dados pessoais e testes nos aparelhos de Sandro e Wanderson.
