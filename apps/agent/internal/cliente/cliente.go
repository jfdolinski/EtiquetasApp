// Package cliente mantém a conexão WebSocket de saída com a API e atende as requisições.
package cliente

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net"
	"net/http"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/coder/websocket"

	"etiquetas/agente/internal/banco"
	"etiquetas/agente/internal/config"
	"etiquetas/agente/internal/estado"
	"etiquetas/agente/internal/impressao"
	"etiquetas/agente/internal/protocolo"
)

// ErrPrecisaAtivar: o servidor recusou o token (revogado ou novo código gerado).
var ErrPrecisaAtivar = errors.New("o token do agente foi recusado pelo servidor; gere um novo código de ativação no painel e ative novamente")

var errBloqueada = errors.New("empresa bloqueada no servidor")

// descreverErro traduz as falhas de rede mais comuns para o painel.
func descreverErro(err error) string {
	var dns *net.DNSError
	switch {
	case errors.Is(err, errBloqueada):
		return "A empresa está bloqueada no sistema. Fale com o suporte."
	case errors.As(err, &dns):
		return "Não foi possível encontrar o servidor (" + dns.Name + "). Verifique a internet deste computador."
	case errors.Is(err, context.DeadlineExceeded):
		return "O servidor não respondeu a tempo. Verifique a internet deste computador."
	}
	var op *net.OpError
	if errors.As(err, &op) {
		return "Sem conexão com o servidor. Verifique a internet deste computador."
	}
	return err.Error()
}

const (
	tamanhoMaximoMensagem = 32 << 20
	intervaloPing         = 30 * time.Second
	tempoLimitePing       = 15 * time.Second
	esperaMinima          = time.Second
	esperaMaxima          = time.Minute
	esperaBloqueado       = 5 * time.Minute
	requisicoesParalelas  = 4
)

// Cliente é seguro para uso por uma única goroutine chamando Executar.
type Cliente struct {
	Versao string
	Log    *slog.Logger
	// Estado publicado para o painel da bandeja (pode ser nil).
	Estado *estado.Estado

	mu            sync.Mutex
	cfg           config.Config
	caminhoConfig string
	executor      *banco.Executor
}

func Novo(cfg config.Config, caminhoConfig, versao string, log *slog.Logger) *Cliente {
	return &Cliente{Versao: versao, Log: log, cfg: cfg, caminhoConfig: caminhoConfig, executor: banco.NovoExecutor()}
}

// erroComEspera pede um intervalo específico antes de reconectar.
type erroComEspera struct {
	err    error
	espera time.Duration
}

func (e *erroComEspera) Error() string { return e.err.Error() }
func (e *erroComEspera) Unwrap() error { return e.err }

// Executar conecta e reconecta (com espera exponencial) até o contexto terminar
// ou o servidor recusar o token.
func (c *Cliente) Executar(ctx context.Context) error {
	defer c.executor.Fechar()
	espera := esperaMinima
	for {
		inicio := time.Now()
		err := c.sessao(ctx)
		if ctx.Err() != nil {
			return nil
		}
		if errors.Is(err, ErrPrecisaAtivar) {
			c.Estado.Atualizar(func(i *estado.Instantaneo) {
				i.Situacao, i.Detalhe, i.ConectadoDesde, i.ProximaTentativa = estado.Recusado, err.Error(), nil, nil
			})
			c.Estado.Evento("erro", "O servidor recusou a chave deste computador. É preciso ativar de novo.")
			return err
		}
		if time.Since(inicio) > time.Minute {
			espera = esperaMinima // a sessão chegou a funcionar: recomeça a espera
		}
		proxima := espera + time.Duration(rand.Int64N(int64(espera/2)+1)) // jitter
		var comEspera *erroComEspera
		if errors.As(err, &comEspera) {
			proxima = comEspera.espera
		}
		situacao := estado.Desconectado
		if comEspera != nil && errors.Is(comEspera, errBloqueada) {
			situacao = estado.Bloqueado
		}
		quando := time.Now().Add(proxima)
		c.Estado.Atualizar(func(i *estado.Instantaneo) {
			i.Situacao, i.Detalhe, i.ConectadoDesde, i.ProximaTentativa = situacao, descreverErro(err), nil, &quando
		})
		c.Estado.Evento("aviso", "Sem conexão: "+descreverErro(err))
		c.Log.Warn("conexão com o servidor encerrada", "erro", err, "nova_tentativa_em", proxima.Round(time.Second))

		select {
		case <-ctx.Done():
			return nil
		case <-time.After(proxima):
		}
		espera = min(espera*2, esperaMaxima)
	}
}

func (c *Cliente) sessao(ctx context.Context) error {
	c.mu.Lock()
	servidor, token := c.cfg.Servidor, c.cfg.Token
	c.mu.Unlock()

	cabecalho := http.Header{}
	cabecalho.Set("Authorization", "Bearer "+token)
	cabecalho.Set("User-Agent", "etiquetas-agente/"+c.Versao)

	c.Estado.Atualizar(func(i *estado.Instantaneo) {
		i.Situacao, i.Detalhe, i.ConectadoDesde, i.ProximaTentativa, i.Servidor = estado.Conectando, "", nil, nil, servidor
	})
	ctxDial, cancelarDial := context.WithTimeout(ctx, 30*time.Second)
	conn, resp, err := websocket.Dial(ctxDial, config.URLWebSocket(servidor, protocolo.Caminho), &websocket.DialOptions{HTTPHeader: cabecalho})
	cancelarDial()
	if err != nil {
		if resp != nil {
			switch resp.StatusCode {
			case http.StatusUnauthorized:
				return ErrPrecisaAtivar
			case http.StatusForbidden:
				return &erroComEspera{errBloqueada, esperaBloqueado}
			}
		}
		return err
	}
	defer conn.CloseNow()
	conn.SetReadLimit(tamanhoMaximoMensagem)

	ctx, cancelar := context.WithCancel(ctx)
	defer cancelar()

	hostname, _ := os.Hostname()
	if err := c.enviar(ctx, conn, protocolo.TipoOla, "", protocolo.Ola{
		Versao:             c.Versao,
		Protocolo:          protocolo.Versao,
		Hostname:           hostname,
		SistemaOperacional: runtime.GOOS + "/" + runtime.GOARCH,
	}); err != nil {
		return err
	}
	c.Log.Info("conectado ao servidor", "servidor", servidor)
	agora := time.Now()
	c.Estado.Atualizar(func(i *estado.Instantaneo) {
		i.Situacao, i.Detalhe, i.ConectadoDesde, i.ProximaTentativa = estado.Conectado, "", &agora, nil
	})
	c.Estado.Evento("info", "Conectado ao servidor.")

	go c.manterVivo(ctx, conn, cancelar)

	vagas := make(chan struct{}, requisicoesParalelas)
	var emAndamento sync.WaitGroup
	defer func() {
		cancelar() // interrompe consultas em andamento antes de esperar por elas
		emAndamento.Wait()
	}()

	for {
		_, dados, err := conn.Read(ctx)
		if err != nil {
			return c.motivoFechamento(err)
		}
		var msg protocolo.Mensagem
		if err := json.Unmarshal(dados, &msg); err != nil {
			c.Log.Warn("mensagem inválida do servidor", "erro", err)
			continue
		}
		if msg.Tipo == protocolo.TipoConfiguracao {
			c.aplicarConfiguracao(msg.Dados)
			continue
		}
		emAndamento.Add(1)
		go func() {
			defer emAndamento.Done()
			select {
			case vagas <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-vagas }()
			c.atender(ctx, conn, msg)
		}()
	}
}

// manterVivo envia ping periódico; sem pong, derruba a sessão para reconectar.
func (c *Cliente) manterVivo(ctx context.Context, conn *websocket.Conn, cancelar context.CancelFunc) {
	t := time.NewTicker(intervaloPing)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			ctxPing, cancelarPing := context.WithTimeout(ctx, tempoLimitePing)
			err := conn.Ping(ctxPing)
			cancelarPing()
			if err != nil && ctx.Err() == nil {
				c.Log.Warn("servidor não respondeu ao ping", "erro", err)
				cancelar()
				return
			}
		}
	}
}

func (c *Cliente) motivoFechamento(err error) error {
	switch websocket.CloseStatus(err) {
	case protocolo.FechamentoRevogado:
		return ErrPrecisaAtivar
	case protocolo.FechamentoBloqueado:
		return &erroComEspera{errBloqueada, esperaBloqueado}
	case protocolo.FechamentoSubstituido:
		return &erroComEspera{errors.New("outra instância deste agente conectou com o mesmo token"), esperaMaxima}
	}
	return err
}

func (c *Cliente) aplicarConfiguracao(dados json.RawMessage) {
	var cfg protocolo.Configuracao
	if err := json.Unmarshal(dados, &cfg); err != nil {
		c.Log.Error("configuração inválida recebida do servidor", "erro", err)
		return
	}
	c.executor.Configurar(cfg.Conexoes)
	c.Log.Info("configuração recebida", "empresa", cfg.EmpresaNome, "agente", cfg.AgenteNome, "conexoes", len(cfg.Conexoes))
	c.Estado.Atualizar(func(i *estado.Instantaneo) {
		i.EmpresaNome, i.AgenteNome, i.ConexoesBanco = cfg.EmpresaNome, cfg.AgenteNome, len(cfg.Conexoes)
		if cfg.EmpresaCNPJ != "" {
			i.CNPJ = config.FormatarCNPJ(cfg.EmpresaCNPJ)
		}
	})
	c.Estado.Evento("info", fmt.Sprintf("Configuração recebida: %s.", plural(len(cfg.Conexoes), "conexão de banco", "conexões de banco")))
	c.lembrarEmpresa(cfg)
}

// lembrarEmpresa grava empresa, agente e CNPJ na configuração local, para o painel
// mostrá-los mesmo quando o servidor estiver fora do ar.
func (c *Cliente) lembrarEmpresa(cfg protocolo.Configuracao) {
	c.mu.Lock()
	defer c.mu.Unlock()
	novo := c.cfg
	novo.EmpresaNome, novo.AgenteNome = cfg.EmpresaNome, cfg.AgenteNome
	if cfg.EmpresaCNPJ != "" {
		novo.CNPJ = config.FormatarCNPJ(cfg.EmpresaCNPJ)
	}
	if novo == c.cfg {
		return
	}
	if err := config.Salvar(c.caminhoConfig, &novo); err != nil {
		c.Log.Debug("não foi possível gravar os dados da empresa", "erro", err)
		return
	}
	c.cfg = novo
}

func (c *Cliente) atender(ctx context.Context, conn *websocket.Conn, msg protocolo.Mensagem) {
	resultado, err := c.processar(ctx, msg)
	resposta := protocolo.Resposta{OK: err == nil, Resultado: resultado}
	if err != nil {
		codigo := "erro"
		var ec *banco.ErroConsulta
		if errors.As(err, &ec) {
			codigo = ec.Codigo
		}
		resposta.Erro = &protocolo.Erro{Codigo: codigo, Mensagem: err.Error()}
		if msg.Tipo == protocolo.TipoConsultar || msg.Tipo == protocolo.TipoTestarConexao {
			c.Estado.Evento("aviso", "Consulta ao banco do ERP falhou: "+err.Error())
		}
		c.Log.Warn("requisição falhou", "tipo", msg.Tipo, "codigo", codigo, "erro", err)
	}
	if msg.ID == "" {
		return
	}
	if err := c.enviar(ctx, conn, protocolo.TipoResposta, msg.ID, resposta); err != nil {
		c.Log.Warn("não foi possível enviar a resposta", "erro", err)
	}
}

func (c *Cliente) processar(ctx context.Context, msg protocolo.Mensagem) (any, error) {
	switch msg.Tipo {
	case protocolo.TipoConsultar:
		var req protocolo.Consultar
		if err := decodificar(msg.Dados, &req); err != nil {
			return nil, err
		}
		r, err := c.executor.Consultar(ctx, req)
		if err == nil {
			c.Estado.Atualizar(func(i *estado.Instantaneo) { i.Consultas++ })
		}
		return r, err

	case protocolo.TipoTestarConexao:
		var req protocolo.TestarConexao
		if err := decodificar(msg.Dados, &req); err != nil {
			return nil, err
		}
		return c.executor.Testar(ctx, req.ConexaoID)

	case protocolo.TipoImprimir:
		var req protocolo.Imprimir
		if err := json.Unmarshal(msg.Dados, &req); err != nil {
			return nil, errors.New("trabalho de impressão inválido")
		}
		inicio := time.Now()
		err := impressao.Imprimir(ctx, req.Metodo, req.Endereco, req.Nome, req.Dados)
		c.Estado.Atualizar(func(i *estado.Instantaneo) {
			t := &estado.Trabalho{Hora: time.Now(), Impressora: req.Endereco, Nome: req.Nome, OK: err == nil}
			if err != nil {
				t.Erro = err.Error()
				i.ErrosImpressao++
			} else {
				i.Impressoes++
			}
			i.UltimoTrabalho = t
		})
		if err != nil {
			c.Estado.Evento("erro", "Erro ao imprimir em "+req.Endereco+": "+err.Error())
			return nil, err
		}
		c.Estado.Evento("info", "Etiquetas enviadas para "+req.Endereco+".")
		c.Log.Info("trabalho impresso", "trabalho", req.TrabalhoID, "impressora", req.Endereco, "bytes", len(req.Dados), "ms", time.Since(inicio).Milliseconds())
		return struct{}{}, nil

	case protocolo.TipoRotacionarToken:
		var req protocolo.RotacionarToken
		if err := decodificar(msg.Dados, &req); err != nil || req.Token == "" {
			return nil, errors.New("token inválido")
		}
		return struct{}{}, c.salvarToken(req.Token)
	}
	return nil, fmt.Errorf("tipo de mensagem não suportado por esta versão do agente: %s", msg.Tipo)
}

// salvarToken grava o novo token em disco antes de confirmar ao servidor.
func (c *Cliente) salvarToken(token string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	novo := c.cfg
	novo.Token = token
	if err := config.Salvar(c.caminhoConfig, &novo); err != nil {
		return fmt.Errorf("não foi possível gravar o novo token: %w", err)
	}
	c.cfg = novo
	c.Log.Info("token do agente rotacionado")
	c.Estado.Evento("info", "Chave de acesso renovada pelo servidor.")
	return nil
}

func (c *Cliente) enviar(ctx context.Context, conn *websocket.Conn, tipo, id string, dados any) error {
	bruto, err := json.Marshal(dados)
	if err != nil {
		return err
	}
	frame, err := json.Marshal(protocolo.Mensagem{Tipo: tipo, ID: id, Dados: bruto})
	if err != nil {
		return err
	}
	ctx, cancelar := context.WithTimeout(ctx, 30*time.Second)
	defer cancelar()
	return conn.Write(ctx, websocket.MessageText, frame)
}

// decodificar usa UseNumber para que inteiros grandes nos parâmetros não virem float.
func decodificar(dados json.RawMessage, destino any) error {
	d := json.NewDecoder(bytes.NewReader(dados))
	d.UseNumber()
	return d.Decode(destino)
}

func plural(n int, um, varios string) string {
	if n == 1 {
		return "1 " + um
	}
	return fmt.Sprintf("%d %s", n, varios)
}
