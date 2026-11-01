// Package atualizacao troca o agente instalado pela versão publicada no servidor, sem
// reinstalar. O serviço baixa o executável novo na própria pasta de instalação (só
// administradores escrevem lá), confere o SHA-256 e se ele roda, e troca os arquivos: o
// Windows deixa renomear um executável em uso. Um processo à parte, rodando o executável
// antigo, reinicia o serviço e volta atrás se a versão nova não ficar de pé.
package atualizacao

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	NomeExecutavel = "etiquetas-agente.exe"
	tamanhoMaximo  = 200 << 20

	tempoVersao   = 30 * time.Second
	tempoDownload = 10 * time.Minute
	tempoConferir = 30 * time.Second
)

// MaisNova compara versões do build (2026.11.01.1230). "dev" ou fora do padrão nunca é mais
// nova nem é atualizada: quem compila na mão decide sozinho.
func MaisNova(candidata, atual string) bool {
	a, okA := partes(candidata)
	b, okB := partes(atual)
	if !okA || !okB {
		return false
	}
	for i := 0; i < max(len(a), len(b)); i++ {
		var x, y int
		if i < len(a) {
			x = a[i]
		}
		if i < len(b) {
			y = b[i]
		}
		if x != y {
			return x > y
		}
	}
	return false
}

func partes(v string) ([]int, bool) {
	campos := strings.Split(strings.TrimSpace(v), ".")
	r := make([]int, len(campos))
	for i, c := range campos {
		n, err := strconv.Atoi(c)
		if err != nil {
			return nil, false
		}
		r[i] = n
	}
	return r, true
}

// enderecoPermitido: o executável roda como SYSTEM, então só por HTTPS (HTTP apenas na
// própria máquina, para testes).
func enderecoPermitido(u *url.URL) error {
	if u.Scheme == "https" {
		return nil
	}
	host := u.Hostname()
	if ip := net.ParseIP(host); u.Scheme == "http" && (host == "localhost" || (ip != nil && ip.IsLoopback())) {
		return nil
	}
	return fmt.Errorf("atualização só por HTTPS (servidor: %s)", u.Redacted())
}

var clienteHTTP = &http.Client{
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("redirecionamentos demais")
		}
		return enderecoPermitido(req.URL)
	},
}

func abrir(ctx context.Context, servidor, arquivo string) (*http.Response, error) {
	u, err := url.Parse(strings.TrimRight(servidor, "/") + "/downloads/" + arquivo)
	if err != nil {
		return nil, err
	}
	if err := enderecoPermitido(u); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	r, err := clienteHTTP.Do(req)
	if err != nil {
		return nil, err
	}
	if r.StatusCode != http.StatusOK {
		r.Body.Close()
		return nil, fmt.Errorf("o servidor respondeu %d para %s", r.StatusCode, arquivo)
	}
	return r, nil
}

// VersaoPublicada lê a versão que o servidor oferece.
func VersaoPublicada(ctx context.Context, servidor string) (string, error) {
	ctx, cancelar := context.WithTimeout(ctx, tempoVersao)
	defer cancelar()
	r, err := abrir(ctx, servidor, "versao.txt")
	if err != nil {
		return "", err
	}
	defer r.Body.Close()
	dados, err := io.ReadAll(io.LimitReader(r.Body, 100))
	if err != nil {
		return "", err
	}
	v := strings.TrimSpace(string(dados))
	if _, ok := partes(v); !ok {
		return "", fmt.Errorf("versão publicada inválida: %q", v)
	}
	return v, nil
}

func hashPublicado(ctx context.Context, servidor string) (string, error) {
	r, err := abrir(ctx, servidor, "SHA256SUMS.txt")
	if err != nil {
		return "", err
	}
	defer r.Body.Close()
	linhas := bufio.NewScanner(io.LimitReader(r.Body, 1<<16))
	for linhas.Scan() {
		c := strings.Fields(linhas.Text())
		if len(c) == 2 && strings.TrimPrefix(c[1], "*") == NomeExecutavel && len(c[0]) == sha256.Size*2 {
			return strings.ToLower(c[0]), nil
		}
	}
	return "", errors.New("o servidor não informou o SHA-256 do agente")
}

// CaminhoNovo e CaminhoAntigo ficam ao lado do instalado; precisam terminar em .exe para rodar.
func CaminhoNovo(executavel string) string { return vizinho(executavel, ".novo.exe") }

func CaminhoAntigo(executavel string) string { return vizinho(executavel, ".antigo.exe") }

func caminhoRecusado(executavel string) string { return vizinho(executavel, ".recusado.exe") }

func vizinho(executavel, sufixo string) string {
	return strings.TrimSuffix(executavel, filepath.Ext(executavel)) + sufixo
}

// Preparar baixa o executável ao lado do instalado e só o deixa lá depois de conferido.
func Preparar(ctx context.Context, servidor, executavel, versao string) error {
	ctx, cancelar := context.WithTimeout(ctx, tempoDownload)
	defer cancelar()
	esperado, err := hashPublicado(ctx, servidor)
	if err != nil {
		return err
	}
	r, err := abrir(ctx, servidor, NomeExecutavel)
	if err != nil {
		return err
	}
	defer r.Body.Close()

	novo := CaminhoNovo(executavel)
	f, err := os.OpenFile(novo, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return fmt.Errorf("não foi possível gravar na pasta do agente: %w", err)
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, h), io.LimitReader(r.Body, tamanhoMaximo+1))
	if errFechar := f.Close(); err == nil {
		err = errFechar
	}
	if err == nil && n > tamanhoMaximo {
		err = errors.New("arquivo grande demais")
	}
	if err == nil && hex.EncodeToString(h.Sum(nil)) != esperado {
		err = errors.New("o arquivo baixado não confere com o SHA-256 publicado")
	}
	if err == nil {
		err = conferirExecutavel(ctx, novo, versao)
	}
	if err != nil {
		os.Remove(novo)
		return err
	}
	return nil
}

// conferirExecutavel: precisa ser um programa do Windows, rodar e dizer a versão anunciada.
func conferirExecutavel(ctx context.Context, caminho, versao string) error {
	f, err := os.Open(caminho)
	if err != nil {
		return err
	}
	cabecalho := make([]byte, 2)
	_, err = io.ReadFull(f, cabecalho)
	f.Close()
	if err != nil || !bytes.Equal(cabecalho, []byte("MZ")) {
		return errors.New("o arquivo baixado não é um executável")
	}
	return ConferirVersao(ctx, caminho, versao)
}

// ConferirVersao roda `versao` no executável novo. Variável para os testes.
var ConferirVersao = func(ctx context.Context, caminho, versao string) error {
	ctx, cancelar := context.WithTimeout(ctx, tempoConferir)
	defer cancelar()
	saida, err := exec.CommandContext(ctx, caminho, "versao").Output()
	if err != nil {
		return fmt.Errorf("a versão nova não executa: %w", err)
	}
	if !strings.Contains(string(saida), versao) {
		return fmt.Errorf("a versão nova informou %q, esperada %s", strings.TrimSpace(string(saida)), versao)
	}
	return nil
}

// Trocar põe o novo no lugar do instalado e guarda o instalado como antigo.
func Trocar(executavel string) error {
	antigo := CaminhoAntigo(executavel)
	if err := os.Remove(antigo); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("a cópia anterior ainda está em uso: %w", err)
	}
	if err := os.Rename(executavel, antigo); err != nil {
		return err
	}
	if err := os.Rename(CaminhoNovo(executavel), executavel); err != nil {
		if errVolta := os.Rename(antigo, executavel); errVolta != nil {
			return fmt.Errorf("%w; e não foi possível voltar: %v", err, errVolta)
		}
		return err
	}
	return nil
}

// Reverter devolve o antigo ao lugar. Copia em vez de renomear: quem chama roda do antigo,
// e o novo sai do caminho por rename porque pode ainda estar em uso.
func Reverter(executavel string) error {
	recusado := caminhoRecusado(executavel)
	_ = os.Remove(recusado)
	if err := os.Rename(executavel, recusado); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	de, err := os.Open(CaminhoAntigo(executavel))
	if err != nil {
		return err
	}
	defer de.Close()
	para, err := os.OpenFile(executavel, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(para, de); err != nil {
		para.Close()
		return err
	}
	return para.Close()
}

// Limpar apaga as sobras de atualizações anteriores; o que estiver em uso fica para depois.
func Limpar(executavel string) {
	for _, c := range []string{CaminhoNovo(executavel), CaminhoAntigo(executavel), caminhoRecusado(executavel)} {
		_ = os.Remove(c)
	}
}

// Situacao do serviço, como o vigia enxerga pelo arquivo de status.
type Situacao struct {
	Versao       string
	PID          int
	AtualizadoEm time.Time
	IniciadoEm   time.Time
}

// Vigia é o que o processo à parte faz; as ações são injetadas para testar sem serviço.
type Vigia struct {
	Versao    string
	Reiniciar func() error
	Parar     func() error
	Iniciar   func() error
	Ler       func() (Situacao, error)
	Reverter  func() error
	Agora     func() time.Time
	Esperar   func(time.Duration)
	// Quanto tempo o agente novo precisa ficar de pé, sem reiniciar, para valer.
	Estabilidade time.Duration
	Limite       time.Duration
}

// De pé: a versão nova está publicando o status agora e este processo já dura o bastante.
// Sem exigir conexão com o servidor: a internet fora do ar não é culpa da versão.
func (v *Vigia) dePe(s Situacao, agora time.Time) bool {
	return s.Versao == v.Versao && agora.Sub(s.AtualizadoEm) < 15*time.Second && agora.Sub(s.IniciadoEm) >= v.Estabilidade
}

// Conduzir reinicia o serviço e decide: nil se a versão nova ficou de pé; senão volta atrás
// e devolve o motivo.
func (v *Vigia) Conduzir() error {
	falha := v.Reiniciar()
	if falha == nil {
		limite := v.Agora().Add(v.Limite)
		for {
			if s, err := v.Ler(); err == nil && v.dePe(s, v.Agora()) {
				return nil
			}
			if !v.Agora().Before(limite) {
				falha = fmt.Errorf("a versão %s não ficou de pé em %s", v.Versao, v.Limite)
				break
			}
			v.Esperar(3 * time.Second)
		}
	}
	_ = v.Parar()
	if err := v.Reverter(); err != nil {
		return fmt.Errorf("%w; e não foi possível voltar à versão anterior: %v", falha, err)
	}
	if err := v.Iniciar(); err != nil {
		return fmt.Errorf("%w; voltou à versão anterior, mas o serviço não iniciou: %v", falha, err)
	}
	return falha
}

// Preferencias ficam num arquivo próprio: o cliente regrava a configuração em memória a cada
// conexão e desfaria uma opção mudada pelo painel.
type Preferencias struct {
	Desligada bool `json:"desligada,omitempty"`
	// Versão que falhou: não tenta de novo; uma mais nova, sim.
	VersaoRecusada string `json:"versaoRecusada,omitempty"`
	MotivoRecusa   string `json:"motivoRecusa,omitempty"`
	RecusaAvisada  bool   `json:"recusaAvisada,omitempty"`
	// Troca em andamento: a versão nova avisa ao subir.
	Atualizando string `json:"atualizando,omitempty"`
}

// CaminhoPreferencias fica ao lado da configuração (pasta restrita a administradores).
func CaminhoPreferencias(caminhoConfig string) string {
	return filepath.Join(filepath.Dir(caminhoConfig), "atualizacao.json")
}

func LerPreferencias(caminho string) Preferencias {
	var p Preferencias
	if dados, err := os.ReadFile(caminho); err == nil {
		_ = json.Unmarshal(dados, &p)
	}
	return p
}

func SalvarPreferencias(caminho string, p Preferencias) error {
	dados, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(caminho), 0o700); err != nil {
		return err
	}
	tmp := caminho + ".tmp"
	if err := os.WriteFile(tmp, dados, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, caminho)
}
