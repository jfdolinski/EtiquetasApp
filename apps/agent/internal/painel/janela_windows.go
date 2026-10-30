//go:build windows

package painel

import (
	_ "embed"
	"encoding/base64"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"

	"etiquetas/agente/internal/icone"
)

//go:embed pagina.html
var pagina string

const (
	larguraJanela = 470
	alturaJanela  = 720
	// Página de download do WebView2 Runtime (já vem no Windows 11 e no Windows 10 atualizado).
	urlWebView2 = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
)

// abrirJanela mostra a janela de status (ou traz para a frente a que já está aberta).
// Cada janela roda numa thread própria do sistema, com o laço de mensagens do WebView2.
func (p *Painel) abrirJanela() {
	p.mu.Lock()
	if p.janela != 0 {
		h := p.janela
		p.mu.Unlock()
		trazerParaFrente(h)
		return
	}
	if p.abrindo {
		p.mu.Unlock()
		return
	}
	p.abrindo = true
	p.mu.Unlock()

	go func() {
		runtime.LockOSThread() // a thread morre junto com a goroutine
		_ = windows.CoInitializeEx(0, windows.COINIT_APARTMENTTHREADED)
		escala := escalaTela()
		largura, altura := int(larguraJanela*escala), int(alturaJanela*escala)

		w := webview2.NewWithOptions(webview2.WebViewOptions{
			// Por padrão o WebView2 grava ao lado do .exe; em Arquivos de Programas não pode.
			DataPath:  filepath.Join(os.Getenv("LOCALAPPDATA"), "EtiquetasAgente", "WebView2"),
			AutoFocus: true,
			WindowOptions: webview2.WindowOptions{
				Title:  "Agente de Etiquetas",
				Width:  uint(largura),
				Height: uint(altura),
				IconId: 1, // ícone do executável (rsrc), quando houver
				Center: true,
			},
		})
		if w == nil {
			p.mu.Lock()
			p.abrindo = false
			p.mu.Unlock()
			mensagem("Agente de Etiquetas", "Não foi possível abrir a janela do agente.\n\nInstale o Microsoft Edge WebView2 Runtime (gratuito) e tente de novo. A página de download será aberta agora.\n\nO agente continua funcionando normalmente.", true)
			_ = abrir(urlWebView2)
			return
		}
		hwnd := uintptr(w.Window())
		lado := int(32 * escala)
		definirIcone(hwnd, icone.PNG(icone.Azul, lado), lado)
		w.SetSize(largura, altura, webview2.HintFixed)

		_ = w.Bind("estado", p.visaoDaPagina)
		_ = w.Bind("ativar", p.ativar)
		_ = w.Bind("iniciar", func() { go p.acaoAdmin("Iniciando o agente…", "Agente iniciado.", "iniciar") })
		_ = w.Bind("reiniciar", func() { go p.acaoAdmin("Reiniciando o agente…", "Agente reiniciado.", "reiniciar") })
		_ = w.Bind("instalar", p.instalar)
		_ = w.Bind("removerCopiasAntigas", p.removerCopiasAntigas)
		_ = w.Bind("abrirSistema", p.abrirSistema)
		_ = w.Bind("impressoras", p.visaoImpressoras)
		_ = w.Bind("atualizarCadastradas", p.atualizarCadastradas)
		_ = w.Bind("procurarNaRede", p.procurarNaRede)
		_ = w.Bind("testarImpressora", p.testarImpressora)
		_ = w.Bind("cadastrarImpressora", p.cadastrarImpressora)
		// Configurações > Barra de tarefas, onde se liga o ícone em "Outros ícones da bandeja".
		_ = w.Bind("configurarIcone", func() { _ = abrir("ms-settings:taskbar") })
		_ = w.Bind("fechar", func() { fecharJanela(hwnd) })
		w.SetHtml(strings.Replace(pagina, "{{ICONE}}", base64.StdEncoding.EncodeToString(icone.PNG(icone.Azul, 64)), 1))

		p.mu.Lock()
		p.janela, p.abrindo = hwnd, false
		// Mensagem de uma ação antiga não deve aparecer ao reabrir.
		if !p.operacao.Andamento {
			p.operacao = Operacao{}
		}
		p.mu.Unlock()
		trazerParaFrente(hwnd)

		w.Run()

		p.mu.Lock()
		p.janela = 0
		p.mu.Unlock()
	}()
}
