package painel

import (
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"etiquetas/agente/internal/estado"
)

func TestBaloesNovos(t *testing.T) {
	agora := time.Date(2026, 11, 2, 10, 0, 0, 0, time.UTC)
	n := func(id string, atras time.Duration) estado.Notificacao {
		return estado.Notificacao{ID: id, Hora: agora.Add(-atras)}
	}
	// O status guarda do mais novo para o mais antigo.
	lista := []estado.Notificacao{n("e", 0), n("d", time.Minute), n("c", 2*time.Minute), n("b", 3*time.Minute), n("a", 4*time.Minute), n("velha", 13*time.Hour)}

	baloes, resto := BaloesNovos(lista, map[string]bool{"d": true}, agora)
	var ids []string
	for _, b := range baloes {
		ids = append(ids, b.ID)
	}
	if !reflect.DeepEqual(ids, []string{"b", "c", "e"}) || resto != 1 {
		t.Fatalf("balões %v, excedentes %d", ids, resto)
	}
	if b, r := BaloesNovos(lista[:1], map[string]bool{"e": true}, agora); len(b) != 0 || r != 0 {
		t.Fatalf("já visto voltou: %v", b)
	}
}

func TestVistasGuardadasSemCrescer(t *testing.T) {
	var lista []estado.Notificacao
	for i := range maxVistas + 10 {
		lista = append(lista, estado.Notificacao{ID: string(rune('A' + i))})
	}
	vistas := LembrarVistas(nil, lista)
	if len(vistas) != maxVistas || vistas[len(vistas)-1] != "A" {
		t.Fatalf("%d vistas, última %q", len(vistas), vistas[len(vistas)-1])
	}
	caminho := filepath.Join(t.TempDir(), "sub", "vistas.json")
	gravarVistas(caminho, vistas)
	if lidas := lerVistas(caminho); !reflect.DeepEqual(lidas, vistas) {
		t.Fatal("as vistas gravadas voltaram diferentes")
	}
	if lerVistas(filepath.Join(t.TempDir(), "nao-existe")) != nil {
		t.Fatal("arquivo ausente deveria dar lista vazia")
	}
}
