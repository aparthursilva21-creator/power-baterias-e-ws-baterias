# Comprovante de venda — WS Baterias

O sistema gera um **comprovante de venda não fiscal**, com identidade visual azul da **WS Baterias**. O arquivo é gerado no navegador e não envia dados dos clientes para serviços externos de PDF.

## Quando uma venda é registrada

1. Entre na aba **Vendas**.
2. Toque em **Venda de hoje** ou, se for um registro histórico, **Lançar venda antiga**.
3. Preencha os dados e salve.
4. Depois que o servidor confirmar o registro, o **comprovante da WS abre automaticamente** para conferência.
5. Selecione **Baixar PDF**, **Imprimir** ou **Compartilhar**.

## Segunda via

Acesse **Vendas**, localize a venda e toque em **Notinha WS**. O comprovante é reconstruído com os dados atuais do registro (inclusive eventuais correções já auditadas).

O documento mostra: WS Baterias, referência da venda, data e hora reais da venda, nome e contato do cliente se informado, marca/modelo, amperagem e série quando informados, placa se registrada, preço, forma de pagamento informada, prazo de garantia registrado e observações.

**Não aparecem dados internos**: valor de repasse ao Sandro, custos de recuperação ou lucro da empresa.

## Compartilhar pelo WhatsApp

No Android ou iPhone que aceite a API de compartilhamento de arquivos, **Compartilhar** abre o menu nativo do aparelho para escolher WhatsApp, e-mail ou outro aplicativo. Se o navegador não oferecer esse recurso, o botão **baixa o PDF**, que pode ser enviado manualmente como documento pelo WhatsApp.

## Impressão e PDF

- **Baixar PDF** cria um PDF sem precisar instalar biblioteca externa.
- **Imprimir** usa o diálogo de impressão do aparelho, com layout em formato A5.
- Observações longas são incluídas em páginas complementares do PDF; nada precisa ser cortado manualmente.

## Natureza do documento e garantia

Este documento é **comprovante de venda não fiscal**. **Não é NF-e, NFC-e, DANFE, recibo bancário ou confirmação de quitação**. O campo pagamento representa o meio de pagamento registrado pelo vendedor. A emissão do documento fiscal exigido pela legislação é um processo separado e deve ser realizada pela empresa quando aplicável.

O prazo de garantia exibido é o informado no cadastro da venda, sem exclusão ou diminuição dos direitos de garantia legal previstos no Código de Defesa do Consumidor. Não são inventados CNPJ, endereço, telefone da empresa ou cláusulas de garantia que não tenham sido fornecidos.

## Proteção dos dados

O comprovante é construído com os dados reais da venda consultados pelo aplicativo após autenticação. O arquivo PDF fica no dispositivo de quem o gerou. O compartilhamento deve ser feito somente com o comprador ou outra pessoa autorizada, pois pode conter nome e telefone do cliente.

## Implementação

- `ws-receipt.js`: comprovante em HTML, criação de PDF, anexos e compartilhamento
- `ws-receipt.css`: tema azul, layout mobile e impressão
- `app.js`: emissão automática após o lançamento e segunda via em **Vendas**
- `tests/browser-smoke.mjs`: validação Chrome mobile e desktop, arquivo PDF e observações extensas

Nenhuma migração adicional no Supabase é necessária. A funcionalidade usa os dados das vendas WS já existentes.

## Atualização: nome da bateria em destaque

O cliente não vê códigos de estoque como `WS-000001`, UUIDs ou referências internas. O comprovante segue uma apresentação comercial inspirada em comprovantes de loja: cabeçalho azul WS, dados do comprador, **produto vendido com marca/modelo/amperagem destacados**, linha de itens (quantidade, valor unitário e total), pagamento, garantia e observações. O **PDF e o nome do arquivo** também identificam a bateria pelo nome, nunca pelo código interno. As telas de vendas, acertos, garantias, relatórios e histórico foram alinhadas ao mesmo padrão.

O documento permanece **não fiscal**: este design não representa NFC-e ou NF-e emitida pela SEFAZ.
