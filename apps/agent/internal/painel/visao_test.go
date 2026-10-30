package painel

import (
	"strings"
	"testing"
	"time"

	"etiquetas/agente/internal/estado"
)

func TestSituacao(t *testing.T) {
	agora := time.Now()
	recente := func(s string) *estado.Instantaneo {
		return &estado.Instantaneo{Situacao: s, Ativado: true, AtualizadoEm: agora.Add(-3 * time.Second)}
	}
	antigo := &estado.Instantaneo{Situacao: estado.Conectado, Ativado: true, AtualizadoEm: agora.Add(-time.Minute)}
	proxima := agora.Add(30 * time.Second)
	desconectado := recente(estado.Desconectado)
	desconectado.Detalhe = "Sem conexão com o servidor. Verifique a internet deste computador."
	desconectado.ProximaTentativa = &proxima

	casos := []struct {
		nome, servico string
		st            *estado.Instantaneo
		config        bool
		quer          string
	}{
		{"status recente vale mesmo sem serviço (rodando no console)", ServicoNaoInstalado, recente(estado.Conectado), false, estado.Conectado},
		{"iniciando aparece como conectando", ServicoRodando, recente(estado.Iniciando), false, estado.Conectando},
		{"sem serviço e sem status: ativar", ServicoNaoInstalado, nil, false, NaoAtivado},
		{"ativado pela versão antiga, sem serviço: instalar", ServicoNaoInstalado, nil, true, FaltaInstalar},
		{"status recente ganha de falta instalar", ServicoNaoInstalado, recente(estado.Conectado), true, estado.Conectado},
		{"serviço parou porque não está ativado", ServicoParado, &estado.Instantaneo{Ativado: false, AtualizadoEm: agora.Add(-time.Hour)}, false, NaoAtivado},
		{"serviço parado", ServicoParado, antigo, false, estado.Parado},
		{"status gravado como parado", ServicoRodando, &estado.Instantaneo{Situacao: estado.Parado, Ativado: true, AtualizadoEm: agora}, false, SemResposta},
		{"rodando sem atualizar o status", ServicoRodando, antigo, false, SemResposta},
		{"recusado", ServicoRodando, recente(estado.Recusado), false, estado.Recusado},
		{"desconectado", ServicoRodando, desconectado, false, estado.Desconectado},
	}
	for _, c := range casos {
		s, titulo, descricao := Situacao(c.servico, c.st, c.config, agora)
		if s != c.quer {
			t.Errorf("%s: situação %q, esperava %q", c.nome, s, c.quer)
		}
		if titulo == "" || descricao == "" {
			t.Errorf("%s: título/descrição vazios", c.nome)
		}
	}
	_, _, d := Situacao(ServicoRodando, desconectado, false, agora)
	if want := "Nova tentativa às " + proxima.Format("15:04:05"); !strings.Contains(d, want) {
		t.Errorf("descrição sem o horário da nova tentativa: %q", d)
	}
}
