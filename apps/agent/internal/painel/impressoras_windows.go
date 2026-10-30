//go:build windows

package painel

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"etiquetas/agente/internal/cliente"
	"etiquetas/agente/internal/config"
	"etiquetas/agente/internal/impressao"
)

// VisaoImpressoras é o que a aba Impressoras recebe.
type VisaoImpressoras struct {
	Sistema         []impressao.Encontrada         `json:"sistema"`
	ErroSistema     string                         `json:"erroSistema,omitempty"`
	Rede            []impressao.Encontrada         `json:"rede"`
	ProcurandoRede  bool                           `json:"procurandoRede"`
	RedeProcurada   bool                           `json:"redeProcurada"`
	ErroRede        string                         `json:"erroRede,omitempty"`
	Cadastradas     []cliente.ImpressoraCadastrada `json:"cadastradas"`
	ErroCadastradas string                         `json:"erroCadastradas,omitempty"`
	// O painel lê a chave do agente sozinho; senão, cadastrar pede administrador.
	CadastroDireto bool     `json:"cadastroDireto"`
	Operacao       Operacao `json:"operacao"`
}

type impressorasPainel struct {
	mu              sync.Mutex
	rede            []impressao.Encontrada
	procurando      bool
	procurada       bool
	erroRede        string
	cadastradas     []cliente.ImpressoraCadastrada
	erroCadastradas string
}

// credenciais do agente, quando este usuário consegue ler a configuração.
func (p *Painel) credenciais() (servidor, token string, ok bool) {
	cfg, err := config.Carregar(p.op.Config)
	if err != nil || !cfg.Ativado() {
		return "", "", false
	}
	return cfg.Servidor, cfg.Token, true
}

func (p *Painel) visaoImpressoras() VisaoImpressoras {
	sistema, err := impressao.ListarDoSistema()
	v := VisaoImpressoras{Sistema: sistema}
	if err != nil {
		v.ErroSistema = err.Error()
	}
	_, _, v.CadastroDireto = p.credenciais()
	p.imp.mu.Lock()
	v.Rede, v.ProcurandoRede, v.RedeProcurada, v.ErroRede = p.imp.rede, p.imp.procurando, p.imp.procurada, p.imp.erroRede
	v.Cadastradas, v.ErroCadastradas = p.imp.cadastradas, p.imp.erroCadastradas
	p.imp.mu.Unlock()
	p.mu.Lock()
	v.Operacao = p.operacao
	p.mu.Unlock()
	return v
}

// atualizarCadastradas busca no servidor as impressoras já ligadas a este agente.
func (p *Painel) atualizarCadastradas() {
	go func() {
		servidor, token, ok := p.credenciais()
		var lista []cliente.ImpressoraCadastrada
		var erro string
		if !ok {
			erro = "Para ver quais já estão cadastradas, abra o sistema em Impressoras."
		} else {
			ctx, cancelar := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancelar()
			l, err := cliente.ListarImpressoras(ctx, servidor, token)
			if err != nil {
				erro = "Não foi possível consultar o sistema: " + err.Error()
			}
			lista = l
		}
		p.imp.mu.Lock()
		if erro == "" || len(p.imp.cadastradas) == 0 {
			p.imp.cadastradas = lista
		}
		p.imp.erroCadastradas = erro
		p.imp.mu.Unlock()
	}()
}

func (p *Painel) procurarNaRede() {
	p.imp.mu.Lock()
	if p.imp.procurando {
		p.imp.mu.Unlock()
		return
	}
	p.imp.procurando, p.imp.erroRede = true, ""
	p.imp.mu.Unlock()
	go func() {
		ctx, cancelar := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancelar()
		achadas, err := impressao.ProcurarNaRede(ctx)
		p.imp.mu.Lock()
		p.imp.rede, p.imp.procurando, p.imp.procurada = achadas, false, true
		if err != nil {
			p.imp.erroRede = err.Error()
		}
		p.imp.mu.Unlock()
	}()
}

func (p *Painel) definirOperacao(op Operacao) {
	p.mu.Lock()
	p.operacao = op
	p.mu.Unlock()
}

func (p *Painel) ocupado() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.operacao.Andamento
}

// testarImpressora manda uma etiqueta de teste direto daqui (não passa pelo servidor).
func (p *Painel) testarImpressora(metodo, endereco, nome, linguagem string, dpi int) error {
	dados, err := impressao.EtiquetaDeTeste(linguagem, dpi, nome)
	if err != nil {
		return err
	}
	if p.ocupado() {
		return errors.New("Aguarde a ação em andamento terminar.")
	}
	p.definirOperacao(Operacao{Andamento: true, Titulo: "Enviando etiqueta de teste para " + nome + "…"})
	go func() {
		ctx, cancelar := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancelar()
		if err := impressao.Imprimir(ctx, metodo, endereco, "Teste do Agente de Etiquetas", dados); err != nil {
			p.definirOperacao(Operacao{Erro: "O teste não foi impresso: " + err.Error()})
			return
		}
		p.definirOperacao(Operacao{OK: fmt.Sprintf("Teste enviado para %s em %s. Se saiu em branco ou com símbolos, troque a linguagem e teste de novo.", nome, linguagem)})
	}()
	return nil
}

// cadastrarImpressora cria a impressora no sistema, ligada a este agente.
func (p *Painel) cadastrarImpressora(nome, linguagem string, dpi int, metodo, endereco, modelo string) error {
	nome = strings.TrimSpace(nome)
	if len([]rune(nome)) < 2 {
		return errors.New("Dê um nome para a impressora (ex.: Etiquetas do balcão).")
	}
	if p.ocupado() {
		return errors.New("Aguarde a ação em andamento terminar.")
	}
	nova := cliente.NovaImpressora{Nome: nome, Linguagem: linguagem, DPI: dpi, Metodo: metodo, Endereco: endereco, Modelo: modelo}
	servidor, token, direto := p.credenciais()
	if !direto {
		// Sem acesso à configuração: o próprio agente cadastra, como administrador.
		go func() {
			if p.acaoAdmin("Cadastrando a impressora…", "Impressora cadastrada no sistema.", "impressora",
				"-nome", nova.Nome, "-linguagem", nova.Linguagem, "-dpi", strconv.Itoa(nova.DPI), "-metodo", nova.Metodo, "-endereco", nova.Endereco, "-modelo", nova.Modelo, "-config", p.op.Config) {
				p.lembrarCadastrada(nova)
			}
		}()
		return nil
	}
	p.definirOperacao(Operacao{Andamento: true, Titulo: "Cadastrando a impressora…"})
	go func() {
		ctx, cancelar := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancelar()
		r, err := cliente.CadastrarImpressora(ctx, servidor, token, nova)
		if err != nil {
			p.definirOperacao(Operacao{Erro: "Não foi possível cadastrar: " + err.Error()})
			return
		}
		msg := fmt.Sprintf("Impressora “%s” cadastrada no sistema. Escolha-a no modelo de etiqueta (Impressora padrão).", r.Nome)
		if r.JaExistia {
			msg = fmt.Sprintf("Esta impressora já estava cadastrada como “%s”.", r.Nome)
		}
		p.definirOperacao(Operacao{OK: msg})
		p.atualizarCadastradas()
	}()
	return nil
}

// lembrarCadastrada marca como cadastrada mesmo sem poder consultar o servidor.
func (p *Painel) lembrarCadastrada(n cliente.NovaImpressora) {
	p.imp.mu.Lock()
	defer p.imp.mu.Unlock()
	p.imp.cadastradas = append(p.imp.cadastradas, cliente.ImpressoraCadastrada{Nome: n.Nome, Linguagem: n.Linguagem, DPI: n.DPI, Metodo: n.Metodo, Endereco: n.Endereco, Ativo: true})
}
