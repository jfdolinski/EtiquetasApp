// Package estado publica a situação do agente num arquivo JSON que o painel da
// bandeja lê. O serviço roda como SYSTEM, sem acesso à área de trabalho, então o
// painel (processo do usuário) só enxerga o que for gravado aqui. Nada de segredos:
// sem token, senhas ou SQL.
package estado

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Situações da conexão com o servidor.
const (
	Iniciando    = "iniciando"
	Conectando   = "conectando"
	Conectado    = "conectado"
	Desconectado = "desconectado"
	Bloqueado    = "bloqueado"
	Recusado     = "recusado" // token recusado: precisa de novo código de ativação
	Parado       = "parado"
)

const maxEventos = 40

type Evento struct {
	Hora     time.Time `json:"hora"`
	Nivel    string    `json:"nivel"` // info | aviso | erro
	Mensagem string    `json:"mensagem"`
	// Repetições seguidas da mesma mensagem viram um evento só.
	Vezes int `json:"vezes,omitempty"`
}

type Trabalho struct {
	Hora       time.Time `json:"hora"`
	Impressora string    `json:"impressora"`
	Nome       string    `json:"nome,omitempty"`
	OK         bool      `json:"ok"`
	Erro       string    `json:"erro,omitempty"`
}

// Instantaneo é o conteúdo do arquivo de status.
type Instantaneo struct {
	Versao      string `json:"versao"`
	PID         int    `json:"pid"`
	Servidor    string `json:"servidor"`
	CNPJ        string `json:"cnpj"`
	EmpresaNome string `json:"empresaNome"`
	AgenteNome  string `json:"agenteNome"`
	Ativado     bool   `json:"ativado"`

	Situacao         string     `json:"situacao"`
	Detalhe          string     `json:"detalhe,omitempty"`
	ConectadoDesde   *time.Time `json:"conectadoDesde,omitempty"`
	ProximaTentativa *time.Time `json:"proximaTentativa,omitempty"`
	IniciadoEm       time.Time  `json:"iniciadoEm"`

	ConexoesBanco  int       `json:"conexoesBanco"`
	Consultas      int       `json:"consultas"`
	Impressoes     int       `json:"impressoes"`
	ErrosImpressao int       `json:"errosImpressao"`
	UltimoTrabalho *Trabalho `json:"ultimoTrabalho,omitempty"`

	// Mais recente primeiro.
	Eventos      []Evento  `json:"eventos"`
	AtualizadoEm time.Time `json:"atualizadoEm"`
}

// Estado é seguro para uso concorrente. Um Estado nil ignora tudo (testes, Linux sem painel).
type Estado struct {
	mu      sync.Mutex
	inst    Instantaneo
	caminho string
	mudou   chan struct{}
}

// Novo: `caminho` vazio = só em memória.
func Novo(caminho string, base Instantaneo) *Estado {
	base.PID = os.Getpid()
	base.IniciadoEm = time.Now()
	if base.Situacao == "" {
		base.Situacao = Iniciando
	}
	return &Estado{inst: base, caminho: caminho, mudou: make(chan struct{}, 1)}
}

// Atualizar aplica a mudança e agenda a gravação.
func (e *Estado) Atualizar(f func(*Instantaneo)) {
	if e == nil {
		return
	}
	e.mu.Lock()
	f(&e.inst)
	e.mu.Unlock()
	select {
	case e.mudou <- struct{}{}:
	default:
	}
}

// Evento entra na lista de atividade recente: frases para o usuário, não log técnico.
func (e *Estado) Evento(nivel, mensagem string) {
	e.Atualizar(func(i *Instantaneo) {
		if len(i.Eventos) > 0 && i.Eventos[0].Mensagem == mensagem && i.Eventos[0].Nivel == nivel {
			i.Eventos[0].Hora = time.Now()
			i.Eventos[0].Vezes = max(i.Eventos[0].Vezes, 1) + 1
			return
		}
		i.Eventos = append([]Evento{{Hora: time.Now(), Nivel: nivel, Mensagem: mensagem}}, i.Eventos...)
		if len(i.Eventos) > maxEventos {
			i.Eventos = i.Eventos[:maxEventos]
		}
	})
}

// Copia devolve um instantâneo atual (para testes e para gravar).
func (e *Estado) Copia() Instantaneo {
	e.mu.Lock()
	defer e.mu.Unlock()
	c := e.inst
	c.Eventos = append([]Evento(nil), e.inst.Eventos...)
	return c
}

// Manter grava ao mudar (agrupando rajadas) e a cada 5 s, para o painel saber que o
// agente está vivo. Ao terminar o contexto, grava a situação "parado".
func (e *Estado) Manter(ctx context.Context) {
	if e == nil || e.caminho == "" {
		return
	}
	t := time.NewTicker(5 * time.Second)
	defer t.Stop()
	_ = e.Gravar()
	for {
		select {
		case <-ctx.Done():
			e.Atualizar(func(i *Instantaneo) {
				i.Situacao, i.Detalhe, i.ConectadoDesde, i.ProximaTentativa = Parado, "", nil, nil
			})
			_ = e.Gravar()
			return
		case <-e.mudou:
			time.Sleep(200 * time.Millisecond)
		case <-t.C:
		}
		_ = e.Gravar()
	}
}

// Gravar escreve de forma atômica. O painel pode estar lendo o arquivo no mesmo
// instante (o rename falha no Windows): tenta de novo algumas vezes.
func (e *Estado) Gravar() error {
	if e == nil || e.caminho == "" {
		return nil
	}
	c := e.Copia()
	c.AtualizadoEm = time.Now()
	dados, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(e.caminho), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(e.caminho), ".status-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(dados); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	for tentativa := 0; ; tentativa++ {
		err = os.Rename(tmp.Name(), e.caminho)
		if err == nil || tentativa == 4 {
			return err
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// Ler devolve o status gravado pelo agente.
func Ler(caminho string) (*Instantaneo, error) {
	dados, err := os.ReadFile(caminho)
	if err != nil {
		return nil, err
	}
	var i Instantaneo
	if err := json.Unmarshal(dados, &i); err != nil {
		return nil, err
	}
	return &i, nil
}
