# Implantação Power Baterias × WS Baterias

## O que foi implementado no site

O sistema é uma aplicação web responsiva para navegador e tela inicial do Android/iPhone (PWA), com autenticação Google e Supabase como fonte única de dados. **Não há vendas reais em localStorage.**

- Baterias: cadastro com marca, modelo, amperagem, número de série, valor de repasse, recuperação, preço e status.
- Vendas: cliente, telefone, placa, preço real, pagamento e garantia. Horário registrado no servidor.
- Acertos: dívida só depois da venda; Sandro ou administrador podem registrar pagamentos, ajustar preço, dispensar saldo, reabrir e corrigir com motivo.
- Lotes: Sandro seleciona de 1 a 100 acertos, edita o valor de cada bateria, soma e confirma tudo em uma transação. Todos os itens ficam verdes quando quitados/dispensados.
- Despesas: gasolina, peças, materiais, entregas e outros gastos da WS; correções auditadas.
- Relatórios: vendas do mês, faturamento, repasses, recebimentos, despesas e lucro operacional estimado. Exportação de vendas em CSV.
- Auditoria: eventos com data, hora e conta responsável, guardados no PostgreSQL e exibidos no horário de Brasília.

## IMPORTANTE: ativar o banco da parceria

**O assistente não tem acesso ao SQL Editor do seu Supabase.** Os scripts foram testados em PostgreSQL de laboratório, mas você precisa executá-los **uma única vez, na ordem**, no projeto NOVO da parceria — não no Power Baterias antigo.

1. Abra o projeto Supabase da parceria no seu dashboard.
2. Entre em **SQL Editor → New query**.
3. Abra e cole o conteúdo completo de **supabase/002_used_batteries_schema.sql**; clique Run e confira sucesso.
4. Faça a mesma coisa com **supabase/003_used_batteries_operations.sql**.
5. Execute **supabase/004_batches_expenses_reports.sql**.
6. Execute **supabase/005_staff_realtime.sql**.
7. Abra o site (Ctrl+Shift+R no computador ou feche e reabra no celular). Entre com a conta Google autorizada.
8. Teste com **baterias fictícias** até validar Sandro, Wanderson e Arthur trabalhando ao mesmo tempo.

A etapa anterior \`supabase/setup-auth.sql\` já foi preparada e executada durante a configuração do Google Login. Se trocar o banco, ela deverá ser feita antes das quatro migrações acima.

Se aparecer **Configuração necessária** no site, não lance vendas. Confira as migrações e suas mensagens de erro.

## Contas e permissões

| Conta | Funções |
| --- | --- |
| Arthur (admin) | Todos os módulos e operações |
| Sandro (Power) | Ver vendas, estoque, clientes, repasses, relatórios; editar valores e confirmar acertos individuais e em lote |
| Wanderson (WS) | Cadastrar bateria, recuperar, vender, registrar gasolina e despesas; consultar o histórico e seus resultados |

Permissões de gravação verificadas no banco, não apenas na interface.

**Nunca copie Client Secret, senha, chave service_role ou chave \`sb_secret_\` para arquivos públicos.** A chave publishable do Supabase é pública; segurança depende de RLS e RPC, não da ocultação dessa chave.

## Como instalar no celular

### Android (Chrome)

Abra o endereço do GitHub Pages, menu **⋮** → **Instalar aplicativo** ou **Adicionar à tela inicial**. Confirme. O atalho aparecerá como *Power × WS*.

### iPhone (Safari)

Abra no Safari, toque em **Compartilhar** → **Adicionar à Tela de Início** → **Adicionar**. Isso cria um atalho web independente no iPhone.

O aplicativo pode manter a sessão Google ativa no mesmo dispositivo, desde que o navegador preserve o login e a conta continue autorizada. **Não é um aplicativo offline**: cadastros e pagamentos precisam de internet.

## Segurança e operação

- Horários do banco em \`timestamptz\`; interface em \`America/Sao_Paulo\`.
- Ações de alto impacto registradas com UUID da conta e descrição.
- Acerto de lote é atômico: se um item falhar, nenhuma bateria do lote é quitada.
- Bateria já vendida não pode ser vendida novamente.
- Relatórios de lucro são gerenciais, não substituem contabilidade e impostos.
- Despesas de recuperação não podem ser informadas simultaneamente como custo por bateria e custo geral, para evitar duplicidade no cálculo.
- O histórico completo permanece no banco; a tela de auditoria carrega um recorte recente para desempenho.

## Limitações e homologação obrigatória

Antes de usar na rotina da empresa, validar:

- Login das três contas nos dispositivos reais e o bloqueio de conta não autorizada.
- Recebimento sem dívida, venda gerando dívida, acerto parcial, pagamento completo, dispensa, reabertura e lote de 10 baterias.
- Queda de internet e retomada sem duplicar venda.
- Datas/horas dos eventos e conferência de relatórios mensais.
- Política de backup/retenção e proteção de dados pessoais no projeto Supabase.
- Rotina de devolução/estorno de venda, troca em garantia e eventual emissão de documento fiscal: **não implementadas** nesta versão. São processos que exigem regras adicionais e não devem ser simulados apagando registros.

**Não coloque os registros operacionais da empresa em produção antes desta homologação.**

## Testes automáticos

GitHub Actions verifica sintaxe de \`auth.js\` e \`app.js\`, HTML/PWA, banco de laboratório em PostgreSQL e testes simulados de interface em Chrome mobile/desktop. Para ver a execução atual: aba **Actions** do repositório.
