# Autenticação Google — Power × WS

## Etapa de preparação (obrigatória)

O login já está implementado no site, mas **fica bloqueado até a configuração de um projeto Supabase independente** e da lista de três usuários. Nunca reutilize o Supabase da loja Power Baterias: isso é outro sistema.

1. Crie um projeto Supabase novo. Em **Project Settings > API**, copie a **Project URL** e a chave **publishable** (ou anon, se aplicável). Elas são públicas, mas **NUNCA** use a service_role/secret no frontend.
2. Edite `config.js` neste repositório com apenas a URL e a publishable key do projeto novo.
3. No Supabase, acesse **Authentication > Providers > Google** e habilite o provedor, usando credenciais OAuth de um projeto no Google Cloud Console.
4. No Google Cloud, configure o URI de redirecionamento **exatamente** como o Supabase informa no painel do provedor (normalmente `https://SEU-PROJETO.supabase.co/auth/v1/callback`).
5. Em **Authentication > URL Configuration**, defina o Site URL para `https://aparthursilva21-creator.github.io/power-baterias-e-ws-baterias/` e adicione esse mesmo endereço em **Redirect URLs**.
6. Abra **SQL Editor** e execute o arquivo `supabase/setup-auth.sql`.
7. No SQL Editor, insira os três e-mails reais autorizados, com roles `admin`, `power`, `ws`, conforme exemplo comentado no SQL. **Não adicione os e-mails pessoais em arquivos públicos do GitHub.**
8. Publique com GitHub Pages em `main` / `/(root)` e teste com um e-mail autorizado e outro não autorizado.

## Como funciona a segurança

- Google confirma a identidade via Supabase Auth.
- A função SQL `is_authorized_user()` verifica na base o usuário autenticado, o vínculo com Google e a presença na lista autorizada.
- O frontend só mostra a tela interna depois de obter `true` da função SQL.
- Usuários não autorizados têm sessão encerrada e recebem mensagem de acesso negado.
- As próximas tabelas de baterias, vendas e repasses **ainda precisarão de RLS e políticas específicas**. Os dados atuais são demonstrativos e vivem no armazenamento local do browser.
- **Não usar dados reais de clientes enquanto o banco com RLS, backup, auditoria e os fluxos operacionais não estiver pronto.**

## Como revogar alguém

No SQL Editor, execute:
```sql
update public.authorized_users set active = false where email = 'email@example.com';
```
A revogação bloqueia novas verificações de acesso. Para proteção de dados reais, as futuras políticas RLS devem consultar a função em todas as consultas e alterações.

## Papel dos usuários

- `admin`: Arthur — administrador do sistema;
- `power`: pai — controle financeiro e repasses;
- `ws`: irmão — operação de baterias usadas.

Os papéis serão aplicados às operações do banco na próxima etapa.
