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
- **Agente:** `AgentesGateway` (ws puro no upgrade de `/api/agente/conectar`) guarda as sessões em memória → API com **uma réplica**. Para falar com o agente: `gateway.sessao(agenteId).requisitar(tipo, dados, timeout)`; mudou conexão de banco → `gateway.enviarConfiguracao(agenteId)`. Mensagem nova do protocolo: atualizar `protocolo.ts`, `apps/agent/internal/protocolo` e `apps/agent/PROTOCOLO.md` juntos.
- **Consultas SQL:** placeholders `{...}` são compilados por `compilarSql` (`packages/shared/src/placeholders.ts`, lexer por dialeto, igual ao validador do agente) em `$n` / `?` / `@pn` + lista de parâmetros. Valores dos placeholders fixos vêm sempre do banco próprio (`ConsultasService.compilar`); o cliente só informa `{param.*}`. Executar SQL num banco do cliente: `ConexoesService.executar(empresaId, conexaoId, sqlCompilado, parametros, limite)`; consulta salva: `ConsultasService.executar(...)`. Placeholder novo: catálogo `PLACEHOLDERS` + valor em `ConsultasService.compilar`.
- **Campos dinâmicos:** colunas lidas ao salvar a consulta (execução com 1 linha e `{param.*}` nulos), gravadas em `consultas_sql.campos` com `campos_hash` = SHA-256(conexão + SQL); hash diferente = campos desatualizados.
- **Segredos:** senhas de banco com `cifrar/decifrar` (`src/cripto.ts`, AES-256-GCM, `CHAVE_CRIPTOGRAFIA`), nunca devolvidas ao navegador. Tokens e códigos de ativação só como SHA-256.

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

cd apps/agent && go test ./... && go vet ./...          # agente (Go 1.27+; no Windows: C:\Program Files\Go\bin)
AGENTE_TESTE_PG=host:porta:usuario:senha:banco go test ./internal/banco   # integração com PostgreSQL real
```

Postgres e Redis locais: `docker compose up -d` (arquivo na raiz). Copie `apps/api/.env.example` para `apps/api/.env`.
Deploy: [docs/DEPLOY.md](docs/DEPLOY.md).

## Estado das fases

- [x] Fase 1 – Base: monorepo, autenticação, empresas, usuários, permissões, deploy
  - Feito: login JWT com rate limit, super-admin inicial via env, CRUD de empresas (super-admin), usuários e perfis com permissões granulares, aviso de carência/bloqueio no login, auditoria, frontend (login, empresas, usuários, perfis, minha conta), Dockerfiles api/web e guia do Easypanel.
  - Testado: 35 testes unitários + roteiro ponta a ponta contra Postgres real (27 cenários, incl. isolamento entre empresas). Builds Docker **não** testados (sem Docker na máquina de desenvolvimento).
  - Pendente: mensagens de validação padrão do class-validator ainda em inglês em alguns campos; sem refresh token (sessão expira em `JWT_EXPIRACAO`).
- [x] Fase 2 – Agente: registro por CNPJ, WebSocket, consultas nos três bancos
  - Feito:
    - Ativação: CNPJ + código de ativação de uso único (24 h) gerado no painel.
    - Token: só o hash fica no banco. Rotação online sem mexer na máquina; "Reinstalar" revoga o token.
    - WebSocket de saída com heartbeat. Desativar o agente o derruba na hora; bloquear a empresa, em até 30 s.
    - Conexões de banco com senha cifrada (AES-256-GCM), empurradas ao agente e mantidas só em memória.
    - Consultas somente leitura em PostgreSQL, MySQL e SQL Server:
      - validação léxica por dialeto;
      - transação sempre desfeita, `READ ONLY` no PG e no MySQL;
      - limite de linhas e de tempo.
    - Agente Go roda como serviço Windows/systemd (`kardianos/service`).
    - Telas Agentes e Bancos de dados, com teste de conexão e console SQL.
    - Permissões `agente.ver` e `agente.editar`. A consulta ad hoc exige `sql.editar`.
  - Testado:
    - API: 58 testes. Agente: testes de unidade, incluindo 29 casos do validador somente leitura com tentativas de burla por diferença de lexer.
    - Integração do executor contra PostgreSQL real.
    - Roteiro ponta a ponta com API, agente compilado e Postgres reais (33 cenários: ativação, isolamento entre empresas, permissões, rotação, revogação, desativação, bloqueio, offline → 503).
    - Telas conferidas no navegador.
  - **Não** testado contra MySQL e SQL Server reais. Só DSN, conversão de valores e validador têm testes; rodar contra bancos reais antes do primeiro cliente com esses ERPs.
  - Pendente:
    - Atualização automática do agente e instalador `.msi`.
    - API com uma réplica só (sessões em memória).
    - Desativar agente com o serviço instalado faz o serviço reiniciar em loop até ser reativado.
- [x] Fase 3 – SQL e campos dinâmicos
  - Feito:
    - Entidade `ConsultaSql` (conexão, finalidade: lista do dia / busca de produto / outra, SQL com placeholders).
    - Placeholders fixos `{empresa.cnpj}`, `{empresa.codigo_erp}`, `{empresa.razao_social}`, `{usuario.id}`, `{usuario.email}`, `{data_hoje}`, `{data_hora_agora}` (fuso `FUSO_HORARIO`), e `{param.nome}` informados na execução.
    - Sempre parâmetros ligados; recusa placeholder entre aspas, placeholder desconhecido e `$1`/`?`/`@p1` escritos à mão.
    - Prévia de SQL não salvo, com o SQL enviado ao banco e os parâmetros.
    - Campos dinâmicos lidos ao salvar, com categoria (texto, número, data, data e hora, sim/não, binário), aviso de colunas sem nome ou repetidas e marcação de desatualizados; agente offline não impede salvar.
    - Tela Consultas SQL e editor com inserção de placeholders, valores de teste e painel de campos.
    - `GET /consultas/conexoes` para quem tem `sql.ver` sem `agente.ver`; conexão usada por consultas não pode ser excluída.
  - Testado: 13 testes do compilador de placeholders (incl. escapes por dialeto), 9 do serviço (67 na API), roteiro ponta a ponta com API, agente e "ERP" PostgreSQL reais (24 cenários: filtro por empresa/data, injeção via parâmetro, aspas no valor, colunas adicionadas/removidas, agente offline, isolamento, permissões), editor conferido no navegador.
  - Pendente: SQL Server e MySQL seguem sem teste em banco real; o editor é um textarea (sem realce de sintaxe).
- [ ] Fase 4 – Editor de etiquetas e geração ZPL/PPLA/ESC-POS/PDF
- [ ] Fase 5 – Lista do dia e impressão em lote
- [ ] Fase 6 – Cadastro de ERPs e templates
- [ ] Fase 7 – Assinatura, carência e bloqueio
- [ ] Fase 8 – Cópia de modelos, auditoria e refinamentos
