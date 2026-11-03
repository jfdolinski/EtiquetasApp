package banco

import (
	"context"
	"fmt"
	"testing"

	"etiquetas/agente/internal/protocolo"
)

// O filtro que a API põe em volta do SQL do cliente (packages/shared/src/buscaNoBanco.ts, formato
// conferido em buscaNoBanco.test.ts), contra os bancos de verdade: sintaxe de cada um, acento e
// validador de somente leitura. Mudou lá, muda aqui.
func filtroPorCodigo(base, coluna, parametro string) string {
	return fmt.Sprintf("SELECT * FROM (\n%s\n) etiquetas_busca WHERE %s = %s", base, coluna, parametro)
}

func filtroPorTexto(base, colunaComoTexto, parametro string) string {
	return fmt.Sprintf("SELECT * FROM (\n%s\n) etiquetas_busca WHERE LOWER(%s) LIKE %s ESCAPE '!'", base, colunaComoTexto, parametro)
}

type bancoDeBusca struct {
	base                     string
	codigo, descricao, param string
}

func conferirBusca(t *testing.T, ex *Executor, b bancoDeBusca) {
	t.Helper()
	exata := consultar(t, ex, filtroPorCodigo(b.base, b.codigo, b.param), []any{"790"}, 10)
	if len(exata.Linhas) != 1 || exata.Linhas[0][1] != "CAFÉ forte" {
		t.Fatalf("código exato: %#v", exata.Linhas)
	}
	// "cafe" sem acento vira c_f_ e acha "Café" e "CAFÉ", em qualquer caixa.
	contem := consultar(t, ex, filtroPorTexto(b.base, b.descricao, b.param), []any{"%__f_%"}, 10)
	if len(contem.Linhas) != 2 {
		t.Fatalf("texto contido: %#v", contem.Linhas)
	}
	// "%" escapado é o caractere, não coringa.
	literal := consultar(t, ex, filtroPorTexto(b.base, b.descricao, b.param), []any{"%10!%%"}, 10)
	if len(literal.Linhas) != 1 || literal.Linhas[0][0] != "791" {
		t.Fatalf("coringa escapado: %#v", literal.Linhas)
	}
	nada := consultar(t, ex, filtroPorTexto(b.base, b.descricao, b.param), []any{"%inexistente%"}, 10)
	if len(nada.Linhas) != 0 {
		t.Fatalf("sem resultado: %#v", nada.Linhas)
	}
	// Termo malicioso continua sendo só um valor.
	injecao := consultar(t, ex, filtroPorCodigo(b.base, b.codigo, b.param), []any{"' OR 1=1 --"}, 10)
	if len(injecao.Linhas) != 0 {
		t.Fatalf("parâmetro virou SQL: %#v", injecao.Linhas)
	}
}

func TestFiltroNoBancoPostgres(t *testing.T) {
	ex := NovoExecutor()
	defer ex.Fechar()
	ex.Configurar([]protocolo.Conexao{conexaoPostgresDeTeste(t)})
	base := `SELECT '789' AS ean, 'Café moído' AS descricao UNION ALL SELECT '790', 'CAFÉ forte' UNION ALL SELECT '791', 'Desconto 10% arroz' ORDER BY ean`
	ctx := context.Background()
	for nome, c := range map[string]struct {
		sql, param string
		quantas    int
	}{
		"exata":   {filtroPorCodigo(base, `"ean"`, "$1"), "790", 1},
		"contem":  {filtroPorTexto(base, `CAST("descricao" AS TEXT)`, "$1"), "%__f_%", 2},
		"literal": {filtroPorTexto(base, `CAST("descricao" AS TEXT)`, "$1"), "%10!%%", 1},
		"nada":    {filtroPorTexto(base, `CAST("descricao" AS TEXT)`, "$1"), "%inexistente%", 0},
		"injecao": {filtroPorCodigo(base, `"ean"`, "$1"), "' OR 1=1 --", 0},
	} {
		res, err := ex.Consultar(ctx, protocolo.Consultar{ConexaoID: "pg", SQL: c.sql, Parametros: []any{c.param}, LimiteLinhas: 10})
		if err != nil {
			t.Fatalf("%s: %v", nome, err)
		}
		if len(res.Linhas) != c.quantas {
			t.Fatalf("%s: %#v", nome, res.Linhas)
		}
	}
	// Coluna numérica precisa da conversão: é o que a API gera para código numérico.
	numerico := `SELECT 790 AS codigo, 'x' AS descricao`
	res, err := ex.Consultar(ctx, protocolo.Consultar{ConexaoID: "pg", SQL: filtroPorCodigo(numerico, `CAST("codigo" AS TEXT)`, "$1"), Parametros: []any{"790"}, LimiteLinhas: 10})
	if err != nil || len(res.Linhas) != 1 {
		t.Fatalf("código numérico: %#v %v", res, err)
	}
}

func TestFiltroNoBancoMySQL(t *testing.T) {
	ex := conexaoDeTeste(t, "AGENTE_TESTE_MYSQL", TipoMySQL, protocolo.Opcoes{})
	conferirBusca(t, ex, bancoDeBusca{
		base:      `SELECT '789' AS ean, 'Café moído' AS descricao UNION ALL SELECT '790', 'CAFÉ forte' UNION ALL SELECT '791', 'Desconto 10% arroz' ORDER BY ean`,
		codigo:    "`ean`",
		descricao: "CAST(`descricao` AS CHAR)",
		param:     "?",
	})
	numerico := consultar(t, ex, filtroPorCodigo(`SELECT 790 AS codigo, 'x' AS descricao`, "CAST(`codigo` AS CHAR)", "?"), []any{"790"}, 10)
	if len(numerico.Linhas) != 1 {
		t.Fatalf("código numérico: %#v", numerico.Linhas)
	}
}

func TestFiltroNoBancoSQLServer(t *testing.T) {
	ex := conexaoDeTeste(t, "AGENTE_TESTE_MSSQL", TipoSQLServer, protocolo.Opcoes{SSL: "disable"})
	base := `SELECT N'789' AS ean, N'Café moído' AS descricao UNION ALL SELECT N'790', N'CAFÉ forte' UNION ALL SELECT N'791', N'Desconto 10% arroz'`
	conferirBusca(t, ex, bancoDeBusca{base: base, codigo: "[ean]", descricao: "CAST([descricao] AS NVARCHAR(4000))", param: "@p1"})
	numerico := consultar(t, ex, filtroPorCodigo(`SELECT 790 AS codigo, N'x' AS descricao`, "CAST([codigo] AS NVARCHAR(4000))", "@p1"), []any{"790"}, 10)
	if len(numerico.Linhas) != 1 {
		t.Fatalf("código numérico: %#v", numerico.Linhas)
	}
	// ORDER BY em subconsulta: o SQL Server recusa, e a API volta a ler as linhas. Tem que dar erro, não resultado errado.
	if _, err := ex.Consultar(context.Background(), protocolo.Consultar{ConexaoID: "b", SQL: filtroPorCodigo(base+" ORDER BY ean", "[ean]", "@p1"), Parametros: []any{"790"}, LimiteLinhas: 10}); err == nil {
		t.Fatal("o SQL Server deveria recusar ORDER BY na subconsulta")
	}
}
