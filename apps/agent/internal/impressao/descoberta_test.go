package impressao

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"testing"
	"time"
)

func TestSugerirLinguagem(t *testing.T) {
	casos := []struct {
		nome, driver, linguagem string
		dpi                     int
	}{
		{"ZDesigner GC420t (EPL)", "ZDesigner GC420t (EPL)", "PPLB", 203},
		{"ZDesigner GC420t", "ZDesigner GC420t", "ZPL", 203},
		{"Zebra ZT230", "ZDesigner ZT230-300dpi ZPL", "ZPL", 300},
		{"Argox OS-214 plus", "Argox OS-214 plus series PPLA", "PPLA", 203},
		{"Etiquetas balcão", "Argox OS-2140 PPLB", "PPLB", 203},
		{"ELGIN L42 PRO", "ELGIN L42 PRO", "PPLB", 203},
		{"Cupom", "EPSON TM-T20 Receipt", "ESCPOS", 203},
		{"MP-4200 TH", "Bematech MP-4200 TH", "ESCPOS", 203},
		{"POS-80", "POS-80C", "ESCPOS", 203},
		{"HP Ink Tank 410", "HP Ink Tank 410 series", "PDF", 300},
	}
	for _, c := range casos {
		l, d := SugerirLinguagem(c.nome, c.driver)
		if l != c.linguagem || d != c.dpi {
			t.Errorf("%s / %s: sugeriu %s %d, esperava %s %d", c.nome, c.driver, l, d, c.linguagem, c.dpi)
		}
	}
	if !virtual("Microsoft Print to PDF", "") || !virtual("Fax", "Microsoft Shared Fax Driver") || virtual("Zebra", "ZDesigner") {
		t.Error("detecção de impressoras virtuais errada")
	}
}

func TestEtiquetaDeTeste(t *testing.T) {
	zpl, err := EtiquetaDeTeste("ZPL", 203, "Balcão \"Açougue\"")
	if err != nil || !strings.HasPrefix(string(zpl), "^XA") || !strings.Contains(string(zpl), "Balcao 'Acougue'") || !strings.HasSuffix(string(zpl), "^XZ") {
		t.Fatalf("ZPL inesperado: %q %v", zpl, err)
	}
	pplb, _ := EtiquetaDeTeste("PPLB", 203, "x")
	if !strings.Contains(string(pplb), "\nN\n") || !strings.Contains(string(pplb), "P1") {
		t.Errorf("PPLB inesperado: %q", pplb)
	}
	ppla, _ := EtiquetaDeTeste("PPLA", 203, "x")
	if !strings.HasPrefix(string(ppla), "\x02L") || !strings.Contains(string(ppla), "1E6210000500030") {
		t.Errorf("PPLA inesperado: %q", ppla)
	}
	escpos, _ := EtiquetaDeTeste("ESCPOS", 203, "x")
	if !bytes.HasPrefix(escpos, []byte{0x1b, 0x40}) || !bytes.HasSuffix(escpos, []byte{0x1d, 0x56, 66, 0}) {
		t.Errorf("ESC/POS inesperado: %x", escpos)
	}
	if _, err := EtiquetaDeTeste("PDF", 300, "x"); err == nil {
		t.Error("PDF não deveria ter teste pelo agente")
	}
}

// Para ver o que o painel vai mostrar neste computador: AGENTE_LISTAR=1 go test -run Listar -v ./internal/impressao
func TestListarDoSistemaNesteComputador(t *testing.T) {
	if os.Getenv("AGENTE_LISTAR") == "" {
		t.Skip("defina AGENTE_LISTAR=1")
	}
	brutas, err := listarSistema()
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range brutas {
		t.Logf("no Windows: %q driver=%q porta=%q padrão=%v virtual=%v", e.Nome, e.Driver, e.Porta, e.Padrao, virtual(e.Nome, e.Driver))
	}
	lista, _ := ListarDoSistema()
	for _, e := range lista {
		t.Logf("%-40s driver=%-40s porta=%-20s padrão=%v → %s %d dpi", e.Nome, e.Driver, e.Porta, e.Padrao, e.Linguagem, e.DPI)
	}
}

// Impressora falsa no loopback: a busca acha quem responde na porta e o teste chega inteiro.
func TestProcurarNaRedeETestarImpressoraFalsa(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	recebido := make(chan []byte, 1)
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				b, _ := io.ReadAll(c)
				if len(b) > 0 {
					recebido <- b
				}
			}(c)
		}
	}()
	porta := l.Addr().(*net.TCPAddr).Port
	portaOriginal, hostsOriginais := portaRaw, hostsParaProcurar
	portaRaw, hostsParaProcurar = porta, func() []string { return []string{"127.0.0.1", "127.0.0.2"} }
	defer func() { portaRaw, hostsParaProcurar = portaOriginal, hostsOriginais }()

	achadas, err := ProcurarNaRede(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(achadas) != 1 || achadas[0].Endereco != fmt.Sprintf("127.0.0.1:%d", porta) || achadas[0].Metodo != MetodoRede {
		t.Fatalf("esperava só a impressora falsa: %+v", achadas)
	}
	teste, _ := EtiquetaDeTeste("ZPL", 203, "Balcão")
	if err := Imprimir(context.Background(), MetodoRede, achadas[0].Endereco, "teste", teste); err != nil {
		t.Fatal(err)
	}
	select {
	case b := <-recebido:
		if !bytes.Equal(b, teste) {
			t.Errorf("a impressora recebeu %q", b)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("a impressora falsa não recebeu o teste")
	}
}
