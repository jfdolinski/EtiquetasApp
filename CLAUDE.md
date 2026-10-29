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
- **Etiquetas:** `LayoutEtiqueta` (mm) em `packages/shared/src/etiquetas` é a fonte única: o editor (Konva) desenha, `validarLayout` valida na API e os geradores traduzem. `posicionar()` distribui etiquetas em páginas (fileira no rolo, folha) e resolve textos; cada gerador (`zpl.ts`, `ppla.ts`, `pplb.ts`, `escpos.ts`) só traduz elementos posicionados. PDF fica na API (`src/modelos/pdf.ts`, pdf-lib + bwip-js). Recurso não suportado numa linguagem vira item em `avisos`, nunca saída quebrada. Gerar: `gerarSaida(layout, registros, linguagem, dpi, hoje)`.
- **Impressão:** `TrabalhosService.criar` gera o conteúdo (via `gerarSaida`) e grava `trabalhos_impressao`; essa tabela é a fila (durável, sem Redis). `DespachoService` envia ao agente um trabalho por vez por agente: ao criar, quando o agente conecta (`gateway.quandoConectar`) e numa varredura a cada 30 s. Reivindica com `updateMany status PENDENTE→ENVIANDO`. Queda antes do envio volta para a fila; queda depois de enviado, ou sem confirmação, vira ERRO para o operador conferir (nunca reimprime sozinho). PDF não passa pelo agente: fica CONCLUIDO e é aberto no navegador.
- **Lista do dia:** modelos com `naListaDiaria` e consulta; colunas convencionais `codigo/ean` (chave), `descricao/nome`, `quantidade/qtd` (`packages/shared/src/impressao.ts`). Atualizar a lista não traz de volta itens impressos, na fila ou descartados no dia.
- **ERPs e templates:** `SistemaErp` e `TemplateConsulta` são dados da plataforma (sem `empresa_id`, só super-admin, `src/erps`). A empresa aponta para um ERP (`empresas.sistema_erp_id`) e copia as consultas com `ErpEmpresaService.copiar` → `ConsultasService.criar(..., origemTemplate)`. A cópia guarda `template_consulta_id` e `template_sql_hash` (SHA-256 do SQL do template na cópia); `situacaoCopia` compara hashes para mostrar "ajustada"/"template atualizado". Mudar o template nunca altera cópias; a empresa decide restaurar.
- **Cobrança:** regras puras em `packages/shared/src/cobranca.ts` (`avaliarAssinatura`: aviso prévio → carência → pré-bloqueio → bloqueio; `renderizarMensagem`). `AvaliacaoCobrancaService` roda a avaliação diária em processo (conferida a cada 10 min, após `horaAvaliacao`, uma AGENDADA por dia em `execucoes_avaliacao`) com `pg_try_advisory_xact_lock` — trava de sessão não serve com o pool do Prisma. Salvar assinatura, pagamento, estorno ou prazos chama `avaliarEmpresa` na hora. Mensagens de bloqueio/carência para login, guard e ativação do agente vêm de `MensagensCobrancaService` (módulo global); as constantes de `acesso-empresa.ts` só valem para status definido à mão.
- **Sem Redis:** fila de impressão e job diário usam o Postgres. Redis/BullMQ da SPEC não foi adotado (decisão da Fase 5, mantida na 7).
- **Permissão nova:** basta adicioná-la em `packages/shared/src/permissoes.ts`; na próxima subida ela entra no catálogo e é concedida aos perfis "Administrador" existentes (não aos personalizados).
- **Validação:** `criarValidationPipe()` traduz as mensagens padrão do class-validator; mensagens personalizadas nos DTOs (em português) ficam como estão.
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
  - Pendente: sem refresh token (sessão expira em `JWT_EXPIRACAO`). (Mensagens de validação em inglês: resolvido na Fase 8.)
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
    - (Resolvido na Fase 8: com o token recusado, o serviço espera 5 min e tenta de novo, em vez de reiniciar em loop.)
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
- [x] Fase 4 – Editor de etiquetas e geração ZPL/PPLA/ESC-POS/PDF
  - Feito:
    - `ModeloEtiqueta` (layout JSON validado, consulta vinculada) e `Impressora` (linguagem, DPI, rede IP:porta ou impressora do sistema, agente).
    - Layout: tamanho, colunas, margens, espaçamentos, rolo ou folha (A4/Carta/outra); elementos texto, código de barras (EAN-13, EAN-8, Code 128, Code 39), QR code, retângulo e linha, com rotação 0/90/180/270.
    - Conteúdo: texto fixo, campo da consulta (formato texto/número/moeda/data), data de hoje + N dias, contador.
    - Geradores ZPL, PPLA, PPLB, ESC/POS (modo página) e PDF; EAN com dígito verificador conferido.
    - Editor Konva: arrastar, redimensionar, setas/Delete, zoom, campos da consulta com um clique, dados reais da consulta via agente, pré-visualização da saída (PDF embutido, texto, download).
    - Telas Modelos de etiqueta e Impressoras; editor carregado sob demanda.
  - Testado: 14 testes dos geradores/valores/layout no shared, 7 na API (incl. PDF real), roteiro ponta a ponta com 24 cenários (geração nas 5 linguagens com dados reais via agente, impressora definindo DPI, isolamento, permissões, registros inválidos), editor conferido no navegador e PDF inspecionado (texto girado, contador, acentos).
  - **Não** validado em impressoras reais. ZPL e PDF seguem padrões bem conhecidos; PPLA (sintaxe DPL), QR em PPLB e ESC/POS em modo página precisam de teste em equipamento antes do primeiro cliente — a saída PPLA traz esse aviso.
  - Limitações: PPLA/PPLB removem acentos e não quebram linha; ESC/POS não gira nem imprime linhas/retângulos; QR em PPLA não gerado. Chunk do editor ~1,2 MB (bwip-js).
- [x] Fase 5 – Lista do dia e impressão em lote
  - Feito:
    - `ListaDiaria`, `ItemLista` e `TrabalhoImpressao`; modelo ganha impressora padrão e "incluir na lista do dia".
    - Lista do dia: executa as consultas via agente, agrupa por impressora → modelo; operador desmarca, ajusta quantidade, descarta; impressão em lote com um clique (um trabalho por modelo/impressora).
    - Etiqueta avulsa: modelos com consulta de busca, busca ao vivo com `{param.*}`, impressão na impressora padrão ou escolhida.
    - Fila de trabalhos no Postgres com despacho ao agente, acompanhamento na tela, reenviar/cancelar, histórico com origem e autor, download do conteúdo, auditoria.
    - Agente: mensagem `imprimir` com envio RAW por rede (TCP) ou impressora do sistema (winspool RAW no Windows, `lp -o raw` no Linux).
  - Testado:
    - 3 testes no shared, 13 na API (despacho e lista; 87 no total), testes do agente com impressora TCP simulada e chamada real ao winspool.
    - Roteiro ponta a ponta com 30 cenários: lote com quantidades, modelo sem impressora, impressora desligada → erro → reenviar, agente offline → imprime ao voltar, cancelamento, PDF, avulsa, isolamento e permissões.
    - Telas Lista do dia, Histórico e Avulsa conferidas no navegador.
  - **Não** testado com impressora física nem com impressora instalada no Windows (só o caminho de erro do winspool).
  - Desvio da SPEC: fila de impressão no Postgres em vez de Redis/BullMQ (durável e suficiente com uma réplica da API). Redis fica para os jobs agendados da Fase 7, se fizer sentido lá.
  - Limitações: PDF é impresso pelo navegador (o agente não renderiza PDF); lista do dia é gerada pelo operador (sem agendamento automático). (Contador entre lotes: resolvido na Fase 8.)
- [x] Fase 6 – Cadastro de ERPs e templates
  - Feito:
    - Cadastro de Sistemas ERP (nome, fabricante, tipo de banco) com template: consultas padrão (finalidade, SQL com placeholders validado no dialeto do ERP) e mapeamento de campos (coluna esperada ← origem no ERP).
    - Vínculo empresa → ERP no cadastro da empresa; painel do template em Consultas SQL: copiar tudo ou uma consulta para a conexão compatível, situação de cada cópia (igual, ajustada, template atualizado, ambos), campos do mapeamento que a cópia não devolve mais, restaurar/atualizar a partir do template.
    - Regras: copiar de novo não duplica (nome em conflito ganha sufixo); conexão de outro tipo de banco é recusada; trocar o tipo de banco do ERP revalida o template; ERP com empresas vinculadas não pode ser excluído; excluir consulta do template ou desvincular mantém as cópias.
  - Testado: 1 teste no shared, 9 na API (96 no total); roteiro ponta a ponta com 27 cenários (template, vínculo, cópia com leitura de campos via agente, ajuste, atualização do template, restauração, tipo de banco errado, isolamento, permissões, exclusões); telas conferidas no navegador.
  - Fora do escopo: modelos de etiqueta no template do ERP (a SPEC fala em consultas e mapeamento; a cópia de modelos entre empresas é da Fase 8).
- [x] Fase 7 – Assinatura, carência e bloqueio
  - Feito:
    - `Assinatura` (mensalidade fixa, dia de vencimento, vencimento em aberto, controle manual), `PagamentoAssinatura` (quita N meses; estorno do último), `ParametroCobranca` global + sobrescrita de prazos por empresa, `AvisoCobranca`, `ExecucaoAvaliacao`.
    - Parâmetros: dias de aviso prévio, carência, dias até o bloqueio, frequência dos avisos, hora da avaliação e quatro mensagens com variáveis.
    - Job diário: ajusta o status (ATIVA/CARENCIA/BLOQUEADA), audita a mudança e emite avisos na frequência configurada; avaliação manual; pagamento libera na hora.
    - Mensagem de bloqueio configurada no login, no guard (token já emitido) e na ativação do agente; banner de aviso para os usuários; página Assinatura da empresa; tela Cobrança do super-admin.
  - Testado: 6 testes no shared, 5 na API (101 no total); roteiro ponta a ponta com 26 cenários (execução agendada, carência, pré-bloqueio, bloqueio com mensagem configurada, pagamento/estorno, prazos por empresa, controle manual, trava contra execução simultânea, permissões); telas conferidas no navegador.
  - Fora do escopo: envio de e-mail/WhatsApp dos avisos (hoje só no sistema) e integração com gateway de pagamento (pagamento registrado à mão).
  - Pendente: os builds Docker continuam sem teste; o serviço Redis do guia de deploy pode ser omitido.
- [x] Fase 8 – Cópia de modelos, auditoria e refinamentos
  - Feito:
    - Modelos: exportar/importar arquivo `.etiqueta.json` (qualquer empresa com `etiqueta.modelo.editar`) e cópia direta para outras empresas pelo super-admin. A consulta é vinculada à equivalente no destino (mesmo template do ERP, senão mesmo nome); impressora e lista do dia não vão; nome em conflito ganha sufixo; avisos de consulta/campos ausentes.
    - Auditoria: tela com filtros (tipo de ação, usuário, período) e paginação por cursor; permissão nova `auditoria.ver`; super-admin vê a plataforma toda (inclui ações sem empresa) com filtro por empresa.
    - Permissões novas do catálogo passam a ser concedidas aos perfis "Administrador" existentes na inicialização (só os códigos recém-criados).
    - Mensagens padrão do class-validator traduzidas (`src/validacao.ts`); corpo JSON até 5 MB; contador contínuo entre lotes de impressão; agente como serviço não reinicia em loop com token recusado.
  - Testado: 11 testes novos na API (112 no total); roteiro ponta a ponta com 25 cenários (permissão concedida a admin antigo, auditoria com isolamento/filtros/cursor, exportar/importar/copiar com vínculo de consulta, validação em português, lote de ~500 KB); telas conferidas no navegador. A espera de 5 min do agente como serviço foi só compilada/revisada, não exercitada.
