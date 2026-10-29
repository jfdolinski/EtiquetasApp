package config

import (
	"path/filepath"
	"testing"
)

func TestSalvarECarregar(t *testing.T) {
	caminho := filepath.Join(t.TempDir(), "sub", "agente.json")
	vazio, err := Carregar(caminho)
	if err != nil || vazio.Ativado() {
		t.Fatalf("arquivo ausente deveria dar config vazia: %+v %v", vazio, err)
	}
	if err := Salvar(caminho, &Config{Servidor: "https://x", Token: "agt_1", AgenteID: "a1"}); err != nil {
		t.Fatal(err)
	}
	lido, err := Carregar(caminho)
	if err != nil || lido.Token != "agt_1" || !lido.Ativado() {
		t.Fatalf("%+v %v", lido, err)
	}
}

func TestNormalizarServidor(t *testing.T) {
	casos := map[string]string{
		"etiquetas.exemplo.com":             "https://etiquetas.exemplo.com",
		"https://etiquetas.exemplo.com/":    "https://etiquetas.exemplo.com",
		"https://etiquetas.exemplo.com/api": "https://etiquetas.exemplo.com",
		"http://localhost:3000":             "http://localhost:3000",
	}
	for entrada, quer := range casos {
		if got, err := NormalizarServidor(entrada); err != nil || got != quer {
			t.Errorf("NormalizarServidor(%q) = %q, %v; quer %q", entrada, got, err, quer)
		}
	}
	if _, err := NormalizarServidor("ftp://x"); err == nil {
		t.Error("ftp deveria ser recusado")
	}
	if got := URLWebSocket("https://x.com", "/api/agente/conectar"); got != "wss://x.com/api/agente/conectar" {
		t.Error(got)
	}
	if got := URLWebSocket("http://localhost:3000", "/c"); got != "ws://localhost:3000/c" {
		t.Error(got)
	}
}
