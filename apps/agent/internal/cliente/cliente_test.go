package cliente

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"etiquetas/agente/internal/config"
	"etiquetas/agente/internal/protocolo"
)

// servidorFalso aceita o WebSocket e entrega a conexão ao teste.
func servidorFalso(t *testing.T, tokenAceito string) (*httptest.Server, <-chan *websocket.Conn) {
	conexoes := make(chan *websocket.Conn, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != protocolo.Caminho {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+tokenAceito {
			http.Error(w, `{"message":"Token inválido"}`, http.StatusUnauthorized)
			return
		}
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		conexoes <- conn
		<-r.Context().Done()
	}))
	t.Cleanup(srv.Close)
	return srv, conexoes
}

func ler(t *testing.T, ctx context.Context, conn *websocket.Conn) protocolo.Mensagem {
	t.Helper()
	_, dados, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var m protocolo.Mensagem
	if err := json.Unmarshal(dados, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func escrever(t *testing.T, ctx context.Context, conn *websocket.Conn, tipo, id string, dados any) {
	t.Helper()
	bruto, _ := json.Marshal(dados)
	frame, _ := json.Marshal(protocolo.Mensagem{Tipo: tipo, ID: id, Dados: bruto})
	if err := conn.Write(ctx, websocket.MessageText, frame); err != nil {
		t.Fatal(err)
	}
}

func silencioso() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestSessaoCompleta(t *testing.T) {
	srv, conexoes := servidorFalso(t, "agt_antigo")
	caminho := filepath.Join(t.TempDir(), "agente.json")
	cfg := config.Config{Servidor: srv.URL, Token: "agt_antigo"}
	if err := config.Salvar(caminho, &cfg); err != nil {
		t.Fatal(err)
	}

	ctx, cancelar := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelar()
	c := Novo(cfg, caminho, "1.2.3", silencioso())
	fim := make(chan error, 1)
	go func() { fim <- c.Executar(ctx) }()

	conn := <-conexoes
	ola := ler(t, ctx, conn)
	var dadosOla protocolo.Ola
	_ = json.Unmarshal(ola.Dados, &dadosOla)
	if ola.Tipo != protocolo.TipoOla || dadosOla.Versao != "1.2.3" || dadosOla.Protocolo != protocolo.Versao {
		t.Fatalf("ola inesperado: %+v", ola)
	}

	// Configuração com uma conexão; consulta numa conexão que não existe devolve erro tipado.
	escrever(t, ctx, conn, protocolo.TipoConfiguracao, "", protocolo.Configuracao{
		Conexoes: []protocolo.Conexao{{ID: "c1", Tipo: "POSTGRES", Host: "127.0.0.1", Porta: 1, Banco: "x", Usuario: "x"}},
	})
	escrever(t, ctx, conn, protocolo.TipoConsultar, "r1", protocolo.Consultar{ConexaoID: "outra", SQL: "SELECT 1"})
	resp := ler(t, ctx, conn)
	var r protocolo.Resposta
	_ = json.Unmarshal(resp.Dados, &r)
	if resp.Tipo != protocolo.TipoResposta || resp.ID != "r1" || r.OK || r.Erro.Codigo != "conexao_desconhecida" {
		t.Fatalf("resposta inesperada: %s", resp.Dados)
	}
	if c.executor.TotalConexoes() != 1 {
		t.Fatal("configuração não aplicada")
	}

	// SQL de escrita é recusado no próprio agente, antes de chegar ao banco.
	escrever(t, ctx, conn, protocolo.TipoConsultar, "r2", protocolo.Consultar{ConexaoID: "c1", SQL: "DROP TABLE produtos"})
	resp = ler(t, ctx, conn)
	_ = json.Unmarshal(resp.Dados, &r)
	if r.OK || r.Erro.Codigo != "sql_recusado" {
		t.Fatalf("esperava sql_recusado: %s", resp.Dados)
	}

	// Rotação: o token novo vai para o disco antes da confirmação.
	escrever(t, ctx, conn, protocolo.TipoRotacionarToken, "r3", protocolo.RotacionarToken{Token: "agt_novo"})
	resp = ler(t, ctx, conn)
	r = protocolo.Resposta{}
	_ = json.Unmarshal(resp.Dados, &r)
	if !r.OK {
		t.Fatalf("rotação falhou: %s", resp.Dados)
	}
	salvo, _ := config.Carregar(caminho)
	if salvo.Token != "agt_novo" {
		t.Fatalf("token não gravado: %+v", salvo)
	}

	// Revogação pelo servidor encerra o agente pedindo nova ativação.
	conn.Close(protocolo.FechamentoRevogado, "revogado")
	select {
	case err := <-fim:
		if !errors.Is(err, ErrPrecisaAtivar) {
			t.Fatalf("esperava ErrPrecisaAtivar, veio %v", err)
		}
	case <-ctx.Done():
		t.Fatal("o agente não encerrou após a revogação")
	}
}

func TestTokenRecusadoNoHandshake(t *testing.T) {
	srv, _ := servidorFalso(t, "outro")
	c := Novo(config.Config{Servidor: srv.URL, Token: "agt_errado"}, filepath.Join(t.TempDir(), "a.json"), "dev", silencioso())
	ctx, cancelar := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelar()
	if err := c.Executar(ctx); !errors.Is(err, ErrPrecisaAtivar) {
		t.Fatalf("esperava ErrPrecisaAtivar, veio %v", err)
	}
}

func TestAtivar(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var p pedidoAtivacao
		_ = json.NewDecoder(r.Body).Decode(&p)
		if r.URL.Path != "/api/agente/ativar" || p.Codigo != "ABCD-EFGH" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"statusCode":401,"message":"CNPJ ou código de ativação inválido."}`))
			return
		}
		_ = json.NewEncoder(w).Encode(RespostaAtivacao{Token: "agt_x", AgenteID: "a1", AgenteNome: "Loja", EmpresaNome: "Mercado"})
	}))
	defer srv.Close()

	r, err := Ativar(context.Background(), srv.URL, "11222333000181", "ABCD-EFGH", "pc")
	if err != nil || r.Token != "agt_x" {
		t.Fatal(r, err)
	}
	_, err = Ativar(context.Background(), srv.URL, "11222333000181", "ERRADO", "pc")
	if err == nil || !strings.Contains(err.Error(), "CNPJ ou código de ativação inválido.") {
		t.Fatalf("mensagem do servidor deveria aparecer: %v", err)
	}
}
