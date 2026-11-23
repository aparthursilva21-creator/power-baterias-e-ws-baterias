# Notificações Power × WS — Manual de uso

## O que já foi instalado

- Central de avisos com **sininho** dentro do sistema: avisos ficam no PostgreSQL, com data/hora e leitura individual por conta.
- **Web Push real** com Service Worker e chaves VAPID privadas guardadas no Supabase Vault.
- Supabase Edge Function `pbws-push`, que verifica um token de envio secreto antes de processar a fila.
- Fila de entrega por celular com até cinco tentativas; repetição automática a cada cinco minutos quando necessário.
- Notificações de venda ao perfil **Power** (Sandro) e ao administrador Arthur.
- Notificações de acerto individual, dispensa, correção e acerto em lote à **WS** (Wanderson) e ao administrador.
- Ao acertar dez baterias juntas, **uma** notificação para o lote, evitando excesso de mensagens.
- Botão **Cobrar WS** na área Acertos, visível apenas a Sandro e ao administrador. Com baterias selecionadas, cobra apenas as selecionadas; sem seleção, cobra todos os acertos pendentes. Limite de um lembrete a cada 45 minutos por remetente.
- Resumo automático **às 09h de Brasília**, somente quando existirem acertos pendentes. Sandro e Wanderson recebem sua versão do aviso.
- As notificações não incluem nomes ou telefones de clientes nas telas bloqueadas.

## Como ativar no Android de Sandro

1. Abrir o site no Chrome e fazer login com a conta Google autorizada.
2. Abrir o menu ⋮ do Chrome e escolher **Instalar aplicativo** ou **Adicionar à tela inicial**, quando aparecer.
3. Abrir o sistema e tocar no **sininho**.
4. Tocar em **Ativar notificações** e escolher **Permitir** quando o Android perguntar.
5. Verificar se o texto mudou para “Notificações no celular ativadas”.

## Como ativar no iPhone de Wanderson

1. Usar iOS **16.4 ou superior**.
2. Abrir o endereço no **Safari**.
3. Menu **Compartilhar → Adicionar à Tela de Início → Adicionar**.
4. Fechar o Safari e **abrir o sistema pelo ícone da Tela de Início**.
5. Fazer login com o Google e tocar no sininho → **Ativar notificações**.
6. Escolher **Permitir** quando o iOS perguntar. Ajustes → Notificações também podem bloquear/silenciar avisos.

No iPhone, a permissão de Push **não deve ser solicitada na aba normal do Safari**. Ela só funciona no web app instalado, após um toque real do usuário.

## Teste recomendado com contas reais (sem informações reais de clientes)

1. Sandro e Wanderson fazem login **ao menos uma vez**. Antes do primeiro login de cada conta, não existe destinatário registrado em `auth.users` para entrega.
2. Os dois ativam avisos nos respectivos aparelhos.
3. Wanderson lança uma venda de teste com cliente fictício. Sandro deve receber alerta **Nova venda registrada**.
4. Sandro entra em Acertos, seleciona uma pendência, clica em **Cobrar WS**. Wanderson deve receber o lembrete.
5. Sandro marca o acerto como recebido. Wanderson deve ver **Atualização de acerto**.
6. Testar com navegador fechado, tela bloqueada e também com o aplicativo aberto.
7. Confirme o recebimento pelo celular, não só pela aparição no banco.

## Segurança e limites

- O sininho respeita a conta logada: uma conta não consulta mensagens de outra via RLS.
- Cadastro de dispositivos exige uma conta Google da parceria ativa.
- Funções administrativas e credenciais privadas só são acessíveis via service_role, nunca no JavaScript do navegador.
- O endpoint de envio valida provedores Web Push permitidos para evitar requisições a servidores arbitrários.
- O sistema funciona com internet. Navegador, modo Não Perturbe, economia de bateria ou permissões do sistema operacional podem atrasar ou silenciar avisos.
- A fila mantém o histórico de entrega mesmo que o Push falhe, mas notificações Web Push não garantem entrega instantânea em todas as situações.

## Arquivos relacionados

- `supabase/007_notifications.sql`: notificações, políticas, triggers e lembrete manual
- `supabase/008_push_dispatch.sql`: chamada segura da Edge Function e reenvio via cron
- `supabase/009_daily_pending_digest.sql`: lembretes automáticos às 9h
- `supabase/functions/pbws-push/index.ts`: entrega VAPID Web Push
- `sw.js`: recebe avisos e abre Acertos, Vendas ou Relatórios
- `notifications.js`, `notifications.css`: sininho e controles no site

**Não execute as migrações novamente no Supabase pbEws**: elas já foram aplicadas no projeto em uso.
