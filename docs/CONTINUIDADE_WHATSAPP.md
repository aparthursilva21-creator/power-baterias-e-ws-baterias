# Continuidade do formulário — WhatsApp e Power × WS

## Problema corrigido

Alguns celulares pausam páginas e aplicativos em segundo plano enquanto o vendedor consulta conversas no WhatsApp. Além disso, o Supabase pode emitir novamente o evento `SIGNED_IN` ao retornar o foco ao navegador, mesmo quando **a sessão Google nunca foi encerrada**.

Antes, a verificação de autenticação desmontava a tela antes de confirmar o acesso. Isso podia apagar campos não enviados. Agora, **revalidar uma sessão ativa não bloqueia a tela nem chama novamente a inicialização do painel** quando o usuário e o perfil continuam os mesmos. A sessão Google utiliza `persistSession: true` e renovação automática do token.

Não foi criado logout automático após 10 minutos: isso provocaria a perda de tempo que o Wanderson relatou. O celular pode trocar de aplicativo normalmente, mantendo a sessão enquanto ela for válida.

## Rascunho de venda protegido (30 minutos)

A partir do primeiro preenchimento no formulário **Vendas → Venda de hoje** ou **Lançar venda antiga**, a aplicação começa a salvar automaticamente os campos no banco Supabase protegido. Há um aviso no formulário mostrando o status do rascunho.

- Ao abrir o WhatsApp, a aplicação tenta salvar imediatamente os últimos campos digitados antes de ser suspensa.
- Se a página permanecer aberta, o formulário e seus dados continuam como estavam.
- Se o sistema operacional fechar a página, ao entrar novamente com a mesma conta autorizada o formulário é restaurado automaticamente com os campos anteriores.
- O limite é de **30 minutos desde a última alteração gravada**. Após esse tempo o rascunho não é restaurado e é excluído pela rotina de limpeza periódica.
- Se o usuário abrir de novo o formulário durante a mesma sessão, os campos da tentativa em andamento são reutilizados.
- **Descartar rascunho** apaga a tentativa não confirmada, mediante confirmação.
- Quando uma venda real é **salva com sucesso**, a notinha WS é aberta e o rascunho correspondente é descartado. Um identificador de solicitação é preservado entre recargas para evitar vendas duplicadas.
- Fazer **Sair** limpa a sessão do aparelho e tenta remover imediatamente os rascunhos daquela conta.

## Privacidade e segurança

A tabela `pbws_sale_drafts` tem **Row Level Security (RLS)** e exige conta Google autorizada. Só o dono pode ler, criar, alterar ou descartar seus rascunhos. Nem mesmo o perfil admin lê os rascunhos privados de outra conta pelo aplicativo. Sandro só pode criar rascunhos de **venda antiga**; Wanderson ou Arthur podem criar rascunhos de venda de hoje ou antiga.

Os rascunhos são armazenados no **Supabase**, não em `localStorage` ou `sessionStorage`, para não manter nomes de clientes e valores no armazenamento permanente do navegador. Uma anotação em andamento **não representa venda concluída, acerto financeiro nem despesa registrada**.

O processo de limpeza pelo `pg_cron` remove rascunhos vencidos periodicamente; a aplicação impede a recuperação desde o instante em que expiram, mesmo antes da limpeza física.

**Limitação:** é preciso conexão para sincronizar o rascunho remoto. Se o celular fechar abruptamente antes da primeira gravação chegar ao banco (por exemplo, sem internet), o último texto ainda não sincronizado pode não ser recuperado. A tela indica falhas de salvamento. O login Google também pode precisar ser repetido se a sessão expirar, for revogada, o navegador limpar seus dados ou o aparelho estiver em navegação privativa.

## Como o Wanderson pode testar sem criar venda fictícia

1. Abra o sistema no celular, entre na conta Google autorizada e vá em **Vendas → Venda de hoje**.
2. Digite apenas o nome de um cliente de teste e um valor, **sem apertar Salvar venda**.
3. Confirme que aparece **Rascunho salvo**.
4. Abra o WhatsApp e consulte a conversa; volte ao sistema.
5. O formulário deve continuar preenchido. Para testar recarga, feche a aba e abra o site novamente **em menos de 30 minutos**; o sistema deve restaurar o rascunho.
6. Finalize clicando em **Descartar rascunho**. Nenhuma venda nem acerto terá sido criado.

## Arquivos

- `auth.js`: não bloqueia a interface a cada `SIGNED_IN` no retorno ao primeiro plano.
- `sale-drafts.js`: filas de gravação/exclusão e recuperação com expiração.
- `sale-drafts.css`: status do rascunho e ação de descarte.
- `app.js`: salvamento no formulário, retorno do segundo plano e restauração após reinício.
- `supabase/016_sale_drafts.sql`: tabela isolada com RLS, permissões e TTL.
- `supabase/017_draft_expiry_cleanup.sql`: limpeza periódica de rascunhos vencidos.
- `tests/sale-drafts-integration.sql`, `tests/draft-store.test.mjs`, `tests/browser-smoke.mjs`: testes de segurança e continuidade.
