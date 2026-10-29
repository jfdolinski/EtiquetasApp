package impressao

import (
	"bytes"
	"context"
	"io"
	"net"
	"strings"
	"testing"
	"time"
)

// impressoraFalsa escuta numa porta local e devolve o que recebeu.
func impressoraFalsa(t *testing.T) (string, <-chan []byte) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	recebido := make(chan []byte, 1)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		dados, _ := io.ReadAll(conn)
		recebido <- dados
	}()
	return ln.Addr().String(), recebido
}

func TestImprimirRede(t *testing.T) {
	endereco, recebido := impressoraFalsa(t)
	zpl := []byte(strings.Repeat("^XA^FO10,10^A0N,30^FDAçúcar^FS^XZ\n", 2000))
	if err := Imprimir(context.Background(), MetodoRede, endereco, "teste", zpl); err != nil {
		t.Fatal(err)
	}
	select {
	case dados := <-recebido:
		if !bytes.Equal(dados, zpl) {
			t.Fatalf("recebeu %d bytes, esperava %d iguais", len(dados), len(zpl))
		}
	case <-time.After(5 * time.Second):
		t.Fatal("a impressora não recebeu os dados")
	}
}

func TestImprimirRedeRecusada(t *testing.T) {
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	endereco := ln.Addr().String()
	ln.Close() // porta fechada
	err := Imprimir(context.Background(), MetodoRede, endereco, "teste", []byte("x"))
	if err == nil || !strings.Contains(err.Error(), "não foi possível conectar") {
		t.Fatalf("esperava erro de conexão, veio %v", err)
	}
}

func TestValidacoes(t *testing.T) {
	casos := map[string]func() error{
		"sem dados":          func() error { return Imprimir(context.Background(), MetodoRede, "127.0.0.1:9100", "x", nil) },
		"endereço sem porta": func() error { return Imprimir(context.Background(), MetodoRede, "127.0.0.1", "x", []byte("x")) },
		"método":             func() error { return Imprimir(context.Background(), "USB", "x", "x", []byte("x")) },
		"sistema sem nome":   func() error { return Imprimir(context.Background(), MetodoSistema, "", "x", []byte("x")) },
	}
	for nome, f := range casos {
		if f() == nil {
			t.Errorf("%s: esperava erro", nome)
		}
	}
}
