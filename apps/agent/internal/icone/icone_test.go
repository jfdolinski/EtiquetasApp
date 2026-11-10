package icone

import (
	"bytes"
	"encoding/binary"
	"image/png"
	"os"
	"testing"
)

func TestICOTemCabecalhoEImagens(t *testing.T) {
	ico := ICO(Verde, 16, 32)
	var cab [3]uint16
	if err := binary.Read(bytes.NewReader(ico), binary.LittleEndian, &cab); err != nil {
		t.Fatal(err)
	}
	if cab != [3]uint16{0, 1, 2} {
		t.Fatalf("cabeçalho inesperado: %v", cab)
	}
	inicio := binary.LittleEndian.Uint32(ico[6+12:])
	img, err := png.Decode(bytes.NewReader(ico[inicio:]))
	if err != nil || img.Bounds().Dx() != 16 {
		t.Fatalf("primeira imagem inválida: %v", err)
	}
}

func TestDesenhoEtiquetaFuroOndaECantos(t *testing.T) {
	img := Desenhar(Laranja, 100)
	cor := func(x, y int) (uint8, uint8, uint8, uint8) {
		c := img.RGBAAt(x, y)
		return c.R, c.G, c.B, c.A
	}
	if _, _, _, a := cor(0, 0); a != 0 {
		t.Error("canto arredondado deveria ser transparente")
	}
	if r, g, b, _ := cor(10, 50); r != Laranja.R || g != Laranja.G || b != Laranja.B {
		t.Error("fundo deveria ser laranja")
	}
	if r, g, b, _ := cor(50, 35); r != 255 || g != 255 || b != 255 {
		t.Error("etiqueta deveria ser branca")
	}
	if r, _, _, _ := cor(62, 50); r != Laranja.R {
		t.Error("furo deveria ter a cor do fundo")
	}
	if r, g, _, _ := cor(43, 50); r != Laranja.R || g != Laranja.G {
		t.Error("onda deveria ter a cor do fundo")
	}
	frente := DesenharCom(Laranja, 100, SemFundo)
	if frente.RGBAAt(10, 50).A != 0 || frente.RGBAAt(50, 35).A != 255 {
		t.Error("sem fundo: só a etiqueta é pintada")
	}
	if DesenharCom(Laranja, 100, Cheio).RGBAAt(0, 0).A != 255 {
		t.Error("cheio: canto pintado")
	}
	// Para conferir o desenho: ICONE_PNG=caminho.png go test ./internal/icone
	if caminho := os.Getenv("ICONE_PNG"); caminho != "" {
		_ = os.WriteFile(caminho, PNG(Laranja, 256), 0o644)
	}
}
