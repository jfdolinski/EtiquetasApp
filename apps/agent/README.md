# Agente local (Go)

Programa instalado na rede do cliente. Abre uma conexão WebSocket **de saída** com a API, sem precisar abrir portas no firewall da loja. Pela conexão, recebe as conexões de banco e executa consultas somente leitura no ERP: PostgreSQL, MySQL/MariaDB ou SQL Server. Também recebe os trabalhos de impressão já gerados (ZPL, PPLA, PPLB, ESC/POS) e entrega à impressora:

- **Rede:** envio RAW para IP:porta, normalmente 9100.
- **Impressora do sistema:** spooler em modo RAW, pelo winspool no Windows ou `lp -o raw` no Linux.

PDF é impresso pelo navegador.

- Nada de SQL ou de credenciais fica no disco. As conexões de banco chegam do servidor e ficam só em memória.
- No disco fica apenas `agente.json`, com o endereço do servidor e o token do agente:
  - Windows: `%ProgramData%\EtiquetasAgente`, com acesso restrito a SYSTEM e Administradores.
  - Linux como root: `/etc/etiquetas-agente`, com permissão `0600`.
- Protocolo: [PROTOCOLO.md](PROTOCOLO.md).

## Painel do Windows (ícone ao lado do relógio)

No Windows, o `etiquetas-agente.exe` é um aplicativo gráfico (`-H windowsgui`). Aberto com dois cliques, ele mostra um ícone ao lado do relógio e uma janela com:

- a situação da conexão, com o ícone na mesma cor: verde = conectado, amarelo = conectando ou falta instalar, vermelho = sem conexão/parado/bloqueado, cinza = não ativado;
- empresa, CNPJ, nome deste computador no sistema e servidor;
- tempo conectado, conexões de banco, impressões e a atividade recente;
- botões para abrir o sistema e para reiniciar, iniciar ou instalar o agente.

**Ativar pela janela:** informe o CNPJ e o código de ativação e clique em **Ativar este computador**. O Windows pede permissão de administrador. O agente então:

1. ativa e grava o token;
2. copia-se para `C:\Program Files\EtiquetasAgente`;
3. instala ou atualiza o serviço;
4. registra o painel para abrir com o Windows: só o ícone, sem janela, em `HKLM\...\Run`.

Como funciona por dentro:

- O serviço roda como SYSTEM, sem acesso à área de trabalho. Ele publica a situação em `%ProgramData%\EtiquetasAgenteStatus\status.json` (pacote `internal/estado`, sem token nem senhas). O painel (`internal/painel`) lê esse arquivo e consulta o serviço sem precisar ser administrador.
- A janela usa o WebView2, que já vem no Windows 11 e no Windows 10 atualizado. Sem ele, o painel avisa e abre a página de download; o agente continua funcionando.
- Na primeira execução, o painel marca o ícone para ficar visível na barra. O Windows 11 aplica isso no próximo login. Antes disso, o link **Ícone ao lado do relógio** abre a configuração da barra de tarefas.
- Se houver uma cópia antiga do agente na pasta Inicializar do usuário, o painel avisa e oferece removê-la. Ela disputaria a conexão com o serviço.

O ícone e as informações do executável vêm de `cmd/etiquetas-agente/rsrc_windows_amd64.syso`. Para gerar de novo depois de mudar o desenho (`internal/icone`):

```bash
cd tools/recursos && go run . ../../cmd/etiquetas-agente/rsrc_windows_amd64.syso
```

## Ativação

O executável é compilado no build da imagem do web e fica disponível em `https://<domínio>/downloads/` (links na tela de ativação). O `SERVIDOR_PUBLICO` do build já vem gravado nele.

1. No painel, em **Agentes → Novo agente**, gere o código de ativação. Ele vale por 24 horas e uma única vez.
2. **Windows:** abra o `etiquetas-agente.exe` com dois cliques e ative pela janela (veja acima). **Linha de comando (Linux, ou Windows como administrador):**

   ```bash
   etiquetas-agente instalar
   ```

   O agente pede o endereço do servidor, o CNPJ e o código. Também é possível passar tudo direto:

   ```bash
   etiquetas-agente instalar -servidor https://app.seudominio.com.br -cnpj 11.222.333/0001-81 -codigo K7PX-3MQA
   ```

3. Depois disso o agente roda como serviço do sistema (serviço do Windows ou unidade do systemd) e aparece como **Online** no painel.

Só o CNPJ não basta para ativar, porque o CNPJ é público. O código de uso único é que prova que a instalação foi autorizada no painel.

## Comandos

| Comando | O que faz |
|---|---|
| `painel` | Ícone ao lado do relógio e janela de status. É o padrão no Windows (dois cliques); `-oculto` só mostra o ícone |
| `ativar` | Troca CNPJ + código pelo token e grava `agente.json` |
| `executar` | Roda em primeiro plano (é o que o serviço executa). É o padrão no Linux |
| `instalar` / `desinstalar` | Instala e inicia, ou para e remove, o serviço (requer administrador ou root). No Windows, `instalar` também copia o agente para Arquivos de Programas e põe o painel para abrir com o Windows; com `-codigo`, reativa |
| `iniciar` / `parar` / `reiniciar` / `status` | Controlam o serviço |
| `versao` | Mostra a versão |

Opções: `-config <arquivo>`, `-servidor <url>`, `-cnpj`, `-codigo`, `-log <arquivo>`, `-oculto` (painel) e `-resultado <arquivo>` (uso interno: o painel lê o resultado dos comandos que roda como administrador).

No Windows, o executável é gráfico: chamado pelo prompt de comando, ele escreve no console de quem chamou, mas o `cmd` não espera ele terminar (use `start /wait etiquetas-agente ...` em scripts). Sem console próprio, a ativação pela linha de comando exige `-cnpj` e `-codigo`.

## Token

- **Rotacionar token**, no painel, com o agente online: o servidor envia um token novo, o agente grava em disco e confirma, e só então o antigo deixa de valer. Não é preciso mexer na máquina.
- **Reinstalar (novo código)**: revoga o token na hora. O agente conectado cai e encerra pedindo uma nova ativação. Use quando a máquina for trocada ou o token tiver vazado.
- **Desativar** derruba o agente imediatamente. **Bloquear a empresa** derruba no próximo heartbeat, em até 30 segundos.

## Segurança das consultas

1. O SQL precisa ser um único comando `SELECT` ou `WITH`, sem palavras de escrita (`INSERT`, `UPDATE`, `DROP`, `INTO`, `EXEC`, `COMMIT`…). Fica fora da checagem o que estiver dentro de strings e comentários; o lexer segue as regras de cada banco ([somente_leitura.go](internal/banco/somente_leitura.go)).
2. A consulta roda dentro de uma transação que é sempre desfeita. No PostgreSQL e no MySQL essa transação é `READ ONLY`. O driver do SQL Server não oferece transação somente leitura, então lá vale o rollback.
3. A proteção principal continua sendo um **usuário de banco com permissão só de leitura**. Configure assim em todos os clientes.

Também há limite de linhas (no máximo 100 mil por consulta) e de tempo (30 s por padrão, até 10 min).

## Desenvolvimento

Requer Go 1.27 ou mais novo.

```bash
cd apps/agent
go test ./...
go build -o bin/etiquetas-agente.exe ./cmd/etiquetas-agente
```

O teste de integração com PostgreSQL só roda com a variável abaixo definida:

```bash
AGENTE_TESTE_PG=localhost:5432:usuario:senha:banco go test ./internal/banco
```

Binários de distribuição: `bin/` fica fora do Git.

```bash
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w -H windowsgui -X main.versao=0.2.0 -X main.servidorPadrao=https://app.seudominio.com.br" -o bin/etiquetas-agente.exe ./cmd/etiquetas-agente
GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w -X main.versao=0.2.0 -X main.servidorPadrao=https://app.seudominio.com.br" -o bin/etiquetas-agente ./cmd/etiquetas-agente
```

Ainda não implementado: atualização automática do agente e instalador gráfico (`.msi`). Hoje a instalação é o executável mais o comando `instalar`.
