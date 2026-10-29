package banco

import "testing"

func TestValidarSomenteLeitura(t *testing.T) {
	casos := []struct {
		nome, tipo, sql string
		ok              bool
	}{
		{"select simples", TipoPostgres, "SELECT codigo, descricao FROM produtos WHERE ativo", true},
		{"with + ponto e vírgula final", TipoPostgres, "WITH x AS (SELECT 1) SELECT * FROM x;  ", true},
		{"minúsculas e comentário", TipoMySQL, "-- produtos do dia\nselect * from produtos # fim", true},
		{"palavra proibida dentro de string", TipoPostgres, "SELECT 'DROP TABLE x; DELETE' AS t", true},
		{"identificador entre aspas", TipoPostgres, `SELECT "update" FROM t`, true},
		{"colchetes do SQL Server", TipoSQLServer, "SELECT [delete], [a]]b] FROM t", true},
		{"crase do MySQL", TipoMySQL, "SELECT `insert` FROM t", true},
		{"parâmetros do PostgreSQL", TipoPostgres, "SELECT * FROM t WHERE a = $1 AND b = $2", true},
		{"dollar quote", TipoPostgres, "SELECT $tag$ ; DROP TABLE x $tag$", true},
		{"coluna com prefixo proibido", TipoPostgres, "SELECT updated_at, inserted FROM t", true},

		{"vazio", TipoPostgres, "  -- nada\n", false},
		{"update", TipoPostgres, "UPDATE produtos SET preco = 0", false},
		{"dois comandos", TipoPostgres, "SELECT 1; SELECT 2", false},
		{"select into", TipoSQLServer, "SELECT * INTO copia FROM produtos", false},
		{"cte com delete", TipoPostgres, "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d", false},
		{"lote do SQL Server sem ponto e vírgula", TipoSQLServer, "SELECT 1 DROP TABLE produtos", false},
		{"exec", TipoSQLServer, "SELECT 1 EXEC xp_cmdshell 'dir'", false},
		{"commit no meio", TipoSQLServer, "SELECT 1 COMMIT", false},
		{"into outfile", TipoMySQL, "SELECT * FROM t INTO OUTFILE '/tmp/x'", false},
		{"comentário executável do MySQL", TipoMySQL, "SELECT 1 /*! ; DROP TABLE t */", false},
		{"string sem fechamento", TipoPostgres, "SELECT 'abc", false},
		{"for update", TipoPostgres, "SELECT * FROM t FOR UPDATE", false},

		// Tentativas de esconder comandos explorando diferenças de lexer entre bancos.
		{"barra no MySQL fecha mais tarde", TipoMySQL, `SELECT 'a\' , ' ; DROP TABLE x; -- '`, false},
		{"barra no SQL Server não escapa", TipoSQLServer, `SELECT 'a\'; COMMIT; DROP TABLE x; --'`, false},
		{"string E do PostgreSQL", TipoPostgres, `SELECT E'\' , ' ; DROP TABLE x; -- '`, false},
		{"colchete com ]] escapado", TipoSQLServer, "SELECT [a]]'] ; DROP TABLE x; --'", false},
		{"comentário aninhado no PostgreSQL", TipoPostgres, "SELECT 1 /* /* */ ' */ ; DROP TABLE x; -- '", false},
		{"comentário aninhado no SQL Server", TipoSQLServer, "SELECT 1 /* /* */ ' */ DROP TABLE x -- '", false},
		{"# não é comentário no PostgreSQL", TipoPostgres, "SELECT 1 # 2 ; DROP TABLE x", false},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			err := ValidarSomenteLeitura(c.sql, c.tipo)
			if c.ok && err != nil {
				t.Fatalf("deveria aceitar, recusou: %v", err)
			}
			if !c.ok && err == nil {
				t.Fatalf("deveria recusar: %s", c.sql)
			}
		})
	}
}

func TestValidarTipoDesconhecido(t *testing.T) {
	if ValidarSomenteLeitura("SELECT 1", "ORACLE") == nil {
		t.Fatal("deveria recusar tipo desconhecido")
	}
}
