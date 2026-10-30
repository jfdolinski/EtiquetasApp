// Gera os recursos do executável do agente no Windows (ícone, versão e manifesto):
//
//	cd apps/agent/tools/recursos && go run . ../../cmd/etiquetas-agente/rsrc_windows_amd64.syso
//
// O Go inclui o .syso sozinho ao compilar para windows/amd64. Rode de novo se mudar o
// desenho do ícone (internal/icone). Módulo separado para o agente não depender do winres.
package main

import (
	"fmt"
	"image"
	"os"

	"github.com/tc-hib/winres"
	"github.com/tc-hib/winres/version"

	"etiquetas/agente/internal/icone"
)

const portuguesBrasil = 0x0416

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "uso: go run . <saida.syso>")
		os.Exit(2)
	}
	rs := &winres.ResourceSet{}

	var imagens []image.Image
	for _, t := range []int{16, 20, 24, 32, 40, 48, 64, 128, 256} {
		imagens = append(imagens, icone.Desenhar(icone.Azul, t))
	}
	ico, err := winres.NewIconFromImages(imagens)
	falhar(err)
	// ID 1: o Explorer usa o primeiro ícone e o painel carrega a janela com IconId 1.
	falhar(rs.SetIcon(winres.ID(1), ico))

	var vi version.Info
	vi.SetFileVersion("1.0.0.0")
	vi.SetProductVersion("1.0.0.0")
	for chave, valor := range map[string]string{
		version.ProductName:      "Agente de Etiquetas",
		version.FileDescription:  "Agente de Etiquetas",
		version.CompanyName:      "Sistema de Etiquetas",
		version.OriginalFilename: "etiquetas-agente.exe",
		version.InternalName:     "etiquetas-agente",
	} {
		falhar(vi.Set(portuguesBrasil, chave, valor))
	}
	rs.SetVersionInfo(vi)

	rs.SetManifest(winres.AppManifest{
		Description:         "Agente de Etiquetas",
		Compatibility:       winres.Win10AndAbove,
		ExecutionLevel:      winres.AsInvoker,
		DPIAwareness:        winres.DPIPerMonitorV2,
		UseCommonControlsV6: true,
	})

	f, err := os.Create(os.Args[1])
	falhar(err)
	defer f.Close()
	falhar(rs.WriteObject(f, winres.ArchAMD64))
}

func falhar(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "erro:", err)
		os.Exit(1)
	}
}
