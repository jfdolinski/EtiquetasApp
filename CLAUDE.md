# Sistema de Etiquetas SaaS

SaaS multiempresa que lê dados de produtos dos bancos dos ERPs dos clientes (via agente local em Go) e gera/imprime etiquetas (ZPL, PPLA/PPLB, ESC/POS, PDF).

**Especificação completa:** [docs/SPEC.md](docs/SPEC.md) — leia antes de iniciar qualquer fase.

## Stack

- Monorepo pnpm: `apps/api` (NestJS + Prisma + PostgreSQL), `apps/web` (React + Vite + Tailwind + Konva), `apps/agent` (Go), `packages/shared` (tipos/contratos compartilhados)
- Redis + BullMQ para filas e jobs agendados
- Deploy: Easypanel em VPS Hostinger (containers api, web, postgres, redis)

## Convenções

- Código e nomes de domínio em português, conforme as entidades da SPEC (Empresa, Usuario, ModeloEtiqueta…)
- Toda consulta ao banco próprio filtra por `empresa_id` (isolamento de tenant) — sem exceções fora do super-admin
- SQL do cliente: placeholders `{...}` substituídos por parâmetros ligados, nunca concatenação
- Credenciais de bancos dos clientes sempre criptografadas em repouso
- Uma fase por vez, com testes e commit ao fim de cada uma

### Padrões da API

- **Tenant:** rotas de dados da empresa recebem `@EmpresaAtual() empresaId` e passam para o serviço, que filtra todo `where` por ele. Nunca aceite `empresaId` do corpo/query. Usuário comum = própria empresa; super-admin = cabeçalho `X-Empresa-Id`.
- **Permissões:** guards globais (`AuthGuard` → `PermissoesGuard`). Use `@RequerPermissao('codigo')`, `@ApenasSuperAdmin()` ou `@Publico()`. Códigos novos vão em `packages/shared/src/permissoes.ts`; a API sincroniza a tabela `permissoes` ao iniciar.
- **Sessão:** o `AuthGuard` recarrega o usuário do banco a cada requisição (desativação, bloqueio e permissões valem na hora). O JWT só carrega `sub`.
- **Auditoria:** mutações chamam `AuditoriaService.registrar` (dentro da transação quando houver).
- **Banco:** nomes em português no Prisma com `@map` para snake_case. Migrações em `apps/api/prisma/migrations`.

## Comandos

Requisitos: Node 22+ e pnpm via corepack (`corepack pnpm …`, ou `corepack enable` como administrador para ter `pnpm` direto). O projeto precisa ficar em um caminho curto: caminhos acima de ~260 caracteres quebram o `esbuild` no Windows.

```bash
corepack pnpm install
corepack pnpm test                    # vitest (shared) + jest (api)
corepack pnpm typecheck
corepack pnpm build                   # shared → api → web
corepack pnpm dev:api                 # API em :3000 (lê apps/api/.env)
corepack pnpm dev:web                 # Vite em :5173, proxy de /api para :3000
corepack pnpm --filter @etiquetas/api prisma:migrate   # nova migração (precisa de Postgres)
```

Postgres e Redis locais: `docker compose up -d` (arquivo na raiz). Copie `apps/api/.env.example` para `apps/api/.env`.
Deploy: [docs/DEPLOY.md](docs/DEPLOY.md).

## Estado das fases

- [x] Fase 1 – Base: monorepo, autenticação, empresas, usuários, permissões, deploy
  - Feito: login JWT com rate limit, super-admin inicial via env, CRUD de empresas (super-admin), usuários e perfis com permissões granulares, aviso de carência/bloqueio no login, auditoria, frontend (login, empresas, usuários, perfis, minha conta), Dockerfiles api/web e guia do Easypanel.
  - Testado: 35 testes unitários + roteiro ponta a ponta contra Postgres real (27 cenários, incl. isolamento entre empresas). Builds Docker **não** testados (sem Docker na máquina de desenvolvimento).
  - Pendente: mensagens de validação padrão do class-validator ainda em inglês em alguns campos; sem refresh token (sessão expira em `JWT_EXPIRACAO`).
- [ ] Fase 2 – Agente: registro por CNPJ, WebSocket, consultas nos três bancos
- [ ] Fase 3 – SQL e campos dinâmicos
- [ ] Fase 4 – Editor de etiquetas e geração ZPL/PPLA/ESC-POS/PDF
- [ ] Fase 5 – Lista do dia e impressão em lote
- [ ] Fase 6 – Cadastro de ERPs e templates
- [ ] Fase 7 – Assinatura, carência e bloqueio
- [ ] Fase 8 – Cópia de modelos, auditoria e refinamentos
