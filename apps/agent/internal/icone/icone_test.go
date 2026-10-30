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

func TestDesenhoTemFuroEFundoTransparente(t *testing.T) {
	img := Desenhar(Azul, 64)
	if _, _, _, a := img.At(0, 0).RGBA(); a != 0 {
		t.Error("canto deveria ser transparente")
	}
	if _, _, _, a := img.At(48, 32).RGBA(); a == 0 {
		t.Error("corpo da etiqueta deveria estar pintado")
	}
	// Para conferir o desenho: ICONE_PNG=caminho.png go test ./internal/icone
	if caminho := os.Getenv("ICONE_PNG"); caminho != "" {
		_ = os.WriteFile(caminho, PNG(Azul, 256), 0o644)
	}
}
