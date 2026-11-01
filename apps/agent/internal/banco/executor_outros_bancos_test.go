package banco

import (
	"context"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"etiquetas/agente/internal/protocolo"
)

// Testes de integração, ligados no CI com bancos de verdade:
//
//	AGENTE_TESTE_MYSQL=host:porta:usuario:senha:banco
//	AGENTE_TESTE_MSSQL=host:porta:usuario:senha:banco
func conexaoDeTeste(t *testing.T, variavel, tipo string, opcoes protocolo.Opcoes) *Executor {
	t.Helper()
	partes := strings.Split(os.Getenv(variavel), ":")
	if len(partes) != 5 {
		t.Skipf("defina %s=host:porta:usuario:senha:banco para rodar contra um banco real", variavel)
	}
	porta, _ := strconv.Atoi(partes[1])
	ex := NovoExecutor()
	t.Cleanup(ex.Fechar)
	ex.Configurar([]protocolo.Conexao{{ID: "b", Nome: "teste", Tipo: tipo, Host: partes[0], Porta: porta, Usuario: partes[2], Senha: partes[3], Banco: partes[4], Opcoes: opcoes}})
	return ex
}

func consultar(t *testing.T, ex *Executor, sql string, parametros []any, limite int) *protocolo.ResultadoConsulta {
	t.Helper()
	ctx, cancelar := context.WithTimeout(context.Background(), time.Minute)
	defer cancelar()
	res, err := ex.Consultar(ctx, protocolo.Consultar{ConexaoID: "b", SQL: sql, Parametros: parametros, LimiteLinhas: limite})
	if err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return res
}

func recusada(t *testing.T, ex *Executor, sql string) {
	t.Helper()
	if _, err := ex.Consultar(context.Background(), protocolo.Consultar{ConexaoID: "b", SQL: sql, LimiteLinhas: 10}); err == nil {
		t.Fatalf("deveria recusar: %s", sql)
	}
}

func colunas(res *protocolo.ResultadoConsulta) string {
	nomes := []string{}
	for _, c := range res.Colunas {
		nomes = append(nomes, c.Nome)
	}
	return strings.Join(nomes, ",")
}

// Números e datas viram o mesmo formato dos outros bancos, para o layout não mudar conforme o ERP.
func conferirLinha(t *testing.T, l []any) {
	t.Helper()
	if s, ok := l[1].(string); !ok || s != "Café ação" {
		t.Errorf("texto com acento: %#v", l[1])
	}
	if s, ok := l[2].(string); !ok || s != "4.99" {
		t.Errorf("decimal: %#v", l[2])
	}
	if s, ok := l[3].(string); !ok || !strings.HasPrefix(s, "2026-10-29") {
		t.Errorf("data: %#v", l[3])
	}
	if l[4] != nil {
		t.Errorf("nulo: %#v", l[4])
	}
}

func TestMySQLReal(t *testing.T) {
	ex := conexaoDeTeste(t, "AGENTE_TESTE_MYSQL", TipoMySQL, protocolo.Opcoes{})
	teste, err := ex.Testar(context.Background(), "b")
	if err != nil {
		t.Fatalf("testar: %v", err)
	}
	t.Log("servidor:", teste.VersaoServidor)

	res := consultar(t, ex, `SELECT ? AS codigo, 'Café ação' AS descricao, CAST(4.99 AS DECIMAL(10,2)) AS preco, DATE '2026-10-29' AS validade, NULL AS vazio`, []any{"789"}, 10)
	if colunas(res) != "codigo,descricao,preco,validade,vazio" {
		t.Fatalf("colunas: %s", colunas(res))
	}
	if len(res.Linhas) != 1 {
		t.Fatalf("linhas: %d", len(res.Linhas))
	}
	conferirLinha(t, res.Linhas[0])

	truncado := consultar(t, ex, `SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3`, nil, 2)
	if !truncado.Truncado || len(truncado.Linhas) != 2 {
		t.Fatalf("limite: %d truncado=%v", len(truncado.Linhas), truncado.Truncado)
	}

	// Parâmetro ligado não vira SQL.
	injecao := consultar(t, ex, `SELECT ? AS valor`, []any{"'; DROP TABLE x; --"}, 10)
	if injecao.Linhas[0][0] != "'; DROP TABLE x; --" {
		t.Fatalf("parâmetro: %#v", injecao.Linhas[0][0])
	}

	recusada(t, ex, `DROP TABLE qualquer`)
	recusada(t, ex, `SELECT 1; DELETE FROM qualquer`)
	recusada(t, ex, `INSERT INTO qualquer VALUES (1)`)
}

func TestSQLServerReal(t *testing.T) {
	ex := conexaoDeTeste(t, "AGENTE_TESTE_MSSQL", TipoSQLServer, protocolo.Opcoes{SSL: "disable"})
	teste, err := ex.Testar(context.Background(), "b")
	if err != nil {
		t.Fatalf("testar: %v", err)
	}
	t.Log("servidor:", teste.VersaoServidor)

	res := consultar(t, ex, `SELECT @p1 AS codigo, N'Café ação' AS descricao, CAST(4.99 AS DECIMAL(10,2)) AS preco, CAST('2026-10-29' AS DATE) AS validade, CAST(NULL AS NVARCHAR(10)) AS vazio`, []any{"789"}, 10)
	if colunas(res) != "codigo,descricao,preco,validade,vazio" {
		t.Fatalf("colunas: %s", colunas(res))
	}
	if len(res.Linhas) != 1 {
		t.Fatalf("linhas: %d", len(res.Linhas))
	}
	conferirLinha(t, res.Linhas[0])

	truncado := consultar(t, ex, `SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3`, nil, 2)
	if !truncado.Truncado || len(truncado.Linhas) != 2 {
		t.Fatalf("limite: %d truncado=%v", len(truncado.Linhas), truncado.Truncado)
	}

	injecao := consultar(t, ex, `SELECT @p1 AS valor`, []any{"'; DROP TABLE x; --"}, 10)
	if injecao.Linhas[0][0] != "'; DROP TABLE x; --" {
		t.Fatalf("parâmetro: %#v", injecao.Linhas[0][0])
	}

	recusada(t, ex, `DROP TABLE qualquer`)
	recusada(t, ex, `SELECT 1; DELETE FROM qualquer`)
	recusada(t, ex, `EXEC sp_who`)
}
