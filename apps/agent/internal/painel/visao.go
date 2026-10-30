// Package painel é o aplicativo da bandeja do Windows (ícone ao lado do relógio e
// janela de status). O agente de verdade roda como serviço; o painel só lê o status
// que o serviço publica (pacote estado) e, quando preciso, pede permissão de
// administrador para ativar, iniciar ou reiniciar o serviço.
package painel

import (
	"fmt"
	"time"

	"etiquetas/agente/internal/estado"
)

// Situação do serviço no Windows.
const (
	ServicoNaoInstalado = "nao_instalado"
	ServicoParado       = "parado"
	ServicoIniciando    = "iniciando"
	ServicoRodando      = "rodando"
	ServicoParando      = "parando"
	ServicoDesconhecido = "desconhecido"
)

// Situações mostradas no painel (além das de estado.*).
const (
	NaoAtivado  = "nao_ativado"
	SemResposta = "sem_resposta"
	// Ativado (há token), mas sem o serviço: versão antiga rodando pela pasta Inicializar
	// ou ativação feita só com `ativar`. Basta instalar, sem código novo.
	FaltaInstalar = "falta_instalar"
)

// Sem atualização do status por mais que isso, o agente não está vivo.
const validadeStatus = 20 * time.Second

// Operacao acompanha uma ação que pediu permissão de administrador.
type Operacao struct {
	Andamento bool   `json:"andamento"`
	Titulo    string `json:"titulo,omitempty"`
	OK        string `json:"ok,omitempty"`
	Erro      string `json:"erro,omitempty"`
}

// Visao é o que a página do painel recebe a cada atualização.
type Visao struct {
	Situacao       string              `json:"situacao"`
	Titulo         string              `json:"titulo"`
	Descricao      string              `json:"descricao"`
	Servico        string              `json:"servico"`
	Status         *estado.Instantaneo `json:"status,omitempty"`
	ServidorPadrao string              `json:"servidorPadrao"`
	Versao         string              `json:"versao"`
	Operacao       Operacao            `json:"operacao"`
	// Cópias antigas do agente na pasta Inicializar do usuário (disputam o token com o serviço).
	CopiasAntigas []string `json:"copiasAntigas,omitempty"`
	// O agente está publicando o status agora (os números de execução valem).
	AgenteRodando bool `json:"agenteRodando"`
	// Este painel é uma versão aberta fora de Arquivos de Programas e o agente já está
	// instalado: "Atualizar" copia esta versão e reinicia o serviço.
	PodeAtualizar bool `json:"podeAtualizar"`
	// Aba que a página deve abrir (pedido do menu do ícone), entregue uma vez.
	Aba string `json:"aba,omitempty"`
}

// StatusRecente: o agente atualizou o status há pouco e não está parado.
func StatusRecente(st *estado.Instantaneo, agora time.Time) bool {
	return st != nil && agora.Sub(st.AtualizadoEm) < validadeStatus && st.Situacao != estado.Parado
}

// Situacao combina o estado do serviço com o status publicado por ele. configAtivada:
// a configuração local tem token (o painel nem sempre consegue lê-la).
func Situacao(servico string, st *estado.Instantaneo, configAtivada bool, agora time.Time) (situacao, titulo, descricao string) {
	fresco := StatusRecente(st, agora)
	switch {
	case fresco:
		situacao = st.Situacao
		if situacao == estado.Iniciando {
			situacao = estado.Conectando
		}
	case servico == ServicoNaoInstalado && configAtivada:
		situacao = FaltaInstalar
	case st != nil && !st.Ativado:
		situacao = NaoAtivado
	case servico == ServicoNaoInstalado:
		situacao = NaoAtivado
	case servico == ServicoParado || servico == ServicoParando:
		situacao = estado.Parado
	case servico == ServicoIniciando:
		situacao = estado.Conectando
	default:
		situacao = SemResposta
	}

	detalhe := ""
	if st != nil && fresco {
		detalhe = st.Detalhe
	}
	switch situacao {
	case estado.Conectado:
		return situacao, "Conectado", "Pronto para consultar o ERP e imprimir etiquetas."
	case estado.Conectando:
		return situacao, "Conectando…", "Falando com o servidor do Sistema de Etiquetas."
	case estado.Desconectado:
		d := detalhe
		if d == "" {
			d = "Sem conexão com o servidor."
		}
		if st.ProximaTentativa != nil {
			d += fmt.Sprintf(" Nova tentativa às %s.", st.ProximaTentativa.Local().Format("15:04:05"))
		}
		return situacao, "Sem conexão", d
	case estado.Bloqueado:
		return situacao, "Empresa bloqueada", "O acesso da empresa está bloqueado no sistema. Fale com o suporte."
	case estado.Recusado:
		return situacao, "Precisa ativar de novo", "O servidor recusou a chave deste computador. Gere um novo código em Agentes, no sistema, e ative abaixo."
	case estado.Parado:
		return situacao, "Agente parado", "O serviço do agente não está rodando neste computador."
	case FaltaInstalar:
		return situacao, "Falta instalar o agente", "Este computador já está ativado. Instale o agente para ele funcionar em segundo plano e iniciar junto com o Windows."
	case NaoAtivado:
		return situacao, "Agente não ativado", "Informe o CNPJ da empresa e o código de ativação gerado no sistema, em Agentes."
	}
	return SemResposta, "Sem resposta do agente", "O serviço está instalado, mas não está informando o status. Tente reiniciar."
}
