package banco

import (
	"fmt"
	"net"
	"net/url"
	"strconv"
	"time"

	"github.com/go-sql-driver/mysql"

	"etiquetas/agente/internal/protocolo"
)

const (
	TipoPostgres  = "POSTGRES"
	TipoMySQL     = "MYSQL"
	TipoSQLServer = "SQLSERVER"

	nomeAplicacao = "etiquetas-agente"
	tempoConexao  = 10 * time.Second
)

// driverEDSN devolve o nome do driver database/sql e a string de conexão.
func driverEDSN(c protocolo.Conexao) (string, string, error) {
	switch c.Tipo {
	case TipoPostgres:
		q := url.Values{}
		q.Set("sslmode", valorOu(c.Opcoes.SSL, "prefer"))
		q.Set("connect_timeout", strconv.Itoa(int(tempoConexao.Seconds())))
		q.Set("application_name", nomeAplicacao)
		u := url.URL{
			Scheme:   "postgres",
			User:     url.UserPassword(c.Usuario, c.Senha),
			Host:     net.JoinHostPort(c.Host, strconv.Itoa(c.Porta)),
			Path:     "/" + c.Banco,
			RawQuery: q.Encode(),
		}
		return "pgx", u.String(), nil

	case TipoMySQL:
		cfg := mysql.NewConfig()
		cfg.User = c.Usuario
		cfg.Passwd = c.Senha
		cfg.Net = "tcp"
		cfg.Addr = net.JoinHostPort(c.Host, strconv.Itoa(c.Porta))
		cfg.DBName = c.Banco
		cfg.ParseTime = true
		cfg.Timeout = tempoConexao
		cfg.MultiStatements = false
		cfg.Params = map[string]string{"charset": "utf8mb4"}
		switch c.Opcoes.SSL {
		case "true", "require", "verify-full":
			cfg.TLSConfig = "true"
		case "skip-verify":
			cfg.TLSConfig = "skip-verify"
		case "", "false", "disable":
			cfg.TLSConfig = "preferred"
		default:
			return "", "", fmt.Errorf("modo de SSL inválido para MySQL: %s", c.Opcoes.SSL)
		}
		return "mysql", cfg.FormatDSN(), nil

	case TipoSQLServer:
		q := url.Values{}
		q.Set("database", c.Banco)
		q.Set("app name", nomeAplicacao)
		q.Set("dial timeout", strconv.Itoa(int(tempoConexao.Seconds())))
		switch c.Opcoes.SSL {
		case "":
		case "disable", "false", "true":
			q.Set("encrypt", c.Opcoes.SSL)
		case "skip-verify":
			q.Set("encrypt", "true")
			q.Set("TrustServerCertificate", "true")
		default:
			return "", "", fmt.Errorf("modo de SSL inválido para SQL Server: %s", c.Opcoes.SSL)
		}
		u := url.URL{Scheme: "sqlserver", User: url.UserPassword(c.Usuario, c.Senha), RawQuery: q.Encode()}
		if c.Opcoes.Instancia != "" {
			// Instância nomeada: a porta é descoberta pelo SQL Browser, salvo se informada.
			u.Host = c.Host
			if c.Porta != 0 && c.Porta != 1433 {
				u.Host = net.JoinHostPort(c.Host, strconv.Itoa(c.Porta))
			}
			u.Path = "/" + c.Opcoes.Instancia
		} else {
			u.Host = net.JoinHostPort(c.Host, strconv.Itoa(c.Porta))
		}
		return "sqlserver", u.String(), nil
	}
	return "", "", fmt.Errorf("tipo de banco desconhecido: %s", c.Tipo)
}

// consultaVersao é usada no teste de conexão.
func consultaVersao(tipo string) string {
	if tipo == TipoSQLServer {
		return "SELECT @@VERSION"
	}
	return "SELECT version()"
}

func valorOu(v, padrao string) string {
	if v == "" {
		return padrao
	}
	return v
}
