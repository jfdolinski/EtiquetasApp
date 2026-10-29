// Package banco executa as consultas nos bancos do ERP (PostgreSQL, MySQL, SQL Server).
package banco

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
	_ "github.com/microsoft/go-mssqldb"

	"etiquetas/agente/internal/protocolo"
)

const (
	tempoLimitePadrao  = 30 * time.Second
	tempoLimiteMaximo  = 10 * time.Minute
	limiteLinhasPadrao = 1000
	limiteLinhasMaximo = 100_000
)

// ErroConsulta carrega um código para o servidor distinguir a origem da falha.
type ErroConsulta struct {
	Codigo string // conexao_desconhecida | sql_recusado | banco | tempo_esgotado
	Err    error
}

func (e *ErroConsulta) Error() string { return e.Err.Error() }
func (e *ErroConsulta) Unwrap() error { return e.Err }

type pool struct {
	db    *sql.DB
	chave string // DSN; muda quando host/usuário/senha mudam
}

// Executor mantém as conexões recebidas do servidor e um pool por conexão.
// As credenciais ficam só em memória.
type Executor struct {
	mu       sync.Mutex
	conexoes map[string]protocolo.Conexao
	pools    map[string]*pool
}

func NovoExecutor() *Executor {
	return &Executor{conexoes: map[string]protocolo.Conexao{}, pools: map[string]*pool{}}
}

// Configurar substitui a lista de conexões e fecha pools que mudaram ou saíram.
func (e *Executor) Configurar(lista []protocolo.Conexao) {
	e.mu.Lock()
	defer e.mu.Unlock()
	novas := make(map[string]protocolo.Conexao, len(lista))
	for _, c := range lista {
		novas[c.ID] = c
	}
	for id, p := range e.pools {
		c, ok := novas[id]
		_, dsn, _ := driverEDSN(c)
		if !ok || dsn != p.chave {
			p.db.Close()
			delete(e.pools, id)
		}
	}
	e.conexoes = novas
}

func (e *Executor) TotalConexoes() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return len(e.conexoes)
}

func (e *Executor) Fechar() {
	e.mu.Lock()
	defer e.mu.Unlock()
	for id, p := range e.pools {
		p.db.Close()
		delete(e.pools, id)
	}
}

func (e *Executor) obter(id string) (protocolo.Conexao, *sql.DB, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	c, ok := e.conexoes[id]
	if !ok {
		return c, nil, &ErroConsulta{"conexao_desconhecida", errors.New("conexão não configurada neste agente")}
	}
	if p, ok := e.pools[id]; ok {
		return c, p.db, nil
	}
	driver, dsn, err := driverEDSN(c)
	if err != nil {
		return c, nil, &ErroConsulta{"banco", err}
	}
	db, err := sql.Open(driver, dsn)
	if err != nil {
		return c, nil, &ErroConsulta{"banco", err}
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(2)
	db.SetConnMaxIdleTime(5 * time.Minute)
	db.SetConnMaxLifetime(30 * time.Minute)
	e.pools[id] = &pool{db: db, chave: dsn}
	return c, db, nil
}

// Testar abre uma conexão e lê a versão do servidor.
func (e *Executor) Testar(ctx context.Context, conexaoID string) (*protocolo.ResultadoTeste, error) {
	inicio := time.Now()
	c, db, err := e.obter(conexaoID)
	if err != nil {
		return nil, err
	}
	ctx, cancelar := context.WithTimeout(ctx, 15*time.Second)
	defer cancelar()
	var versao string
	if err := db.QueryRowContext(ctx, consultaVersao(c.Tipo)).Scan(&versao); err != nil {
		return nil, classificar(ctx, err)
	}
	if i := strings.IndexByte(versao, '\n'); i > 0 { // @@VERSION do SQL Server tem várias linhas
		versao = versao[:i]
	}
	return &protocolo.ResultadoTeste{OK: true, VersaoServidor: strings.TrimSpace(versao), DuracaoMs: time.Since(inicio).Milliseconds()}, nil
}

// Consultar roda o SQL numa transação que é sempre desfeita (somente leitura onde o
// banco suporta) e devolve no máximo LimiteLinhas linhas.
func (e *Executor) Consultar(ctx context.Context, req protocolo.Consultar) (*protocolo.ResultadoConsulta, error) {
	inicio := time.Now()
	c, db, err := e.obter(req.ConexaoID)
	if err != nil {
		return nil, err
	}
	if err := ValidarSomenteLeitura(req.SQL, c.Tipo); err != nil {
		return nil, &ErroConsulta{"sql_recusado", err}
	}

	limite := req.LimiteLinhas
	if limite <= 0 {
		limite = limiteLinhasPadrao
	}
	limite = min(limite, limiteLinhasMaximo)
	tempo := time.Duration(req.TempoLimiteSegundos) * time.Second
	if tempo <= 0 {
		tempo = tempoLimitePadrao
	}
	ctx, cancelar := context.WithTimeout(ctx, min(tempo, tempoLimiteMaximo))
	defer cancelar()

	// O go-mssqldb não aceita transação ReadOnly; lá vale o rollback e o usuário read-only.
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: c.Tipo != TipoSQLServer})
	if err != nil {
		return nil, classificar(ctx, err)
	}
	defer tx.Rollback()

	args := make([]any, len(req.Parametros))
	for i, p := range req.Parametros {
		args[i] = normalizarParametro(p)
	}
	linhas, err := tx.QueryContext(ctx, req.SQL, args...)
	if err != nil {
		return nil, classificar(ctx, err)
	}
	defer linhas.Close()

	tipos, err := linhas.ColumnTypes()
	if err != nil {
		return nil, classificar(ctx, err)
	}
	res := &protocolo.ResultadoConsulta{Colunas: make([]protocolo.Coluna, len(tipos)), Linhas: [][]any{}}
	for i, t := range tipos {
		res.Colunas[i] = protocolo.Coluna{Nome: t.Name(), Tipo: strings.ToUpper(t.DatabaseTypeName())}
	}

	valores := make([]any, len(tipos))
	ponteiros := make([]any, len(tipos))
	for i := range valores {
		ponteiros[i] = &valores[i]
	}
	for linhas.Next() {
		if len(res.Linhas) == limite {
			res.Truncado = true
			break
		}
		if err := linhas.Scan(ponteiros...); err != nil {
			return nil, classificar(ctx, err)
		}
		linha := make([]any, len(valores))
		for i, v := range valores {
			linha[i] = converterValor(v, res.Colunas[i].Tipo)
		}
		res.Linhas = append(res.Linhas, linha)
	}
	if err := linhas.Err(); err != nil && !res.Truncado {
		return nil, classificar(ctx, err)
	}
	res.DuracaoMs = time.Since(inicio).Milliseconds()
	return res, nil
}

func classificar(ctx context.Context, err error) error {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return &ErroConsulta{"tempo_esgotado", fmt.Errorf("a consulta excedeu o tempo limite: %w", err)}
	}
	return &ErroConsulta{"banco", err}
}
