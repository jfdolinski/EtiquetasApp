// Package icone desenha o ícone do agente (uma etiqueta de preço) em qualquer cor e
// tamanho, sem arquivos de imagem: o painel pinta a etiqueta conforme o status e o
// gerador de recursos usa a versão azul como ícone do executável.
package icone

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"math"
)

var (
	Azul     = color.RGBA{0x25, 0x63, 0xeb, 0xff}
	Verde    = color.RGBA{0x16, 0xa3, 0x4a, 0xff}
	Amarelo  = color.RGBA{0xd9, 0x77, 0x06, 0xff}
	Vermelho = color.RGBA{0xdc, 0x26, 0x26, 0xff}
	Cinza    = color.RGBA{0x64, 0x74, 0x8b, 0xff}
)

type ponto struct{ x, y float64 }

// Etiqueta com a ponta para cima e à esquerda, centralizada no quadro (coordenadas 0..1).
var contorno, furo = montar()

const (
	inclinacao = 0.62 // radianos, sentido horário
	furoR      = 0.075
	amostras   = 5 // supersampling por eixo (antisserrilhado)
)

func montar() ([]ponto, ponto) {
	corpo := []ponto{{0.0, 0.50}, {0.28, 0.24}, {0.94, 0.24}, {1.0, 0.30}, {1.0, 0.70}, {0.94, 0.76}, {0.28, 0.76}}
	pontos := girar(append(corpo, ponto{0.30, 0.50}), inclinacao)
	// Enquadra com margem igual dos dois lados.
	minX, minY, maxX, maxY := 1.0, 1.0, 0.0, 0.0
	for _, p := range pontos[:len(corpo)] {
		minX, minY, maxX, maxY = math.Min(minX, p.x), math.Min(minY, p.y), math.Max(maxX, p.x), math.Max(maxY, p.y)
	}
	escala := 0.92 / math.Max(maxX-minX, maxY-minY)
	cx, cy := (minX+maxX)/2, (minY+maxY)/2
	for i, p := range pontos {
		pontos[i] = ponto{0.5 + (p.x-cx)*escala, 0.5 + (p.y-cy)*escala}
	}
	return pontos[:len(corpo)], pontos[len(corpo)]
}

func girar(p []ponto, ang float64) []ponto {
	s, c := math.Sin(ang), math.Cos(ang)
	r := make([]ponto, len(p))
	for i, q := range p {
		x, y := q.x-0.5, q.y-0.5
		r[i] = ponto{0.5 + x*c - y*s, 0.5 + x*s + y*c}
	}
	return r
}

func dentro(poli []ponto, x, y float64) bool {
	ok := false
	for i, j := 0, len(poli)-1; i < len(poli); j, i = i, i+1 {
		a, b := poli[i], poli[j]
		if (a.y > y) != (b.y > y) && x < (b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x {
			ok = !ok
		}
	}
	return ok
}

// encolher aproxima a área interna (para a borda escura): escala em torno do centro.
func encolher(poli []ponto, f float64) []ponto {
	r := make([]ponto, len(poli))
	for i, p := range poli {
		r[i] = ponto{0.5 + (p.x-0.5)*f, 0.5 + (p.y-0.5)*f}
	}
	return r
}

// Desenhar devolve a etiqueta na cor pedida, com borda mais escura e furo transparente.
func Desenhar(cor color.RGBA, lado int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, lado, lado))
	borda := color.RGBA{uint8(float64(cor.R) * 0.6), uint8(float64(cor.G) * 0.6), uint8(float64(cor.B) * 0.6), 0xff}
	espessura := math.Max(1.0/float64(lado), 0.045)
	interno := encolher(contorno, 1-2.6*espessura)
	fx, fy := furo.x, furo.y
	for py := 0; py < lado; py++ {
		for px := 0; px < lado; px++ {
			var r, g, b, a float64
			for sy := 0; sy < amostras; sy++ {
				for sx := 0; sx < amostras; sx++ {
					x := (float64(px) + (float64(sx)+0.5)/amostras) / float64(lado)
					y := (float64(py) + (float64(sy)+0.5)/amostras) / float64(lado)
					if !dentro(contorno, x, y) {
						continue
					}
					d := math.Hypot(x-fx, y-fy)
					if d < furoR {
						continue
					}
					c := cor
					if !dentro(interno, x, y) || d < furoR+espessura {
						c = borda
					}
					r += float64(c.R)
					g += float64(c.G)
					b += float64(c.B)
					a++
				}
			}
			if a == 0 {
				continue
			}
			total := float64(amostras * amostras)
			// Pré-multiplicado (image.RGBA).
			img.SetRGBA(px, py, color.RGBA{uint8(r / total), uint8(g / total), uint8(b / total), uint8(255 * a / total)})
		}
	}
	return img
}

// ICO monta um arquivo .ico com uma imagem PNG por tamanho (Windows Vista ou mais novo).
func ICO(cor color.RGBA, tamanhos ...int) []byte {
	if len(tamanhos) == 0 {
		tamanhos = []int{16, 20, 24, 32, 40, 48, 64}
	}
	imagens := make([][]byte, len(tamanhos))
	for i, t := range tamanhos {
		var b bytes.Buffer
		_ = png.Encode(&b, Desenhar(cor, t))
		imagens[i] = b.Bytes()
	}
	var saida bytes.Buffer
	_ = binary.Write(&saida, binary.LittleEndian, [3]uint16{0, 1, uint16(len(tamanhos))})
	deslocamento := 6 + 16*len(tamanhos)
	for i, t := range tamanhos {
		lado := uint8(t)
		if t >= 256 {
			lado = 0
		}
		_ = binary.Write(&saida, binary.LittleEndian, struct {
			L, A, Cores, Reservado uint8
			Planos, Bits           uint16
			Tamanho, Inicio        uint32
		}{lado, lado, 0, 0, 1, 32, uint32(len(imagens[i])), uint32(deslocamento)})
		deslocamento += len(imagens[i])
	}
	for _, img := range imagens {
		saida.Write(img)
	}
	return saida.Bytes()
}

// PNG de um tamanho (para a página do painel).
func PNG(cor color.RGBA, lado int) []byte {
	var b bytes.Buffer
	_ = png.Encode(&b, Desenhar(cor, lado))
	return b.Bytes()
}
