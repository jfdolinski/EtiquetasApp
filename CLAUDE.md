# Sistema de Etiquetas SaaS

SaaS multiempresa que lê dados de produtos dos bancos dos ERPs dos clientes (via agente local em Go) e gera/imprime etiquetas (ZPL, PPLA/PPLB, ESC/POS, PDF).

**Especificação completa:** [docs/SPEC.md](docs/SPEC.md) — leia antes de iniciar qualquer fase.

## Stack

- Monorepo pnpm: `apps/api` (NestJS + Prisma + PostgreSQL), `apps/web` (React + Vite + Tailwind + Konva), `apps/agent` (Go), `packages/shared` (tipos/contratos compartilhados), `apps/e2e` (Playwright)
- `apps/mobile`: aplicativo React Native/Expo, **fora do workspace pnpm** (usa `npm`). Ver [apps/mobile/README.md](apps/mobile/README.md)
- Filas e jobs agendados no próprio Postgres (sem Redis/BullMQ; ver "Sem Redis" abaixo)
- Deploy: Easypanel em VPS Hostinger (containers postgres, api, web); o web também serve os binários do agente em `/downloads/`. CI em `.github/workflows/ci.yml` testa tudo e sobe as imagens Docker. Passo a passo: [docs/DEPLOY.md](docs/DEPLOY.md)

## Convenções

- Código e nomes de domínio em português, conforme as entidades da SPEC (Empresa, Usuario, ModeloEtiqueta…)
- Toda consulta ao banco próprio filtra por `empresa_id` (isolamento de tenant) — sem exceções fora do super-admin
- SQL do cliente: placeholders `{...}` substituídos por parâmetros ligados, nunca concatenação
- Credenciais de bancos dos clientes sempre criptografadas em repouso
- Uma fase por vez, com testes e commit ao fim de cada uma

### Padrões da API

- **Tenant:** rotas de dados da empresa recebem `@EmpresaAtual() empresaId` e passam para o serviço, que filtra todo `where` por ele. Nunca aceite `empresaId` do corpo/query. Usuário comum = própria empresa; super-admin = cabeçalho `X-Empresa-Id`.
- **Permissões:** guards globais (`AuthGuard` → `PermissoesGuard`). Use `@RequerPermissao('codigo')`, `@ApenasSuperAdmin()` ou `@Publico()`. Códigos novos vão em `packages/shared/src/permissoes.ts`; a API sincroniza a tabela `permissoes` ao iniciar.
- **Sessão:** o `AuthGuard` recarrega o usuário do banco a cada requisição (desativação, bloqueio e permissões valem na hora). O JWT carrega `sub` e `sid` (`sessoes_usuario`): encerrar a sessão derruba o token na hora; token antigo sem `sid` vale até expirar.
- **Cadastre-se:** `POST /cadastros` (público, `CadastroService`, resposta igual em todos os casos, para não revelar quem é cliente). Pendente = `usuarios.cadastro_pendente` + `ativo: false`, então login, guard e avisos já o excluem. Empresa ativa: aprova quem tem `usuario.editar`, escolhendo o perfil, em Usuários. CNPJ novo: empresa nasce `aprovacao_pendente` + `ativa: false` com os dados de `ConsultaCnpjService` (fora do ar ou não encontrado não impede) e o super-admin aprova em Empresas; o primeiro pedido vira administrador. Empresa existente desativada ou bloqueada **fica como está**: um anônimo não muda a situação de um cliente. Recusar apaga o pedido.
- **Conta:** `ContaService` (`src/auth`): duas etapas (TOTP em `totp.ts`, segredo cifrado, códigos de recuperação em hash, 5 erros bloqueiam 5 min; opcional, sem obrigar ninguém), sessões, senha esquecida (token em hash, 1 h, link com `#token=`). Trocar a senha encerra as outras sessões; redefinir encerra todas e desvincula os celulares.
- **E-mail:** `EmailService` (global, `src/email`). Sem `SMTP_HOST` nada é enviado e o login não mostra "Esqueci minha senha" (também exige `URL_PUBLICA`). Quem chama nunca depende do envio.
- **Aplicativo de celular:** token `app_...` em `dispositivos_moveis` (só hash), criado por `POST /app/vincular` a partir de um código de uso único de 5 min (`POST /app/vinculos`, QR em Minha conta). **Token de celular só entra em rota com `@PermitidoNoApp()`**: rota nova para o app precisa da marca. Aprovar = `POST /app/lista/aprovar` (exige `imprimir` + `app.aprovar`), que manda imprimir na impressora do modelo e deixa PDF de fora (geraria o arquivo e marcaria como impresso). Push: `FcmService` (FCM v1, `FCM_CONTA_SERVICO`); o Firebase é o único jeito de acordar um app fechado; sem ele, o app avisa só aberto (consulta a cada minuto).
- **Saúde e faxina (`src/sistema`):** `FiltroErros` grava os 500 em `erros_sistema` (sem corpo nem query); tela Saúde do super-admin em `/sistema/saude`; `ManutencaoService` apaga por dia os bytes de trabalhos terminados (`RETENCAO_CONTEUDO_DIAS`, 90; o histórico fica, `conteudo_apagado_em`), auditoria (`RETENCAO_AUDITORIA_DIAS`, 730), listas com mais de 180 dias e vencidos. O vigia de servidor fora do ar é externo: `.github/workflows/monitor.yml`.
- **CSP:** no `nginx.conf.template`, repetida em `location = /index.html`. O `vite preview` lê a mesma linha, e os testes e2e rodam o build de produção com ela: script ou recurso barrado aparece como erro de console.
- **Auditoria:** mutações chamam `AuditoriaService.registrar` (dentro da transação quando houver).
- **Banco:** nomes em português no Prisma com `@map` para snake_case. Migrações em `apps/api/prisma/migrations`.
- **Agente:** `AgentesGateway` (ws puro no upgrade de `/api/agente/conectar`) guarda as sessões em memória → API com **uma réplica**. Para falar com o agente: `gateway.sessao(agenteId).requisitar(tipo, dados, timeout)`; mudou conexão de banco → `gateway.enviarConfiguracao(agenteId)`. Mensagem nova do protocolo: atualizar `protocolo.ts`, `apps/agent/internal/protocolo` e `apps/agent/PROTOCOLO.md` juntos.
- **Painel do agente (Windows):** o `.exe` é gráfico (`-H windowsgui`); sem argumentos abre `internal/painel` (bandeja com fyne.io/systray + janela WebView2 com `pagina.html` embutida). O serviço (SYSTEM) não tem área de trabalho: publica a situação em `%ProgramData%\EtiquetasAgenteStatus\status.json` (`internal/estado`, sem segredos; eventos são frases para o usuário, não log) e o painel lê esse arquivo + consulta o serviço com permissão de leitura. Ações de administrador (instalar, iniciar, reiniciar) rodam o próprio exe com UAC (`runas`) e `-resultado <arquivo>`. `instalar` copia para `C:\Program Files\EtiquetasAgente`, atualiza o caminho do serviço se já existir (não remove/recria) e grava `HKLM\...\Run`. Ícone desenhado em código (`internal/icone`); recursos do exe em `rsrc_windows_amd64.syso` (gerador em `tools/recursos`, módulo separado). A configuração `configuracao` traz `empresaCnpj`. Aba Impressoras: `impressao.ListarDoSistema` (EnumPrinters), `ProcurarNaRede` (porta 9100 nas /24 privadas), `SugerirLinguagem` e `EtiquetaDeTeste`; o cadastro vai para `/api/agente/impressoras` (`ImpressorasAgenteController`, `@Publico` + `AgentesGateway.autenticar`, impressora ligada ao agente, idempotente por método+endereço). **Neste computador de desenvolvimento roda o agente real de produção** (serviço + painel em Program Files): agente de teste aqui escreveria no mesmo `status.json` e o painel de teste esbarra na instância única.
- **Atualização do agente (Windows):** `internal/atualizacao` + `cmd/etiquetas-agente/atualizador.go`. O serviço confere `/downloads/versao.txt` a cada 6 h (só HTTPS, só versão mais nova, `dev` nunca), baixa em `etiquetas-agente.novo.exe` na pasta de instalação, confere SHA-256 e `versao`, espera as impressões terminarem e troca (renomear executável em uso é permitido). O vigia `concluir-atualizacao`, rodando de `.antigo.exe` num processo solto, reinicia o serviço e olha o `status.json`: versão nova publicando e de pé por 30 s em até 3 min, senão reverte e grava `versaoRecusada`. Opção e recusa em `atualizacao.json` (arquivo próprio: o cliente regrava `agente.json` a cada conexão). O painel abre a versão nova quando o status muda. A integridade vem do HTTPS e do SHA-256 do mesmo servidor, **a menos que o agente tenha sido compilado com `main.chavePublicaAtualizacao`** (workflow "Agente assinado", `internal/atualizacao/assinatura.go`): esse recusa, antes de executar, o que não tiver `.sig` Ed25519 de `versão|sha256`. Build sem a chave (Dockerfile sem `AGENTE_RELEASE`) continua sem assinatura: invadir o servidor dá execução como SYSTEM nesses agentes.
- **Consultas SQL:** placeholders `{...}` são compilados por `compilarSql` (`packages/shared/src/placeholders.ts`, lexer por dialeto, igual ao validador do agente) em `$n` / `?` / `@pn` + lista de parâmetros. Valores dos placeholders fixos vêm sempre do banco próprio (`ConsultasService.compilar`); o cliente só informa `{param.*}`. Executar SQL num banco do cliente: `ConexoesService.executar(empresaId, conexaoId, sqlCompilado, parametros, limite)`; consulta salva: `ConsultasService.executar(...)`. Placeholder novo: catálogo `PLACEHOLDERS` + valor em `ConsultasService.compilar`.
- **Conexões de planilhas:** `ConexaoBanco.tipo` é `TipoConexao` (bancos + `PASTA` + `GOOGLE_DRIVE`); `TipoBanco` segue só para SQL e ERPs (`ehConexaoSql` separa). Reaproveita colunas: `banco` = caminho da pasta ou id da pasta no Drive; Drive também tem `usuario` = e-mail da conta de serviço, `senha_cifrada` = chave JSON e `agente_id` nulo. A consulta aponta para `arquivo`/`arquivo_nome`/`aba` (sql vazio) e `ConsultasService` chama `ConexoesService.lerPlanilha`; `{param.busca}` vira o termo (código exato, sem zeros à esquerda; senão texto contido). PASTA: mensagens `listar_arquivos`/`ler_arquivo`, pacote `apps/agent/internal/arquivos` (excelize para xlsx, grate para xls, cache por data do arquivo; só lê dentro da pasta e essas extensões). Data e texto no xlsx vêm do formato da célula, não do texto formatado. Drive: `GoogleDriveService` na API, JWT da conta de serviço, escopo somente leitura, só arquivos diretamente na pasta (Planilhas Google exportadas como xlsx, .xlsx, .csv; .xls não). Títulos viram campos em `montarTabela` (`packages/shared/src/planilhas.ts`).
- **Campos dinâmicos:** colunas lidas ao salvar a consulta (execução com 1 linha e `{param.*}` nulos), gravadas em `consultas_sql.campos` com `campos_hash` = SHA-256(conexão + SQL); hash diferente = campos desatualizados.
- **Etiquetas:** `LayoutEtiqueta` (mm) em `packages/shared/src/etiquetas` é a fonte única: o editor (Konva) desenha, `validarLayout` valida na API e os geradores traduzem. `posicionar()` distribui etiquetas em páginas (fileira no rolo, folha) e resolve textos; cada gerador (`zpl.ts`, `ppla.ts`, `pplb.ts`, `escpos.ts`) só traduz elementos posicionados. PDF fica na API (`src/modelos/pdf.ts`, pdf-lib + bwip-js). Recurso não suportado numa linguagem vira item em `avisos`, nunca saída quebrada. Gerar: `gerarSaida(layout, registros, linguagem, dpi, hoje)`.
- **Design (cartazes em jato de tinta):** o foco é o PDF. Campos opcionais em `tipos.ts` (fonte, cor, itálico, sublinhado, contorno, fundo, ajustar ao quadro, opacidade, travado, `corFundo` do layout…) e os tipos `preco`, `elipse` e `estrela`; layout antigo sem esses campos vale como antes. `design.ts` tem o catálogo `FONTES` (Helvetica/Times/Courier do PDF + 17 famílias do Fontsource, instaladas em `apps/api` e `apps/web`) e a diagramação (`planejarTexto`, `diagramarPreco`) que o PDF e o editor (Konva, `Tela.tsx`, desenho manual no canvas) usam com medidores próprios, para quebrar as linhas igual. No PDF, fontes WOFF viram TTF (`modelos/woff.ts`) e são embutidas **sem subset** (o subset do fontkit derruba o processo). Térmicas: preço sai como texto, elipse só em ZPL, cores claras não imprimem e um aviso lista o que só vale no PDF. Corpo da API até 20 MB (imagens coloridas); nginx 21 MB.
- **Imagens:** `ElementoImagem` guarda a imagem em tons de cinza (base64, até 480 px no maior lado, reduzida no navegador em `apps/web/src/pages/modelos/imagens.ts`). `bitmapNaCaixa` (`etiquetas/imagem.ts`) redimensiona, gira e converte em preto e branco (limiar ou pontilhado) na resolução da impressora, com cache por elemento. ZPL: `~DG` uma vez + `^XG` por etiqueta; PPLB: `GW` com bits invertidos (saída vira base64); ESC/POS: faixas `ESC *` 33; PDF: PNG cinza (`modelos/png.ts`); PPLA: só aviso. Nenhuma saída de imagem foi testada em impressora real.
- **Impressão:** `TrabalhosService.criar` gera o conteúdo (via `gerarSaida`) e grava `trabalhos_impressao`; essa tabela é a fila (durável, sem Redis). `DespachoService` envia ao agente um trabalho por vez por agente: ao criar, quando o agente conecta (`gateway.quandoConectar`) e numa varredura a cada 30 s. Reivindica com `updateMany status PENDENTE→ENVIANDO`. Queda antes do envio volta para a fila; queda depois de enviado, ou sem confirmação, vira ERRO para o operador conferir (nunca reimprime sozinho). PDF não passa pelo agente: fica CONCLUIDO e é aberto no navegador.
- **Limites por folha:** `minimoPorFolha`/`maximoPorFolha` no layout (só papel folha; `limitesPorFolha`, `tamanhosDasFolhas`, `problemaNasFolhas` em `etiquetas/layout.ts`). `posicionar()` aplica em todas as linguagens e divide sem deixar folha abaixo do mínimo (25 de 8 a 21 = 17 + 8). `TrabalhosService.criar` recusa quantidade impossível e não corta folha entre lotes. Lista do dia: o modelo fora dos limites fica pendente com aviso, os outros seguem. Agendamento: imprime os itens que fecham folhas e o resto espera o próximo ciclo. Pré-visualização só avisa.
- **Produtos banidos:** `produtos_banidos`, chave `(empresa_id, codigo_barras)` com o código de `normalizarCodigoBarras` (sem zeros à esquerda). `codigosDoRegistro` olha as colunas de código de barras; sem nenhuma, as de código. Filtram `TrabalhosService.criar` (toda impressão), `ModelosService.gerar`, a montagem da lista e a busca avulsa. Trabalho guarda os códigos em `codigos_produtos`: reenviar recusa se algum foi banido depois (trabalho antigo, sem códigos, passa). Lista do dia e avulsa têm "Banir selecionados" (`components/BanirProdutos.tsx`, exige `produto_banido.editar`; tudo o que ficou banido sai da tela, inclusive em outro modelo) e "Apagar selecionados". Na lista, apagar = `POST /listas/itens/descartar` (só pendentes, volta por "Descartados hoje"); na avulsa, volta por "Desfazer".
- **Painel (Início):** `PainelService` (`src/painel`), permissão `painel.ver`; super-admin também vê `/painel/plataforma` (uma linha por empresa). Tempo dos SQL vem de `execucoes_consulta`, gravada em `ConsultasService.executarSelecionada` (consultas salvas e planilhas, sem SQL nem parâmetros; o console ad hoc fica de fora; apagada depois de 35 dias). Uso por usuário não conta agendamento, que roda em nome do responsável e esconderia a falta de uso.
- **Notificações:** catálogo `EVENTOS_NOTIFICACAO` em `packages/shared/src/notificacoes.ts`; regras por empresa em `regras_notificacao` (sem registro = desligada, nenhum cliente recebe aviso sem configurar), horário em `janelas_notificacao`. `NotificacoesService` (`src/notificacoes`) avalia a cada minuto: (evento, chave) identifica o problema, que fica aberto em `notificacoes` até a condição acabar; fora da janela não envia nem repete. Canais: sino (`canalSistema`), balão (`canalAgente`, mensagem `notificar`; o `id` muda a cada repetição), celular (`canalCelular`) e e-mail (`canalEmail`), estes dois para quem tem `notificacao.ver`; um canal fora do ar não atrapalha os outros. Agente que volta recebe o que ainda vale, das últimas 12 h; aviso sobre um agente não vai para ele mesmo. No agente: o serviço publica em `status.json` (`estado.Notificacao`) e o painel mostra o balão com `Shell_NotifyIcon` no ícone do fyne.io/systray (`mostrarBalao`, classe `SystrayClass`, uID 100: conferir ao atualizar a biblioteca); o que já apareceu fica por usuário em `%LOCALAPPDATA%\EtiquetasAgente\notificacoes-vistas.json`. Sem o ícone aberto no computador, não há balão.
- **Lista do dia:** modelos com `naListaDiaria` e consulta; colunas convencionais `codigo/ean` (chave), `descricao/nome`, `quantidade/qtd` (`packages/shared/src/impressao.ts`). Atualizar a lista não traz de volta itens impressos, na fila ou descartados no dia.
- **Agendamentos:** `AgendamentosService` (`src/impressao`), relógio em processo a cada 5 s; reivindica com `updateMany` no `proxima_execucao_em` antigo. Ciclo guardado em segundos (mín. 30 s), cadastrado em segundos/minutos/horas/dias e alinhado ao início (`packages/shared/src/agendamentos.ts`). Cada ciclo chama `ListasService.atualizarModeloNaLista` (só os pendentes daquele modelo; consulta falhou = pendentes ficam) e, com impressão automática, `imprimirPendentesDoModelo` (origem `AGENDAMENTO`). Roda com o usuário responsável (último a salvar), porque a consulta resolve `{usuario.*}`. Recusa consulta com `{param.*}` e impressão automática em impressora PDF. Histórico das 20 últimas execuções no próprio registro; auditoria só de execução manual ou que imprimiu. "Atualizar" da lista do dia não apaga pendentes de modelo agendado fora dela.
- **Etiqueta avulsa:** a tela monta uma lista (buscas somadas, linhas digitadas com qualquer campo do modelo — `ModeloAvulso.campos` = colunas da consulta + `camposUsados` do layout) guardada no `localStorage` por empresa/modelo. Regras puras em `packages/shared/src/avulsa.ts` (filtro geral e por coluna com `>`/`<`/`=`/`!`, ordenação, `alterarEmMassa`, números "4,99" → "4.99" sem tocar em códigos/EAN). A coluna do código (`colunaDeBusca`, marcada com 🔍) busca na consulta do modelo ao mudar: um resultado preenche a linha, vários abrem a escolha. Ordenar reorganiza a lista uma vez (não é ao vivo); imprime só as linhas visíveis com quantidade. A API recebe os registros prontos (validados por `validarRegistros`), sem conferir com a consulta.
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
AGENTE_TESTE_PG=host:porta:usuario:senha:banco go test ./internal/banco   # integração com banco real; também AGENTE_TESTE_MYSQL e AGENTE_TESTE_MSSQL

E2E_DATABASE_URL=postgresql://... corepack pnpm --filter @etiquetas/e2e e2e   # telas e API, com o build de produção
E2E_APP_URL=http://localhost:8099                       # inclui as telas do app (antes: cd apps/mobile && npx expo export -p web)
```

Postgres local: `docker compose up -d` (arquivo na raiz). Copie `apps/api/.env.example` para `apps/api/.env`.
Deploy: [docs/DEPLOY.md](docs/DEPLOY.md).

## Estado das fases

- [x] Fase 1 – Base: monorepo, autenticação, empresas, usuários, permissões, deploy
  - Feito: login JWT com rate limit, super-admin inicial via env, CRUD de empresas (super-admin), usuários e perfis com permissões granulares, aviso de carência/bloqueio no login, auditoria, frontend (login, empresas, usuários, perfis, minha conta), Dockerfiles api/web e guia do Easypanel.
  - Testado: 35 testes unitários + roteiro ponta a ponta contra Postgres real (27 cenários, incl. isolamento entre empresas). Builds Docker não testados localmente (sem Docker na máquina); o CI do GitHub constrói e sobe as imagens.
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
- [x] Melhorias de novembro/2026 e aplicativo
  - Feito: duas etapas, sessões encerráveis, CSP, senha esquecida e e-mail, faxina, tela Saúde, monitor externo, assinatura das atualizações do agente, Liberar selecionados, reenvio reconfere banimento, erro 500 ao criar empresa sem administrador, aplicativo (vínculo por QR, Início, Lista do dia com aprovação, Avisos, push).
  - Testado: 189 testes na API, 34 de ponta a ponta com navegador e build de produção (inclui as telas do app em versão web), MySQL e SQL Server reais no CI (resolve o pendente das Fases 2 e 3), imagens Docker no CI, APK instalado e aberto em emulador Android (x86_64, API 34).
  - **Não** testado: push pelo Firebase real, envio de e-mail por SMTP real, leitura do QR pela câmera em celular físico, iPhone (só o código; gerar exige conta Apple).
