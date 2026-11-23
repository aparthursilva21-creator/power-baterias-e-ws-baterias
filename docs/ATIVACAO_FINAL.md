# Implantação Power Baterias × WS Baterias

## O que foi implementado no site

O sistema é uma aplicação web responsiva para navegador e tela inicial do Android/iPhone (PWA), com autenticação Google e Supabase como fonte única de dados. **Não há vendas reais em localStorage.**

- Vendas diretas: Wanderson preenche os dados da bateria **no próprio lançamento da venda** (marca, modelo, amperagem, número de série), preço recebido, repasse ao Sandro, custo de recuperação, cliente, telefone, placa, pagamento e garantia.
- **Sem estoque:** não existe menu de inventário, cadastro prévio nem etapa de disponibilidade. A ficha da bateria é criada no histórico no mesmo instante que a venda e o acerto pendente.
- Acertos: dívida só depois da venda; Sandro ou administrador podem registrar pagamentos, ajustar preço, dispensar saldo, reabrir e corrigir com motivo.
- Lotes: Sandro seleciona de 1 a 100 acertos, edita o valor de cada bateria, soma e confirma tudo em uma transação. Todos os itens ficam verdes quando quitados/dispensados.
- Despesas: gasolina, peças, materiais, entregas e outros gastos da WS; correções auditadas.
- Relatórios: vendas do mês, faturamento, repasses, recebimentos, despesas e lucro operacional estimado. Exportação de vendas em CSV.
- Auditoria: eventos com data, hora e conta responsável, guardados no PostgreSQL e exibidos no horário de Brasília.

## Estado de implantação no projeto Supabase `pbEws`

As migrações 002, 003, 004 e 005 **já foram instaladas no projeto novo** da parceria por conexão autorizada. A migração 006 substitui o fluxo antigo de estoque por venda direta, preservando as tabelas internas apenas para histórico.

**Não execute `INSTALAR_FINAL.sql` novamente no projeto já configurado.** Ele é destinado somente à instalação do zero, em outro projeto novo e vazio.

Para conferir o aplicativo: entre no endereço GitHub Pages, recarregue a página e use **Vendas → Registrar venda**. A venda cria a bateria no histórico e gera automaticamente o acerto pendente ao Sandro.

Antes de registrar valores reais, valide o login de cada perfil, uma venda de teste e um acerto em lote. Não registre dados pessoais de clientes durante os testes fictícios.

## Contas e permissões

| Conta | Funções |
| --- | --- |
| Arthur (admin) | Todos os módulos e operações |
| Sandro (Power) | Ver vendas e clientes, repasses e relatórios; editar valores e confirmar acertos individuais e em lote |
| Wanderson (WS) | Lançar bateria diretamente na venda, registrar gasolina e despesas; consultar histórico e resultados |

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
- Um mesmo identificador de envio do celular não cria venda duplicada se a conexão oscilar.
- Relatórios de lucro são gerenciais, não substituem contabilidade e impostos.
- Despesas de recuperação não podem ser informadas simultaneamente como custo por bateria e custo geral, para evitar duplicidade no cálculo.
- O histórico completo permanece no banco; a tela de auditoria carrega um recorte recente para desempenho.

## Limitações e homologação obrigatória

Antes de usar na rotina da empresa, validar:

- Login das três contas nos dispositivos reais e o bloqueio de conta não autorizada.
- Venda direta criando dívida apenas após a venda, acerto parcial, pagamento completo, dispensa, reabertura e lote de 10 baterias.
- Queda de internet e retomada sem duplicar venda.
- Datas/horas dos eventos e conferência de relatórios mensais.
- Política de backup/retenção e proteção de dados pessoais no projeto Supabase.
- Rotina de devolução/estorno de venda, troca em garantia e eventual emissão de documento fiscal: **não implementadas** nesta versão. São processos que exigem regras adicionais e não devem ser simulados apagando registros.

**Não coloque os registros operacionais da empresa em produção antes desta homologação.**

## Testes automáticos

GitHub Actions verifica sintaxe de \`auth.js\` e \`app.js\`, HTML/PWA, banco de laboratório em PostgreSQL e testes simulados de interface em Chrome mobile/desktop. Para ver a execução atual: aba **Actions** do repositório.
