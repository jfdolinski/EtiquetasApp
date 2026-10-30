//go:build windows

package painel

import (
	"errors"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

var (
	user32  = windows.NewLazySystemDLL("user32.dll")
	shell32 = windows.NewLazySystemDLL("shell32.dll")

	procShellExecuteExW               = shell32.NewProc("ShellExecuteExW")
	procSetProcessDpiAwarenessContext = user32.NewProc("SetProcessDpiAwarenessContext")
	procGetDpiForSystem               = user32.NewProc("GetDpiForSystem")
	procShowWindow                    = user32.NewProc("ShowWindow")
	procSetForegroundWindow           = user32.NewProc("SetForegroundWindow")
	procIsIconic                      = user32.NewProc("IsIconic")
	procSendMessageW                  = user32.NewProc("SendMessageW")
	procCreateIconFromResourceEx      = user32.NewProc("CreateIconFromResourceEx")
	procPostMessageW                  = user32.NewProc("PostMessageW")
)

const nomeServico = "EtiquetasAgente"

// estadoServico consulta o serviço só com permissão de leitura (funciona sem administrador).
func estadoServico() string {
	scm, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_CONNECT)
	if err != nil {
		return ServicoDesconhecido
	}
	defer windows.CloseServiceHandle(scm)
	nome, _ := windows.UTF16PtrFromString(nomeServico)
	s, err := windows.OpenService(scm, nome, windows.SERVICE_QUERY_STATUS)
	if errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
		return ServicoNaoInstalado
	}
	if err != nil {
		return ServicoDesconhecido
	}
	defer windows.CloseServiceHandle(s)
	var st windows.SERVICE_STATUS
	if err := windows.QueryServiceStatus(s, &st); err != nil {
		return ServicoDesconhecido
	}
	switch st.CurrentState {
	case windows.SERVICE_RUNNING:
		return ServicoRodando
	case windows.SERVICE_START_PENDING, windows.SERVICE_CONTINUE_PENDING:
		return ServicoIniciando
	case windows.SERVICE_STOP_PENDING, windows.SERVICE_PAUSE_PENDING:
		return ServicoParando
	case windows.SERVICE_STOPPED, windows.SERVICE_PAUSED:
		return ServicoParado
	}
	return ServicoDesconhecido
}

// shellExecuteInfo espelha SHELLEXECUTEINFOW (o x/sys não tem ShellExecuteEx).
type shellExecuteInfo struct {
	cbSize       uint32
	fMask        uint32
	hwnd         uintptr
	lpVerb       *uint16
	lpFile       *uint16
	lpParameters *uint16
	lpDirectory  *uint16
	nShow        int32
	hInstApp     uintptr
	lpIDList     uintptr
	lpClass      *uint16
	hkeyClass    uintptr
	dwHotKey     uint32
	hIcon        uintptr
	hProcess     windows.Handle
}

const (
	seeMaskNoCloseProcess = 0x00000040
	seeMaskNoAsync        = 0x00000100
	swHide                = 0
	swShowNormal          = 1
	swRestore             = 9
)

// ErrPermissaoNegada: o usuário clicou em "Não" no pedido de permissão do Windows.
var ErrPermissaoNegada = errors.New("a permissão de administrador não foi concedida")

// executarComoAdmin abre o pedido de permissão (UAC), roda o programa escondido e
// espera terminar. Devolve o código de saída.
func executarComoAdmin(executavel string, args []string) (uint32, error) {
	partes := make([]string, len(args))
	for i, a := range args {
		partes[i] = windows.EscapeArg(a)
	}
	verbo, _ := windows.UTF16PtrFromString("runas")
	arquivo, _ := windows.UTF16PtrFromString(executavel)
	parametros, _ := windows.UTF16PtrFromString(strings.Join(partes, " "))
	info := shellExecuteInfo{
		fMask:        seeMaskNoCloseProcess | seeMaskNoAsync,
		lpVerb:       verbo,
		lpFile:       arquivo,
		lpParameters: parametros,
		nShow:        swHide,
	}
	info.cbSize = uint32(unsafe.Sizeof(info))
	if r, _, err := procShellExecuteExW.Call(uintptr(unsafe.Pointer(&info))); r == 0 {
		if errors.Is(err, windows.ERROR_CANCELLED) {
			return 0, ErrPermissaoNegada
		}
		return 0, err
	}
	if info.hProcess == 0 {
		return 0, errors.New("o Windows não devolveu o processo iniciado")
	}
	defer windows.CloseHandle(info.hProcess)
	if _, err := windows.WaitForSingleObject(info.hProcess, windows.INFINITE); err != nil {
		return 0, err
	}
	var codigo uint32
	if err := windows.GetExitCodeProcess(info.hProcess, &codigo); err != nil {
		return 0, err
	}
	return codigo, nil
}

// abrir abre um endereço no navegador padrão (ou um programa, como usuário comum).
func abrir(alvo string, args ...string) error {
	verbo, _ := windows.UTF16PtrFromString("open")
	arquivo, _ := windows.UTF16PtrFromString(alvo)
	var parametros *uint16
	if len(args) > 0 {
		partes := make([]string, len(args))
		for i, a := range args {
			partes[i] = windows.EscapeArg(a)
		}
		parametros, _ = windows.UTF16PtrFromString(strings.Join(partes, " "))
	}
	return windows.ShellExecute(0, verbo, arquivo, parametros, nil, swShowNormal)
}

func mensagem(titulo, texto string, erro bool) {
	t, _ := windows.UTF16PtrFromString(texto)
	c, _ := windows.UTF16PtrFromString(titulo)
	tipo := uint32(windows.MB_ICONINFORMATION)
	if erro {
		tipo = windows.MB_ICONERROR
	}
	_, _ = windows.MessageBox(0, t, c, tipo|windows.MB_SETFOREGROUND)
}

// ajustarDPI evita janela e ícones borrados em telas com escala acima de 100%.
func ajustarDPI() {
	if procSetProcessDpiAwarenessContext.Find() == nil {
		const perMonitorV2 = ^uintptr(3) // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
		_, _, _ = procSetProcessDpiAwarenessContext.Call(perMonitorV2)
	}
}

// escalaTela: 1.0 em 100%, 1.5 em 150%…
func escalaTela() float64 {
	if procGetDpiForSystem.Find() != nil {
		return 1
	}
	dpi, _, _ := procGetDpiForSystem.Call()
	if dpi == 0 {
		return 1
	}
	return float64(dpi) / 96
}

func trazerParaFrente(hwnd uintptr) {
	if r, _, _ := procIsIconic.Call(hwnd); r != 0 {
		_, _, _ = procShowWindow.Call(hwnd, swRestore)
	}
	_, _, _ = procSetForegroundWindow.Call(hwnd)
}

func fecharJanela(hwnd uintptr) {
	const wmClose = 0x0010
	_, _, _ = procPostMessageW.Call(hwnd, wmClose, 0, 0)
}

// definirIcone troca o ícone da janela pela etiqueta (PNG gerado em memória).
func definirIcone(hwnd uintptr, png []byte, lado int) {
	if len(png) == 0 {
		return
	}
	const lrDefaultColor = 0
	icone, _, _ := procCreateIconFromResourceEx.Call(uintptr(unsafe.Pointer(&png[0])), uintptr(len(png)), 1, 0x00030000, uintptr(lado), uintptr(lado), lrDefaultColor)
	if icone == 0 {
		return
	}
	const wmSetIcon, iconSmall, iconBig = 0x0080, 0, 1
	_, _, _ = procSendMessageW.Call(hwnd, wmSetIcon, iconSmall, icone)
	_, _, _ = procSendMessageW.Call(hwnd, wmSetIcon, iconBig, icone)
}

// encerrarAgentesAntigos fecha os processos etiquetas-agente.exe que não são este
// painel nem a cópia instalada (ex.: versão antiga aberta pela pasta Inicializar).
func encerrarAgentesAntigos(proprio, instalado string) {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return
	}
	defer windows.CloseHandle(snap)
	var e windows.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	meu := uint32(windows.GetCurrentProcessId())
	for err = windows.Process32First(snap, &e); err == nil; err = windows.Process32Next(snap, &e) {
		if e.ProcessID == meu || !strings.EqualFold(windows.UTF16ToString(e.ExeFile[:]), "etiquetas-agente.exe") {
			continue
		}
		h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.PROCESS_TERMINATE, false, e.ProcessID)
		if err != nil {
			continue // processo de outro usuário ou do serviço (SYSTEM)
		}
		buf := make([]uint16, windows.MAX_LONG_PATH)
		tam := uint32(len(buf))
		if windows.QueryFullProcessImageName(h, 0, &buf[0], &tam) == nil {
			caminho := windows.UTF16ToString(buf[:tam])
			if !strings.EqualFold(caminho, proprio) && !strings.EqualFold(caminho, instalado) {
				_ = windows.TerminateProcess(h, 0)
			}
		}
		windows.CloseHandle(h)
	}
}

// promoverIcone deixa o ícone visível ao lado do relógio (o Windows 11 esconde ícones
// novos em "^"). Só na primeira vez de cada executável: se o usuário esconder depois,
// fica escondido. O Windows cria a entrada alguns segundos depois do ícone aparecer.
func promoverIcone(executavel string) {
	const (
		chaveIcones = `Control Panel\NotifyIconSettings`
		chaveAgente = `Software\EtiquetasAgente\IconeNaBarra`
	)
	marca, _, err := registry.CreateKey(registry.CURRENT_USER, chaveAgente, registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		return
	}
	defer marca.Close()
	nomeMarca := strings.ToLower(executavel)
	if _, _, err := marca.GetIntegerValue(nomeMarca); err == nil {
		return // já promovido uma vez
	}
	for _, espera := range []time.Duration{time.Second, 4 * time.Second, 10 * time.Second, 30 * time.Second} {
		time.Sleep(espera)
		raiz, err := registry.OpenKey(registry.CURRENT_USER, chaveIcones, registry.ENUMERATE_SUB_KEYS)
		if err != nil {
			return // Windows 10: não há essa configuração
		}
		nomes, _ := raiz.ReadSubKeyNames(-1)
		raiz.Close()
		for _, nome := range nomes {
			k, err := registry.OpenKey(registry.CURRENT_USER, chaveIcones+`\`+nome, registry.QUERY_VALUE|registry.SET_VALUE)
			if err != nil {
				continue
			}
			caminho, _, _ := k.GetStringValue("ExecutablePath")
			if strings.EqualFold(caminho, executavel) {
				err = k.SetDWordValue("IsPromoted", 1)
				k.Close()
				if err == nil {
					_ = marca.SetDWordValue(nomeMarca, 1)
				}
				return
			}
			k.Close()
		}
	}
}

// instanciaUnica: a segunda execução só pede à primeira para mostrar a janela.
type instanciaUnica struct {
	mutex, evento, sair windows.Handle
}

const (
	nomeMutex  = `Local\EtiquetasAgentePainel`
	nomeEvento = `Local\EtiquetasAgentePainelMostrar`
)

const nomeEventoSair = `Local\EtiquetasAgentePainelSair`

func avisar(nome string) {
	n, _ := windows.UTF16PtrFromString(nome)
	if ev, err := windows.OpenEvent(windows.EVENT_MODIFY_STATE, false, n); err == nil {
		_ = windows.SetEvent(ev)
		windows.CloseHandle(ev)
	}
}

// adquirirInstancia devolve nil se outra instância já está aberta (e pede a ela para
// mostrar a janela). Com `assumir` (versão nova aberta fora de Arquivos de Programas),
// fecha o painel aberto e fica no lugar dele, para o usuário poder atualizar.
func adquirirInstancia(assumir bool) *instanciaUnica {
	nm, _ := windows.UTF16PtrFromString(nomeMutex)
	m, err := windows.CreateMutex(nil, false, nm)
	if errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		if m != 0 {
			windows.CloseHandle(m)
		}
		if !assumir {
			avisar(nomeEvento)
			return nil
		}
		avisar(nomeEventoSair)
		m = 0
		for tentativa := 0; tentativa < 25 && m == 0; tentativa++ {
			if tentativa == 10 {
				encerrarPaineisDaSessao() // versão antiga não conhece o pedido de sair
			}
			time.Sleep(200 * time.Millisecond)
			if h, err := windows.CreateMutex(nil, false, nm); errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
				windows.CloseHandle(h)
			} else if err == nil {
				m = h
			}
		}
		if m == 0 {
			avisar(nomeEvento)
			return nil
		}
	}
	ne, _ := windows.UTF16PtrFromString(nomeEvento)
	ev, _ := windows.CreateEvent(nil, 0, 0, ne)
	ns, _ := windows.UTF16PtrFromString(nomeEventoSair)
	sair, _ := windows.CreateEvent(nil, 0, 0, ns)
	return &instanciaUnica{mutex: m, evento: ev, sair: sair}
}

// encerrarPaineisDaSessao fecha outros etiquetas-agente.exe desta sessão do Windows (o
// painel). O serviço roda na sessão 0, como SYSTEM, e não é afetado.
func encerrarPaineisDaSessao() {
	var minhaSessao uint32
	meu := windows.GetCurrentProcessId()
	if windows.ProcessIdToSessionId(meu, &minhaSessao) != nil {
		return
	}
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return
	}
	defer windows.CloseHandle(snap)
	var e windows.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	for err = windows.Process32First(snap, &e); err == nil; err = windows.Process32Next(snap, &e) {
		if e.ProcessID == meu || !strings.EqualFold(windows.UTF16ToString(e.ExeFile[:]), "etiquetas-agente.exe") {
			continue
		}
		var sessao uint32
		if windows.ProcessIdToSessionId(e.ProcessID, &sessao) != nil || sessao != minhaSessao {
			continue
		}
		if h, err := windows.OpenProcess(windows.PROCESS_TERMINATE, false, e.ProcessID); err == nil {
			_ = windows.TerminateProcess(h, 0)
			windows.CloseHandle(h)
		}
	}
}

// aguardarSaida fecha o painel quando uma versão nova pede o lugar.
func (i *instanciaUnica) aguardarSaida(sair func()) {
	if i.sair == 0 {
		return
	}
	if r, err := windows.WaitForSingleObject(i.sair, windows.INFINITE); err == nil && r == windows.WAIT_OBJECT_0 {
		sair()
	}
}

// aguardarPedidos chama mostrar sempre que outra instância pede.
func (i *instanciaUnica) aguardarPedidos(mostrar func()) {
	if i.evento == 0 {
		return
	}
	for {
		r, err := windows.WaitForSingleObject(i.evento, windows.INFINITE)
		if err != nil || r != windows.WAIT_OBJECT_0 {
			return
		}
		mostrar()
	}
}

func (i *instanciaUnica) liberar() {
	if i.mutex != 0 {
		windows.CloseHandle(i.mutex)
		i.mutex = 0
	}
	if i.evento != 0 {
		windows.CloseHandle(i.evento)
		i.evento = 0
	}
	if i.sair != 0 {
		windows.CloseHandle(i.sair)
		i.sair = 0
	}
}
