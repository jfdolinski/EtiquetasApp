package atualizacao

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func chavesDeTeste(t *testing.T) (string, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(pub), priv
}

func TestConferirAssinatura(t *testing.T) {
	pub, priv := chavesDeTeste(t)
	const sha = "ABCDEF"
	boa := base64.StdEncoding.EncodeToString(ed25519.Sign(priv, MensagemAssinada("2026.11.02.1000", sha)))
	if err := ConferirAssinatura(pub, "2026.11.02.1000", "abcdef", boa); err != nil {
		t.Fatal(err)
	}
	if err := ConferirAssinatura(pub, "2026.11.03.1000", sha, boa); err == nil {
		t.Fatal("a assinatura de uma versão não pode valer para outra")
	}
	if err := ConferirAssinatura(pub, "2026.11.02.1000", "outro", boa); err == nil {
		t.Fatal("a assinatura de um arquivo não pode valer para outro")
	}
	outra, _ := chavesDeTeste(t)
	if err := ConferirAssinatura(outra, "2026.11.02.1000", sha, boa); err == nil {
		t.Fatal("chave de outra pessoa não pode validar")
	}
	if err := ConferirAssinatura(pub, "2026.11.02.1000", sha, "lixo"); err == nil {
		t.Fatal("assinatura malformada")
	}
	if err := ConferirAssinatura("lixo", "2026.11.02.1000", sha, boa); err == nil {
		t.Fatal("chave malformada")
	}
}

// Servidor invadido: ele controla executável e SHA-256, mas não tem a chave privada.
func TestPrepararComChaveRecusaSemExecutar(t *testing.T) {
	pub, priv := chavesDeTeste(t)
	ChavePublica = pub
	t.Cleanup(func() { ChavePublica = "" })
	const v = "2026.11.02.1000"
	binario := "MZ executavel"
	soma := sha256.Sum256([]byte(binario))
	sha := hex.EncodeToString(soma[:])

	casos := []struct {
		nome       string
		assinatura string
		aceita     bool
	}{
		{"assinada", base64.StdEncoding.EncodeToString(ed25519.Sign(priv, MensagemAssinada(v, sha))), true},
		{"sem assinatura", "", false},
		{"assinada por outro", func() string {
			_, o := chavesDeTeste(t)
			return base64.StdEncoding.EncodeToString(ed25519.Sign(o, MensagemAssinada(v, sha)))
		}(), false},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch strings.TrimPrefix(r.URL.Path, "/downloads/") {
				case "SHA256SUMS.txt":
					w.Write([]byte(sha + "  " + NomeExecutavel + "\n"))
				case NomeExecutavel:
					w.Write([]byte(binario))
				case ArquivoAssinatura:
					if c.assinatura == "" {
						http.NotFound(w, r)
						return
					}
					w.Write([]byte(c.assinatura))
				default:
					http.NotFound(w, r)
				}
			}))
			defer srv.Close()
			executou := false
			antes := ConferirVersao
			ConferirVersao = func(context.Context, string, string) error { executou = true; return nil }
			t.Cleanup(func() { ConferirVersao = antes })
			exe := instalado(t)
			err := Preparar(context.Background(), srv.URL, exe, v)
			if c.aceita && err != nil {
				t.Fatal(err)
			}
			if !c.aceita {
				if err == nil {
					t.Fatal("deveria recusar")
				}
				if executou {
					t.Fatal("arquivo sem assinatura válida não pode ser executado nem para conferir a versão")
				}
				if existe(CaminhoNovo(exe)) {
					t.Fatal("arquivo recusado não pode ficar na pasta")
				}
			}
		})
	}
}
