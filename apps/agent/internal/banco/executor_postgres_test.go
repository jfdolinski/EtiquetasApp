package banco

import (
	"context"
	"errors"
	"os"
	"strconv"
	"strings"
	"testing"

	"etiquetas/agente/internal/protocolo"
)

// Teste de integração: AGENTE_TESTE_PG=host:porta:usuario:senha:banco go test ./internal/banco
func conexaoPostgresDeTeste(t *testing.T) protocolo.Conexao {
	partes := strings.Split(os.Getenv("AGENTE_TESTE_PG"), ":")
	if len(partes) != 5 {
		t.Skip("defina AGENTE_TESTE_PG=host:porta:usuario:senha:banco para rodar contra um PostgreSQL real")
	}
	porta, _ := strconv.Atoi(partes[1])
	return protocolo.Conexao{ID: "pg", Nome: "teste", Tipo: TipoPostgres, Host: partes[0], Porta: porta,
		Usuario: partes[2], Senha: partes[3], Banco: partes[4], Opcoes: protocolo.Opcoes{SSL: "disable"}}
}

func TestPostgresReal(t *testing.T) {
	ex := NovoExecutor()
	defer ex.Fechar()
	ex.Configurar([]protocolo.Conexao{conexaoPostgresDeTeste(t)})
	ctx := context.Background()

	teste, err := ex.Testar(ctx, "pg")
	if err != nil || !strings.HasPrefix(teste.VersaoServidor, "PostgreSQL") {
		t.Fatalf("testar: %+v %v", teste, err)
	}

	res, err := ex.Consultar(ctx, protocolo.Consultar{
		ConexaoID: "pg",
		SQL: `SELECT g AS codigo, 'Produto ' || g AS descricao, (g * 1.5)::numeric(10,2) AS preco,
		             DATE '2026-10-29' AS validade, gen_random_uuid() AS id, g % 2 = 0 AS par, NULL::text AS vazio
		      FROM generate_series(1, 5) g WHERE g >= $1 ORDER BY g`,
		Parametros:   []any{2},
		LimiteLinhas: 3,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !res.Truncado || len(res.Linhas) != 3 {
		t.Fatalf("esperava 3 linhas truncadas, veio %d (truncado=%v)", len(res.Linhas), res.Truncado)
	}
	nomes := []string{}
	for _, c := range res.Colunas {
		nomes = append(nomes, c.Nome)
	}
	if strings.Join(nomes, ",") != "codigo,descricao,preco,validade,id,par,vazio" {
		t.Fatalf("colunas: %v", nomes)
	}
	l := res.Linhas[0]
	if l[0] != int64(2) || l[1] != "Produto 2" || l[2] != "3.00" || l[3] != "2026-10-29" || l[5] != true || l[6] != nil {
		t.Fatalf("primeira linha: %#v", l)
	}
	if id, ok := l[4].(string); !ok || len(id) != 36 {
		t.Fatalf("uuid deveria virar texto: %#v", l[4])
	}

	var ec *ErroConsulta
	_, err = ex.Consultar(ctx, protocolo.Consultar{ConexaoID: "pg", SQL: "SELECT pg_sleep(3)", TempoLimiteSegundos: 1})
	if !errors.As(err, &ec) || ec.Codigo != "tempo_esgotado" {
		t.Fatalf("esperava tempo esgotado, veio %v", err)
	}

	_, err = ex.Consultar(ctx, protocolo.Consultar{ConexaoID: "pg", SQL: "DELETE FROM x"})
	if !errors.As(err, &ec) || ec.Codigo != "sql_recusado" {
		t.Fatalf("esperava sql_recusado, veio %v", err)
	}
}

func TestPostgresTransacaoSomenteLeitura(t *testing.T) {
	ex := NovoExecutor()
	defer ex.Fechar()
	c := conexaoPostgresDeTeste(t)
	ex.Configurar([]protocolo.Conexao{c})
	_, db, err := ex.obter("pg")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("CREATE SEQUENCE IF NOT EXISTS etq_agente_teste_seq"); err != nil {
		t.Skip("sem permissão para criar a sequence de teste:", err)
	}
	// Passa pelo validador (é um SELECT), mas escreve via função: a transação somente leitura recusa.
	_, err = ex.Consultar(context.Background(), protocolo.Consultar{ConexaoID: "pg", SQL: "SELECT nextval('etq_agente_teste_seq')"})
	var ec *ErroConsulta
	if !errors.As(err, &ec) || !strings.Contains(err.Error(), "read-only") {
		t.Fatalf("nextval() deveria falhar em transação somente leitura, veio %v", err)
	}
}

func TestConexaoDesconhecida(t *testing.T) {
	ex := NovoExecutor()
	_, err := ex.Consultar(context.Background(), protocolo.Consultar{ConexaoID: "nao-existe", SQL: "SELECT 1"})
	var ec *ErroConsulta
	if !errors.As(err, &ec) || ec.Codigo != "conexao_desconhecida" {
		t.Fatalf("veio %v", err)
	}
}
