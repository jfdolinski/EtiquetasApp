//go:build windows

package impressao

import (
	"context"
	"strings"
	"testing"
)

// Exercita a chamada real ao winspool.drv sem precisar de uma impressora instalada.
func TestSistemaImpressoraInexistente(t *testing.T) {
	err := Imprimir(context.Background(), MetodoSistema, "Impressora Que Nao Existe 123", "teste", []byte("^XA^XZ"))
	if err == nil || !strings.Contains(err.Error(), "não encontrada") {
		t.Fatalf("esperava erro de impressora não encontrada, veio %v", err)
	}
}
