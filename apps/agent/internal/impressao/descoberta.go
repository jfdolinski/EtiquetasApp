package impressao

import (
	"context"
	"errors"
	"fmt"
	"net"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Encontrada é uma impressora achada neste computador (spooler) ou na rede (porta 9100),
// com a linguagem e o DPI que o painel sugere para o cadastro.
type Encontrada struct {
	Nome      string `json:"nome"`
	Driver    string `json:"driver,omitempty"`
	Porta     string `json:"porta,omitempty"`
	Padrao    bool   `json:"padrao,omitempty"`
	Metodo    string `json:"metodo"`   // REDE | SISTEMA
	Endereco  string `json:"endereco"` // IP:porta ou nome no Windows
	Linguagem string `json:"linguagem"`
	DPI       int    `json:"dpi"`
}

var (
	reDPI = regexp.MustCompile(`(\d{3})\s*dpi`)
	reEPL = regexp.MustCompile(`\bepl2?\b`)
	reDPL = regexp.MustCompile(`\bdpl\b`)
	// Térmicas de cupom (80/58 mm) que falam ESC/POS.
	reESCPOS = regexp.MustCompile(`pos-?(80|58)|tm-?t\d|epson tm|bematech|mp-?4200|mp-?2800|elgin i[79]|daruma|dr800|sweda|si-?300|thermal receipt|receipt printer|tanca|control id|print id`)
)

// SugerirLinguagem adivinha a linguagem pelo nome e pelo driver. É só uma sugestão: o
// técnico confirma no painel antes de cadastrar. Jato de tinta e laser ficam com PDF.
func SugerirLinguagem(nome, driver string) (linguagem string, dpi int) {
	t := strings.ToLower(nome + " " + driver)
	dpi = 203
	if m := reDPI.FindStringSubmatch(t); m != nil {
		switch m[1] {
		case "300":
			dpi = 300
		case "600":
			dpi = 600
		}
	}
	switch {
	// Zebra com driver EPL (ex.: "ZDesigner GC420t (EPL)") fala EPL2, que é o PPLB.
	case reEPL.MatchString(t) || strings.Contains(t, "pplb"):
		return "PPLB", dpi
	case strings.Contains(t, "zdesigner") || strings.Contains(t, "zebra") || strings.Contains(t, "zpl"):
		return "ZPL", dpi
	case strings.Contains(t, "datamax") || strings.Contains(t, "ppla") || reDPL.MatchString(t):
		return "PPLA", dpi
	case strings.Contains(t, "argox") || strings.Contains(t, "elgin l42"):
		return "PPLB", dpi
	case reESCPOS.MatchString(t):
		return "ESCPOS", 203
	}
	return "PDF", 300
}

// virtual: impressoras do Windows que não são papel (PDF, XPS, OneNote, fax).
func virtual(nome, driver string) bool {
	t := strings.ToLower(nome + " " + driver)
	for _, v := range []string{"microsoft print to pdf", "xps document writer", "onenote", "fax", "pdf24", "pdfcreator", "cutepdf"} {
		if strings.Contains(t, v) {
			return true
		}
	}
	return false
}

// ListarDoSistema devolve as impressoras instaladas (sem as virtuais), a padrão primeiro.
func ListarDoSistema() ([]Encontrada, error) {
	lista, err := listarSistema()
	if err != nil {
		return nil, err
	}
	r := make([]Encontrada, 0, len(lista))
	for _, e := range lista {
		if virtual(e.Nome, e.Driver) {
			continue
		}
		e.Metodo, e.Endereco = MetodoSistema, e.Nome
		e.Linguagem, e.DPI = SugerirLinguagem(e.Nome, e.Driver)
		r = append(r, e)
	}
	sort.SliceStable(r, func(i, j int) bool {
		if r[i].Padrao != r[j].Padrao {
			return r[i].Padrao
		}
		return strings.ToLower(r[i].Nome) < strings.ToLower(r[j].Nome)
	})
	return r, nil
}

const (
	tempoSondagem       = 600 * time.Millisecond
	sondagensParalelas  = 96
	maximoHostsSondados = 1024
)

// Variáveis para os testes trocarem por uma impressora falsa local.
var (
	portaRaw          = 9100
	hostsParaProcurar = hostsDasRedesLocais
)

// ProcurarNaRede testa a porta 9100 (impressão RAW, padrão das impressoras de etiqueta e de
// rede) em todos os endereços das redes locais /24 deste computador. Leva poucos segundos.
func ProcurarNaRede(ctx context.Context) ([]Encontrada, error) {
	alvos := hostsParaProcurar()
	if len(alvos) == 0 {
		return nil, errors.New("este computador não está numa rede local (IPv4 privado)")
	}
	var (
		mu     sync.Mutex
		achou  []string
		espera sync.WaitGroup
		vagas  = make(chan struct{}, sondagensParalelas)
	)
	for _, ip := range alvos {
		if ctx.Err() != nil {
			break
		}
		espera.Add(1)
		vagas <- struct{}{}
		go func(ip string) {
			defer espera.Done()
			defer func() { <-vagas }()
			d := net.Dialer{Timeout: tempoSondagem}
			endereco := net.JoinHostPort(ip, fmt.Sprint(portaRaw))
			conn, err := d.DialContext(ctx, "tcp", endereco)
			if err != nil {
				return
			}
			conn.Close()
			mu.Lock()
			achou = append(achou, endereco)
			mu.Unlock()
		}(ip)
	}
	espera.Wait()
	sort.Slice(achou, func(i, j int) bool { return ordemIP(achou[i]) < ordemIP(achou[j]) })
	r := make([]Encontrada, len(achou))
	for i, e := range achou {
		host, _, _ := net.SplitHostPort(e)
		// Sem driver para olhar: quem responde na 9100 quase sempre é etiqueta (ZPL é o mais comum).
		r[i] = Encontrada{Nome: "Impressora " + host, Metodo: MetodoRede, Endereco: e, Linguagem: "ZPL", DPI: 203}
	}
	return r, nil
}

func ordemIP(endereco string) string {
	host, _, _ := net.SplitHostPort(endereco)
	ip := net.ParseIP(host).To4()
	if ip == nil {
		return endereco
	}
	return fmt.Sprintf("%03d%03d%03d%03d", ip[0], ip[1], ip[2], ip[3])
}

// hostsDasRedesLocais: todos os endereços das redes IPv4 privadas (cada interface vira um /24).
func hostsDasRedesLocais() []string {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	vistas := map[string]bool{}
	var hosts []string
	for _, itf := range interfaces {
		if itf.Flags&net.FlagUp == 0 || itf.Flags&net.FlagLoopback != 0 {
			continue
		}
		enderecos, _ := itf.Addrs()
		for _, a := range enderecos {
			rede, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip := rede.IP.To4()
			if ip == nil || !ip.IsPrivate() {
				continue
			}
			base := fmt.Sprintf("%d.%d.%d.", ip[0], ip[1], ip[2])
			if vistas[base] {
				continue
			}
			vistas[base] = true
			for h := 1; h < 255 && len(hosts) < maximoHostsSondados; h++ {
				if h != int(ip[3]) {
					hosts = append(hosts, fmt.Sprintf("%s%d", base, h))
				}
			}
		}
	}
	return hosts
}

// EtiquetaDeTeste gera uma etiqueta simples na linguagem pedida, para conferir se a
// impressora recebe e entende os comandos. PDF não tem teste por aqui (sai pelo navegador).
func EtiquetaDeTeste(linguagem string, dpi int, titulo string) ([]byte, error) {
	if dpi <= 0 {
		dpi = 203
	}
	agora := time.Now().Format("02/01/2006 15:04")
	ascii := func(s string) string {
		r := strings.NewReplacer("á", "a", "à", "a", "ã", "a", "â", "a", "é", "e", "ê", "e", "í", "i", "ó", "o", "õ", "o", "ô", "o", "ú", "u", "ç", "c",
			"Á", "A", "Ã", "A", "É", "E", "Í", "I", "Ó", "O", "Ú", "U", "Ç", "C", "\"", "'")
		s = r.Replace(s)
		b := make([]byte, 0, len(s))
		for i := 0; i < len(s); i++ {
			if s[i] >= 0x20 && s[i] < 0x7f {
				b = append(b, s[i])
			}
		}
		if len(b) > 32 {
			b = b[:32]
		}
		return string(b)
	}
	esc := func(mm float64) int { return int(mm * float64(dpi) / 25.4) }
	nome := ascii(titulo)
	switch linguagem {
	case "ZPL":
		return []byte(fmt.Sprintf("^XA^CI28^PW%d^LH0,0"+
			"^FO%d,%d^A0N,%d,%d^FDTeste do Agente de Etiquetas^FS"+
			"^FO%d,%d^A0N,%d,%d^FD%s^FS"+
			"^FO%d,%d^A0N,%d,%d^FD%s^FS"+
			"^FO%d,%d^BY2^BCN,%d,Y,N,N^FD123456789^FS^PQ1^XZ",
			esc(60),
			esc(3), esc(3), esc(4), esc(4),
			esc(3), esc(9), esc(3), esc(3), nome,
			esc(3), esc(14), esc(3), esc(3), agora,
			esc(3), esc(20), esc(10))), nil
	case "PPLB":
		return []byte(fmt.Sprintf("\nN\nq%d\n"+
			"A%d,%d,0,3,1,1,N,\"Teste do Agente de Etiquetas\"\n"+
			"A%d,%d,0,2,1,1,N,\"%s\"\n"+
			"A%d,%d,0,2,1,1,N,\"%s\"\n"+
			"B%d,%d,0,1,2,4,%d,B,\"123456789\"\nP1\n",
			esc(60), esc(3), esc(3), esc(3), esc(9), nome, esc(3), esc(14), agora, esc(3), esc(20), esc(10))), nil
	case "PPLA":
		// DPL, modo métrico (0,1 mm), linha medida de baixo para cima numa etiqueta de 40 mm.
		return []byte("\x02L\r\nD11\r\nm\r\n" +
			"1911A1003400030Teste do Agente de Etiquetas\r\n" +
			"1911A0802800030" + nome + "\r\n" +
			"1911A0802300030" + agora + "\r\n" +
			// Code 128 (E): largo 6, estreito 2, altura 10 mm (100), linha 5 mm, coluna 3 mm.
			"1E62100005000300123456789\r\nQ0001\r\nE\r\n"), nil
	case "ESCPOS":
		var b []byte
		b = append(b, 0x1b, 0x40, 0x1b, 0x61, 1) // inicializa, centraliza
		b = append(b, 0x1d, 0x21, 0x11)
		b = append(b, "TESTE\n"...)
		b = append(b, 0x1d, 0x21, 0x00)
		b = append(b, "Agente de Etiquetas\n"+nome+"\n"+agora+"\n"...)
		b = append(b, 0x1d, 0x68, 60, 0x1d, 0x77, 2, 0x1d, 0x48, 2, 0x1d, 0x6b, 73, 11, '{', 'B', '1', '2', '3', '4', '5', '6', '7', '8', '9')
		b = append(b, "\n\n\n"...)
		b = append(b, 0x1d, 0x56, 66, 0) // corta
		return b, nil
	}
	return nil, errors.New("o teste do agente é só para impressoras térmicas (ZPL, PPLA, PPLB e ESC/POS); impressoras comuns imprimem o PDF pelo navegador")
}
