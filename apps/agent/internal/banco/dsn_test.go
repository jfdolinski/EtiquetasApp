package banco

import (
	"strings"
	"testing"
	"time"

	"etiquetas/agente/internal/protocolo"
)

func conexao(tipo string, porta int) protocolo.Conexao {
	return protocolo.Conexao{ID: "c1", Tipo: tipo, Host: "10.0.0.5", Porta: porta, Banco: "erp", Usuario: "leitor", Senha: "p@ss:/word"}
}

func TestDSNPostgres(t *testing.T) {
	driver, dsn, err := driverEDSN(conexao(TipoPostgres, 5432))
	if err != nil || driver != "pgx" {
		t.Fatal(driver, err)
	}
	for _, trecho := range []string{"postgres://leitor:p%40ss%3A%2Fword@10.0.0.5:5432/erp", "sslmode=prefer", "application_name=etiquetas-agente"} {
		if !strings.Contains(dsn, trecho) {
			t.Errorf("DSN sem %q: %s", trecho, dsn)
		}
	}
}

func TestDSNMySQL(t *testing.T) {
	c := conexao(TipoMySQL, 3306)
	c.Opcoes.SSL = "skip-verify"
	driver, dsn, err := driverEDSN(c)
	if err != nil || driver != "mysql" {
		t.Fatal(driver, err)
	}
	for _, trecho := range []string{"leitor:p@ss:/word@tcp(10.0.0.5:3306)/erp", "parseTime=true", "tls=skip-verify"} {
		if !strings.Contains(dsn, trecho) {
			t.Errorf("DSN sem %q: %s", trecho, dsn)
		}
	}
	if strings.Contains(dsn, "multiStatements=true") {
		t.Error("multiStatements deve ficar desligado")
	}
}

func TestDSNSQLServer(t *testing.T) {
	_, dsn, err := driverEDSN(conexao(TipoSQLServer, 1433))
	if err != nil || !strings.HasPrefix(dsn, "sqlserver://leitor:p%40ss%3A%2Fword@10.0.0.5:1433?") || !strings.Contains(dsn, "database=erp") {
		t.Fatal(dsn, err)
	}

	c := conexao(TipoSQLServer, 1433)
	c.Opcoes.Instancia = "SQLEXPRESS"
	_, dsn, _ = driverEDSN(c)
	if !strings.Contains(dsn, "@10.0.0.5/SQLEXPRESS?") {
		t.Errorf("instância nomeada sem porta: %s", dsn)
	}
}

func TestDSNInvalido(t *testing.T) {
	if _, _, err := driverEDSN(conexao("ORACLE", 1521)); err == nil {
		t.Error("tipo desconhecido deveria falhar")
	}
	c := conexao(TipoMySQL, 3306)
	c.Opcoes.SSL = "talvez"
	if _, _, err := driverEDSN(c); err == nil {
		t.Error("ssl inválido deveria falhar")
	}
}

func TestConverterValor(t *testing.T) {
	data := time.Date(2026, 10, 29, 13, 45, 0, 0, time.UTC)
	casos := []struct {
		nome  string
		valor any
		tipo  string
		quer  any
	}{
		{"nulo", nil, "TEXT", nil},
		{"texto em bytes (MySQL)", []byte("Arroz 5kg"), "VARCHAR", "Arroz 5kg"},
		{"decimal em bytes (SQL Server)", []byte("12.90"), "DECIMAL", "12.90"},
		{"binário vira base64", []byte{0xff, 0xfe}, "BLOB", "//4="},
		{"data", data, "DATE", "2026-10-29"},
		{"data e hora", data, "TIMESTAMP", "2026-10-29T13:45:00Z"},
		{"inteiro seguro", int64(7891234567895), "BIGINT", int64(7891234567895)},
		{"inteiro grande vira texto", int64(9007199254740993), "BIGINT", "9007199254740993"},
		{"uuid do SQL Server",
			[]byte{0x67, 0x45, 0x23, 0x01, 0xab, 0x89, 0xef, 0xcd, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef},
			"UNIQUEIDENTIFIER", "01234567-89AB-CDEF-0123-456789ABCDEF"},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			if got := converterValor(c.valor, c.tipo); got != c.quer {
				t.Fatalf("converterValor(%v) = %#v, quer %#v", c.valor, got, c.quer)
			}
		})
	}
}
