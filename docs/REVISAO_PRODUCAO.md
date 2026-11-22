# Revisão de qualidade — Power × WS

## Bloqueadores para uso real

- [ ] Configurar **Client Secret** do Google em Supabase Authentication > Providers > Google, sem publicá-lo.
- [ ] Testar login Google com Arthur, Sandro e Wanderson em dispositivos reais.
- [ ] Testar e-mail não autorizado e revogação da autorização.
- [ ] Substituir o armazenamento `localStorage` demonstrativo por tabelas de produção no Supabase.
- [ ] Criar RLS em **todas** as tabelas de estoque, repasses, vendas, clientes e garantias.
- [ ] Implementar permissões efetivas por perfil (admin / power / ws) no banco — não apenas na interface.
- [ ] Criar operações transacionais para venda, baixa de estoque e repasses (evitar duplicação).
- [ ] Implementar trilha de auditoria e correção/estorno com registro de autoria.
- [ ] Validar dados monetários e regras de negócio no servidor, inclusive concorrência.
- [ ] Garantir backups e rotina de recuperação e exportação.
- [ ] Revisar privacidade e retenção de dados de clientes.
- [ ] Conferir a UX em Android Chrome e iPhone Safari, com teclados, modais, orientação e rede instável.

## O que já existe

- Tela responsiva com login via Supabase Auth + Google;
- Lista de e-mails autorizados via função no banco `is_authorized_user()`;
- Dashboard e módulos com **dados locais de demonstração**, sem sincronização;
- Manifest PWA e acesso via navegador com instalação/adição à tela inicial conforme compatibilidade do aparelho;
- Testes de estrutura e verificação de sintaxe automatizados no GitHub Actions.

## Observações importantes

O erro `Unsupported provider: missing OAuth secret` é configuração ausente no **Supabase**. Não é corrigido por alterações no `auth.js` e não exige enviar o Client Secret a terceiros.

**Não usar informações reais de clientes nem registrar vendas da loja na versão demonstrativa.**
