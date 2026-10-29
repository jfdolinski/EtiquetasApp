# Protocolo API ↔ agente

Versão do protocolo: **1**. Tipos espelhados em [`apps/api/src/agentes/protocolo.ts`](../api/src/agentes/protocolo.ts) e [`internal/protocolo`](internal/protocolo/protocolo.go).

## Ativação (HTTP)

`POST /api/agente/ativar`. A rota é pública e tem limite de 10 requisições por minuto.

```json
{ "cnpj": "11.222.333/0001-81", "codigo": "K7PX-3MQA", "hostname": "CAIXA-01" }
```

Respostas:

- **200:** `{ "token": "agt_…", "agenteId", "agenteNome", "empresaNome" }`.
- **401:** CNPJ ou código inválido, expirado ou já usado. A mensagem é a mesma para todos os casos.
- **403:** empresa bloqueada.

Regras do código e do token:

- O código é de uso único: a troca é condicionada ao hash do código, então dois pedidos simultâneos não geram dois tokens.
- O banco guarda só o SHA-256 do código e do token.

## Conexão (WebSocket)

`GET /api/agente/conectar`, com o cabeçalho `Authorization: Bearer <token>`.

Se a autenticação falha, o servidor recusa o handshake:

- **401:** token inválido ou revogado. O agente para e pede uma nova ativação.
- **403:** empresa bloqueada. O agente tenta de novo a cada 5 minutos.

Cada frame é um texto JSON no formato `{ "tipo": string, "id"?: string, "dados"?: any }`. Uma mensagem com `id` espera uma `resposta` com o mesmo `id`:

```json
{ "tipo": "resposta", "id": "…", "dados": { "ok": true, "resultado": … } }
{ "tipo": "resposta", "id": "…", "dados": { "ok": false, "erro": { "codigo": "banco", "mensagem": "…" } } }
```

Códigos de erro: `conexao_desconhecida`, `sql_recusado`, `banco`, `tempo_esgotado`, `erro`.

### Agente → servidor

| tipo | dados | quando |
|---|---|---|
| `ola` | `{ versao, protocolo, hostname, sistemaOperacional }` | logo após conectar |
| `resposta` | ver acima | a cada requisição com `id` |

### Servidor → agente

| tipo | id | dados | resultado |
|---|---|---|---|
| `configuracao` | — | `{ agenteNome, empresaNome, conexoes: [{ id, nome, tipo, host, porta, banco, usuario, senha, opcoes }] }` | — |
| `testar_conexao` | sim | `{ conexaoId }` | `{ ok, versaoServidor, duracaoMs }` |
| `consultar` | sim | `{ conexaoId, sql, parametros, limiteLinhas, tempoLimiteSegundos }` | `{ colunas: [{ nome, tipo }], linhas: any[][], truncado, duracaoMs }` |
| `rotacionar_token` | sim | `{ token }` | `{}`, enviado depois de gravar o token em disco |

A `configuracao` é enviada ao conectar e sempre que uma conexão do agente é criada, editada ou excluída.

Os `parametros` de `consultar` já vêm na sintaxe do driver: `$1` no PostgreSQL, `?` no MySQL e `@p1` no SQL Server. A conversão dos placeholders `{...}` é feita no servidor (`compilarSql` em `packages/shared/src/placeholders.ts`).

Os valores das linhas chegam normalizados:

| Tipo no banco | Formato no JSON |
|---|---|
| Datas | ISO 8601; colunas `DATE` só com a data |
| Decimais | texto, para não perder precisão |
| Inteiros acima de 2^53 | texto |
| UUID | texto |
| Binário | base64 |

### Heartbeat e fechamento

- O servidor envia ping a cada 30 s. Sessão sem pong cai no ciclo seguinte.
- No mesmo ciclo, o servidor revalida o agente e a empresa no banco.
- O agente também envia ping a cada 30 s e reconecta se não receber resposta em 15 s.
- Ao reconectar, o agente espera um tempo que cresce exponencialmente, de 1 s até 60 s, com variação aleatória.

Códigos de fechamento:

| Código | Motivo | Comportamento do agente |
|---|---|---|
| 4000 | outra instância conectou com o mesmo token | tenta de novo em 60 s |
| 4001 | agente desativado ou token revogado | para e pede uma nova ativação |
| 4003 | empresa bloqueada | tenta de novo a cada 5 min |
