package estado

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

func TestGravarELerSemSegredos(t *testing.T) {
	caminho := filepath.Join(t.TempDir(), "sub", "status.json")
	e := Novo(caminho, Instantaneo{Versao: "1.0", CNPJ: "11.222.333/0001-81", Ativado: true})
	e.Atualizar(func(i *Instantaneo) { i.Situacao, i.ConexoesBanco = Conectado, 2 })
	if err := e.Gravar(); err != nil {
		t.Fatal(err)
	}
	lido, err := Ler(caminho)
	if err != nil {
		t.Fatal(err)
	}
	if lido.Situacao != Conectado || lido.ConexoesBanco != 2 || lido.CNPJ != "11.222.333/0001-81" || lido.PID == 0 {
		t.Fatalf("status lido diferente: %+v", lido)
	}
	if time.Since(lido.AtualizadoEm) > time.Minute {
		t.Error("AtualizadoEm não foi preenchido")
	}
}

func TestManterGravaParadoAoTerminar(t *testing.T) {
	caminho := filepath.Join(t.TempDir(), "status.json")
	e := Novo(caminho, Instantaneo{Ativado: true})
	ctx, cancelar := context.WithCancel(context.Background())
	fim := make(chan struct{})
	go func() {
		e.Manter(ctx)
		close(fim)
	}()
	e.Atualizar(func(i *Instantaneo) { i.Situacao = Conectado })
	time.Sleep(400 * time.Millisecond)
	if lido, err := Ler(caminho); err != nil || lido.Situacao != Conectado {
		t.Fatalf("esperava conectado: %+v %v", lido, err)
	}
	cancelar()
	<-fim
	if lido, _ := Ler(caminho); lido.Situacao != Parado {
		t.Fatalf("esperava parado, veio %q", lido.Situacao)
	}
}

func TestEventosRepetidosViramUm(t *testing.T) {
	e := Novo("", Instantaneo{})
	e.Evento("info", "Conectado ao servidor.")
	e.Evento("aviso", "Sem conexão: servidor fora do ar")
	e.Evento("aviso", "Sem conexão: servidor fora do ar")
	e.Evento("aviso", "Sem conexão: servidor fora do ar")
	ev := e.Copia().Eventos
	if len(ev) != 2 || ev[0].Vezes != 3 || ev[1].Mensagem != "Conectado ao servidor." {
		t.Fatalf("eventos inesperados: %+v", ev)
	}
	for i := 0; i < maxEventos+5; i++ {
		e.Evento("info", fmt.Sprint("evento ", i))
	}
	if n := len(e.Copia().Eventos); n != maxEventos {
		t.Errorf("lista deveria ter no máximo %d eventos, tem %d", maxEventos, n)
	}
	var nulo *Estado
	nulo.Evento("info", "ignorado") // Estado nil não pode quebrar
}
