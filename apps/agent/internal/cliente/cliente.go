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
	"net/http"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/coder/websocket"

	"etiquetas/agente/internal/banco"
	"etiquetas/agente/internal/config"
	"etiquetas/agente/internal/protocolo"
)

// ErrPrecisaAtivar: o servidor recusou o token (revogado ou novo código gerado).
var ErrPrecisaAtivar = errors.New("o token do agente foi recusado pelo servidor; gere um novo código de ativação no painel e ative novamente")

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

	ctxDial, cancelarDial := context.WithTimeout(ctx, 30*time.Second)
	conn, resp, err := websocket.Dial(ctxDial, config.URLWebSocket(servidor, protocolo.Caminho), &websocket.DialOptions{HTTPHeader: cabecalho})
	cancelarDial()
	if err != nil {
		if resp != nil {
			switch resp.StatusCode {
			case http.StatusUnauthorized:
				return ErrPrecisaAtivar
			case http.StatusForbidden:
				return &erroComEspera{errors.New("empresa bloqueada no servidor"), esperaBloqueado}
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
		return &erroComEspera{errors.New("empresa bloqueada no servidor"), esperaBloqueado}
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
		return c.executor.Consultar(ctx, req)

	case protocolo.TipoTestarConexao:
		var req protocolo.TestarConexao
		if err := decodificar(msg.Dados, &req); err != nil {
			return nil, err
		}
		return c.executor.Testar(ctx, req.ConexaoID)

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
