package atualizacao

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestMaisNova(t *testing.T) {
	casos := []struct {
		a, b string
		quer bool
	}{
		{"2026.11.01.1230", "2026.10.30.1502", true},
		{"2026.10.30.1502", "2026.11.01.1230", false},
		{"2026.11.01.1230", "2026.11.01.1230", false},
		{"2026.11.01.0930", "2026.11.01.930", false}, // mesmo número
		{"2026.11.1.1", "2026.11", true},
		{"2026.11.01.1230", "dev", false},
		{"dev", "2026.11.01.1230", false},
		{"", "2026.11.01.1230", false},
		{"<html>", "2026.11.01.1230", false},
	}
	for _, c := range casos {
		if got := MaisNova(c.a, c.b); got != c.quer {
			t.Errorf("MaisNova(%q, %q) = %v", c.a, c.b, got)
		}
	}
}

func TestEnderecoPermitido(t *testing.T) {
	for _, s := range []string{"https://a.com", "http://localhost:3000", "http://127.0.0.1:3000"} {
		u, _ := url.Parse(s)
		if err := enderecoPermitido(u); err != nil {
			t.Errorf("%s deveria valer: %v", s, err)
		}
	}
	for _, s := range []string{"http://a.com", "ftp://a.com", "http://localhost.mal.com", "file:///c:/x.exe"} {
		u, _ := url.Parse(s)
		if err := enderecoPermitido(u); err == nil {
			t.Errorf("%s deveria ser recusado", s)
		}
	}
}

type servidorFalso struct {
	exe, versao, hash string
}

func (s *servidorFalso) subir(t *testing.T) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/downloads/versao.txt":
			fmt.Fprintln(w, s.versao)
		case "/downloads/SHA256SUMS.txt":
			fmt.Fprintf(w, "%s  %s\n%s  outro\n", s.hash, NomeExecutavel, strings.Repeat("0", 64))
		case "/downloads/" + NomeExecutavel:
			fmt.Fprint(w, s.exe)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func hashDe(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func instalado(t *testing.T) string {
	t.Helper()
	exe := filepath.Join(t.TempDir(), NomeExecutavel)
	if err := os.WriteFile(exe, []byte("MZ antigo"), 0o755); err != nil {
		t.Fatal(err)
	}
	return exe
}

func simularConferencia(t *testing.T, err error) {
	t.Helper()
	antes := ConferirVersao
	ConferirVersao = func(context.Context, string, string) error { return err }
	t.Cleanup(func() { ConferirVersao = antes })
}

func conteudo(t *testing.T, caminho string) string {
	t.Helper()
	d, err := os.ReadFile(caminho)
	if err != nil {
		t.Fatal(err)
	}
	return string(d)
}

func existe(caminho string) bool {
	_, err := os.Stat(caminho)
	return err == nil
}

func TestPrepararETrocar(t *testing.T) {
	simularConferencia(t, nil)
	s := &servidorFalso{exe: "MZ novo", versao: "2026.11.02.1000", hash: hashDe("MZ novo")}
	url := s.subir(t)
	exe := instalado(t)

	v, err := VersaoPublicada(context.Background(), url)
	if err != nil || v != "2026.11.02.1000" {
		t.Fatalf("versão: %q %v", v, err)
	}
	if err := Preparar(context.Background(), url, exe, v); err != nil {
		t.Fatal(err)
	}
	if conteudo(t, exe) != "MZ antigo" {
		t.Fatal("preparar não pode mexer no instalado")
	}
	if err := Trocar(exe); err != nil {
		t.Fatal(err)
	}
	if conteudo(t, exe) != "MZ novo" || conteudo(t, CaminhoAntigo(exe)) != "MZ antigo" || existe(CaminhoNovo(exe)) {
		t.Fatal("troca errada")
	}
	if err := Reverter(exe); err != nil {
		t.Fatal(err)
	}
	if conteudo(t, exe) != "MZ antigo" {
		t.Fatal("não voltou")
	}
	Limpar(exe)
	if existe(CaminhoAntigo(exe)) || existe(caminhoRecusado(exe)) || !existe(exe) {
		t.Fatal("limpeza errada")
	}
}

func TestArquivoRuimNaoFicaNemTroca(t *testing.T) {
	casos := map[string]struct {
		s        servidorFalso
		conferir error
		mensagem string
	}{
		"hash errado": {servidorFalso{exe: "MZ adulterado", hash: hashDe("MZ original")}, nil, "SHA-256"},
		"não é exe":   {servidorFalso{exe: "<html>erro</html>", hash: hashDe("<html>erro</html>")}, nil, "executável"},
		"não executa": {servidorFalso{exe: "MZ novo", hash: hashDe("MZ novo")}, errors.New("não executa"), "não executa"},
		"sem hash":    {servidorFalso{exe: "MZ novo", hash: "curto"}, nil, "SHA-256"},
	}
	for nome, c := range casos {
		t.Run(nome, func(t *testing.T) {
			simularConferencia(t, c.conferir)
			url := c.s.subir(t)
			exe := instalado(t)
			err := Preparar(context.Background(), url, exe, "2026.11.02.1000")
			if err == nil || !strings.Contains(err.Error(), c.mensagem) {
				t.Fatalf("erro: %v", err)
			}
			if existe(CaminhoNovo(exe)) || conteudo(t, exe) != "MZ antigo" {
				t.Fatal("arquivo ruim ficou para trás")
			}
		})
	}
}

func TestVersaoInvalidaOuHTTPRecusados(t *testing.T) {
	s := &servidorFalso{versao: "<html>", hash: "x"}
	if _, err := VersaoPublicada(context.Background(), s.subir(t)); err == nil {
		t.Fatal("versão inválida deveria falhar")
	}
	if err := Preparar(context.Background(), "http://exemplo.com", instalado(t), "1"); err == nil || !strings.Contains(err.Error(), "HTTPS") {
		t.Fatalf("HTTP externo deveria ser recusado: %v", err)
	}
}

// No Windows, o executável instalado pode estar rodando (serviço e painel) na hora da troca.
func TestTrocaComExecutavelEmUso(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("comportamento do Windows")
	}
	pasta := t.TempDir()
	exe := filepath.Join(pasta, NomeExecutavel)
	ping, err := os.ReadFile(filepath.Join(os.Getenv("SystemRoot"), "System32", "PING.EXE"))
	if err != nil {
		t.Skip("sem ping.exe para copiar")
	}
	if err := os.WriteFile(exe, ping, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(CaminhoNovo(exe), []byte("novo"), 0o755); err != nil {
		t.Fatal(err)
	}
	rodando := exec.Command(exe, "-n", "30", "127.0.0.1")
	if err := rodando.Start(); err != nil {
		t.Skipf("não rodou a cópia: %v", err)
	}
	defer func() {
		rodando.Process.Kill()
		rodando.Wait()
	}()
	time.Sleep(200 * time.Millisecond)
	if err := Trocar(exe); err != nil {
		t.Fatalf("troca com o programa rodando: %v", err)
	}
	if conteudo(t, exe) != "novo" {
		t.Fatal("não trocou")
	}
	// O antigo segue em uso: limpar não derruba nada, e reverter funciona assim mesmo.
	Limpar(exe)
	if !existe(CaminhoAntigo(exe)) {
		t.Fatal("o antigo em uso não some")
	}
	if err := Reverter(exe); err != nil {
		t.Fatal(err)
	}
	if conteudo(t, exe) == "novo" {
		t.Fatal("não voltou")
	}
}

type registro struct{ acoes []string }

func (r *registro) acao(nome string, err error) func() error {
	return func() error {
		r.acoes = append(r.acoes, nome)
		return err
	}
}

func vigiaDeTeste(r *registro, ler func(agora time.Time) (Situacao, error)) *Vigia {
	agora := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	return &Vigia{
		Versao:       "2",
		Reiniciar:    r.acao("reiniciar", nil),
		Parar:        r.acao("parar", nil),
		Iniciar:      r.acao("iniciar", nil),
		Reverter:     r.acao("reverter", nil),
		Ler:          func() (Situacao, error) { return ler(agora) },
		Agora:        func() time.Time { return agora },
		Esperar:      func(d time.Duration) { agora = agora.Add(d) },
		Estabilidade: 30 * time.Second,
		Limite:       2 * time.Minute,
	}
}

func TestVigiaAceitaVersaoDePe(t *testing.T) {
	r := &registro{}
	inicio := time.Date(2026, 11, 1, 12, 0, 5, 0, time.UTC)
	v := vigiaDeTeste(r, func(agora time.Time) (Situacao, error) {
		return Situacao{Versao: "2", AtualizadoEm: agora, IniciadoEm: inicio}, nil
	})
	if err := v.Conduzir(); err != nil {
		t.Fatal(err)
	}
	if strings.Join(r.acoes, ",") != "reiniciar" {
		t.Fatalf("ações: %v", r.acoes)
	}
}

func TestVigiaVoltaAtras(t *testing.T) {
	casos := map[string]func(agora time.Time) (Situacao, error){
		"continua a versão antiga": func(agora time.Time) (Situacao, error) {
			return Situacao{Versao: "1", AtualizadoEm: agora, IniciadoEm: agora.Add(-time.Hour)}, nil
		},
		"reiniciando em ciclo": func(agora time.Time) (Situacao, error) {
			return Situacao{Versao: "2", AtualizadoEm: agora, IniciadoEm: agora.Add(-5 * time.Second)}, nil
		},
		"parou de publicar": func(agora time.Time) (Situacao, error) {
			return Situacao{Versao: "2", AtualizadoEm: agora.Add(-time.Minute), IniciadoEm: agora.Add(-time.Hour)}, nil
		},
		"sem status": func(time.Time) (Situacao, error) { return Situacao{}, errors.New("sem arquivo") },
	}
	for nome, ler := range casos {
		t.Run(nome, func(t *testing.T) {
			r := &registro{}
			err := vigiaDeTeste(r, ler).Conduzir()
			if err == nil || !strings.Contains(err.Error(), "não ficou de pé") {
				t.Fatalf("erro: %v", err)
			}
			if strings.Join(r.acoes, ",") != "reiniciar,parar,reverter,iniciar" {
				t.Fatalf("ações: %v", r.acoes)
			}
		})
	}
}

func TestVigiaReinicioFalhouVoltaAtras(t *testing.T) {
	r := &registro{}
	v := vigiaDeTeste(r, func(time.Time) (Situacao, error) { return Situacao{}, nil })
	v.Reiniciar = r.acao("reiniciar", errors.New("acesso negado"))
	if err := v.Conduzir(); err == nil || !strings.Contains(err.Error(), "acesso negado") {
		t.Fatalf("erro: %v", err)
	}
	if strings.Join(r.acoes, ",") != "reiniciar,parar,reverter,iniciar" {
		t.Fatalf("ações: %v", r.acoes)
	}
}

func TestPreferencias(t *testing.T) {
	c := CaminhoPreferencias(filepath.Join(t.TempDir(), "sub", "agente.json"))
	if p := LerPreferencias(c); p.Desligada || p.VersaoRecusada != "" {
		t.Fatalf("padrão: %+v", p)
	}
	if err := SalvarPreferencias(c, Preferencias{Desligada: true, VersaoRecusada: "2"}); err != nil {
		t.Fatal(err)
	}
	if p := LerPreferencias(c); !p.Desligada || p.VersaoRecusada != "2" {
		t.Fatalf("lido: %+v", p)
	}
}
