// Package icone desenha o ícone do Flow (uma etiqueta branca com uma onda, sobre um
// quadrado de cantos arredondados) em qualquer cor e tamanho, sem arquivos de imagem.
// O painel pinta o quadrado conforme o status; o executável, o site e o aplicativo usam
// a versão laranja (gerada por tools/recursos).
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
	// Laranja é a cor do Flow.
	Laranja  = color.RGBA{0xea, 0x58, 0x0c, 0xff}
	Azul     = color.RGBA{0x25, 0x63, 0xeb, 0xff}
	Verde    = color.RGBA{0x16, 0xa3, 0x4a, 0xff}
	Amarelo  = color.RGBA{0xd9, 0x77, 0x06, 0xff}
	Vermelho = color.RGBA{0xdc, 0x26, 0x26, 0xff}
	Cinza    = color.RGBA{0x64, 0x74, 0x8b, 0xff}
	branco   = color.RGBA{0xff, 0xff, 0xff, 0xff}
)

// Fundo do desenho.
type Fundo int

const (
	// Arredondado: quadrado de cantos arredondados (bandeja, executável, site).
	Arredondado Fundo = iota
	// Cheio: quadrado inteiro, sem transparência (ícone do iPhone, que arredonda sozinho).
	Cheio
	// SemFundo: só a etiqueta (frente do ícone adaptável do Android, que põe a cor atrás).
	SemFundo
)

const amostras = 5 // supersampling por eixo (antisserrilhado)

type ponto struct{ x, y float64 }

// Coordenadas num quadro de 100 × 100, as mesmas do desenho em SVG (apps/web/public/favicon.svg).
const (
	raioCanto = 22.0
	tagX0     = 24.0
	tagX1     = 58.0
	tagPonta  = 76.0
	tagY0     = 28.0
	tagY1     = 72.0
	tagCanto  = 6.0
	furoX     = 62.0
	furoY     = 50.0
	furoR     = 4.5
	ondaMeia  = 2.0 // metade da espessura do traço
)

// A onda: duas curvas de Bézier, como no SVG ("M31 50c4-5 8 5 12 0s8 5 12 0").
var onda = amostrarOnda()

func bezier(p0, p1, p2, p3 ponto, n int) []ponto {
	r := make([]ponto, 0, n+1)
	for i := 0; i <= n; i++ {
		t := float64(i) / float64(n)
		u := 1 - t
		r = append(r, ponto{
			u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
			u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y,
		})
	}
	return r
}

func amostrarOnda() []ponto {
	a := bezier(ponto{31, 50}, ponto{35, 45}, ponto{39, 55}, ponto{43, 50}, 32)
	b := bezier(ponto{43, 50}, ponto{47, 45}, ponto{51, 55}, ponto{55, 50}, 32)
	return append(a, b[1:]...)
}

func distSegmento(p, a, b ponto) float64 {
	dx, dy := b.x-a.x, b.y-a.y
	t := ((p.x-a.x)*dx + (p.y-a.y)*dy) / (dx*dx + dy*dy)
	t = math.Max(0, math.Min(1, t))
	return math.Hypot(p.x-(a.x+t*dx), p.y-(a.y+t*dy))
}

func naOnda(p ponto) bool {
	if p.x < 31-ondaMeia || p.x > 55+ondaMeia || p.y < 44 || p.y > 56 {
		return false
	}
	for i := 1; i < len(onda); i++ {
		if distSegmento(p, onda[i-1], onda[i]) <= ondaMeia {
			return true
		}
	}
	return false
}

// dentroArredondado: retângulo [x0,x1]×[y0,y1] com raio r nos cantos da esquerda e/ou da direita.
func dentroArredondado(p ponto, x0, y0, x1, y1, r float64, esquerda, direita bool) bool {
	if p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1 {
		return false
	}
	var cx float64
	switch {
	case esquerda && p.x < x0+r:
		cx = x0 + r
	case direita && p.x > x1-r:
		cx = x1 - r
	default:
		return true
	}
	var cy float64
	switch {
	case p.y < y0+r:
		cy = y0 + r
	case p.y > y1-r:
		cy = y1 - r
	default:
		return true
	}
	return math.Hypot(p.x-cx, p.y-cy) <= r
}

func naEtiqueta(p ponto) bool {
	if dentroArredondado(p, tagX0, tagY0, tagX1, tagY1, tagCanto, true, false) {
		return true
	}
	if p.x < tagX1 || p.x > tagPonta {
		return false
	}
	meia := (tagY1 - tagY0) / 2
	return math.Abs(p.y-furoY) <= meia*(tagPonta-p.x)/(tagPonta-tagX1)
}

// corEm devolve a cor do ponto (quadro 0..100) e se ele é pintado.
func corEm(p ponto, cor color.RGBA, fundo Fundo) (color.RGBA, bool) {
	if naEtiqueta(p) {
		// Furo e onda na cor do fundo (no Android, a mesma cor que o sistema põe atrás).
		if math.Hypot(p.x-furoX, p.y-furoY) <= furoR || naOnda(p) {
			return cor, true
		}
		return branco, true
	}
	switch fundo {
	case Cheio:
		return cor, true
	case Arredondado:
		return cor, dentroArredondado(p, 0, 0, 100, 100, raioCanto, true, true)
	}
	return color.RGBA{}, false
}

// Desenhar devolve o ícone com o quadrado arredondado na cor pedida.
func Desenhar(cor color.RGBA, lado int) *image.RGBA {
	return DesenharCom(cor, lado, Arredondado)
}

// DesenharCom permite escolher o fundo (ver Fundo).
func DesenharCom(cor color.RGBA, lado int, fundo Fundo) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, lado, lado))
	escala := 100 / float64(lado)
	for py := 0; py < lado; py++ {
		for px := 0; px < lado; px++ {
			var r, g, b, a float64
			for sy := 0; sy < amostras; sy++ {
				for sx := 0; sx < amostras; sx++ {
					p := ponto{(float64(px) + (float64(sx)+0.5)/amostras) * escala, (float64(py) + (float64(sy)+0.5)/amostras) * escala}
					c, ok := corEm(p, cor, fundo)
					if !ok {
						continue
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
	return PNGCom(cor, lado, Arredondado)
}

// PNGCom: PNG com o fundo escolhido.
func PNGCom(cor color.RGBA, lado int, fundo Fundo) []byte {
	var b bytes.Buffer
	_ = png.Encode(&b, DesenharCom(cor, lado, fundo))
	return b.Bytes()
}
