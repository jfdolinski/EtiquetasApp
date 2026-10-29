// Package protocolo define as mensagens trocadas com a API pelo WebSocket.
// Espelho de apps/api/src/agentes/protocolo.ts; documentação em PROTOCOLO.md.
package protocolo

import "encoding/json"

const (
	Versao  = 1
	Caminho = "/api/agente/conectar"

	// Códigos de fechamento enviados pelo servidor.
	FechamentoSubstituido = 4000
	FechamentoRevogado    = 4001
	FechamentoBloqueado   = 4003
)

// Tipos de mensagem.
const (
	TipoOla             = "ola"
	TipoResposta        = "resposta"
	TipoConfiguracao    = "configuracao"
	TipoConsultar       = "consultar"
	TipoTestarConexao   = "testar_conexao"
	TipoRotacionarToken = "rotacionar_token"
)

// Mensagem é o envelope de todo frame. Dados é decodificado conforme o Tipo.
type Mensagem struct {
	Tipo  string          `json:"tipo"`
	ID    string          `json:"id,omitempty"`
	Dados json.RawMessage `json:"dados,omitempty"`
}

type Ola struct {
	Versao             string `json:"versao"`
	Protocolo          int    `json:"protocolo"`
	Hostname           string `json:"hostname"`
	SistemaOperacional string `json:"sistemaOperacional"`
}

type Opcoes struct {
	SSL                 string `json:"ssl,omitempty"`
	Instancia           string `json:"instancia,omitempty"`
	TempoLimiteSegundos int    `json:"tempoLimiteSegundos,omitempty"`
}

type Conexao struct {
	ID      string `json:"id"`
	Nome    string `json:"nome"`
	Tipo    string `json:"tipo"` // POSTGRES | MYSQL | SQLSERVER
	Host    string `json:"host"`
	Porta   int    `json:"porta"`
	Banco   string `json:"banco"`
	Usuario string `json:"usuario"`
	Senha   string `json:"senha"`
	Opcoes  Opcoes `json:"opcoes"`
}

type Configuracao struct {
	AgenteNome  string    `json:"agenteNome"`
	EmpresaNome string    `json:"empresaNome"`
	Conexoes    []Conexao `json:"conexoes"`
}

type Consultar struct {
	ConexaoID           string `json:"conexaoId"`
	SQL                 string `json:"sql"`
	Parametros          []any  `json:"parametros"`
	LimiteLinhas        int    `json:"limiteLinhas"`
	TempoLimiteSegundos int    `json:"tempoLimiteSegundos"`
}

type TestarConexao struct {
	ConexaoID string `json:"conexaoId"`
}

type RotacionarToken struct {
	Token string `json:"token"`
}

type Coluna struct {
	Nome string `json:"nome"`
	Tipo string `json:"tipo"`
}

type ResultadoConsulta struct {
	Colunas   []Coluna `json:"colunas"`
	Linhas    [][]any  `json:"linhas"`
	Truncado  bool     `json:"truncado"`
	DuracaoMs int64    `json:"duracaoMs"`
}

type ResultadoTeste struct {
	OK             bool   `json:"ok"`
	VersaoServidor string `json:"versaoServidor"`
	DuracaoMs      int64  `json:"duracaoMs"`
}

type Erro struct {
	Codigo   string `json:"codigo"`
	Mensagem string `json:"mensagem"`
}

type Resposta struct {
	OK        bool  `json:"ok"`
	Resultado any   `json:"resultado,omitempty"`
	Erro      *Erro `json:"erro,omitempty"`
}
