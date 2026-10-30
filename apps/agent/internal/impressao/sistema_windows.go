//go:build windows

package impressao

import (
	"context"
	"fmt"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	winspool         = syscall.NewLazyDLL("winspool.drv")
	procOpenPrinter  = winspool.NewProc("OpenPrinterW")
	procClosePrinter = winspool.NewProc("ClosePrinter")
	procStartDoc     = winspool.NewProc("StartDocPrinterW")
	procEndDoc       = winspool.NewProc("EndDocPrinter")
	procStartPage    = winspool.NewProc("StartPagePrinter")
	procEndPage      = winspool.NewProc("EndPagePrinter")
	procWritePrinter = winspool.NewProc("WritePrinter")
)

var (
	procEnumPrinters      = winspool.NewProc("EnumPrintersW")
	procGetDefaultPrinter = winspool.NewProc("GetDefaultPrinterW")
)

// printerInfo2 = PRINTER_INFO_2W (só os campos lidos têm nome).
type printerInfo2 struct {
	servidor, nome, compartilhamento, porta, driver, comentario, local *uint16
	devMode                                                            uintptr
	separador, processador, tipoDados, parametros                      *uint16
	seguranca                                                          uintptr
	atributos, prioridade, prioridadePadrao, inicio, fim, status, jobs uint32
	ppm                                                                uint32
}

func texto(p *uint16) string { return windows.UTF16PtrToString(p) }

// listarSistema: impressoras locais e conexões de rede do usuário (EnumPrinters nível 2).
func listarSistema() ([]Encontrada, error) {
	const (
		enumLocal       = 0x2
		enumConnections = 0x4
	)
	var precisa, quantas uint32
	_, _, _ = procEnumPrinters.Call(enumLocal|enumConnections, 0, 2, 0, 0, uintptr(unsafe.Pointer(&precisa)), uintptr(unsafe.Pointer(&quantas)))
	if precisa == 0 {
		return nil, nil
	}
	buf := make([]byte, precisa)
	if r, _, e := procEnumPrinters.Call(enumLocal|enumConnections, 0, 2, uintptr(unsafe.Pointer(&buf[0])), uintptr(precisa),
		uintptr(unsafe.Pointer(&precisa)), uintptr(unsafe.Pointer(&quantas))); r == 0 {
		return nil, fmt.Errorf("não foi possível listar as impressoras do Windows: %v", e)
	}
	padrao := impressoraPadrao()
	infos := unsafe.Slice((*printerInfo2)(unsafe.Pointer(&buf[0])), quantas)
	r := make([]Encontrada, 0, quantas)
	for _, i := range infos {
		nome := texto(i.nome)
		r = append(r, Encontrada{Nome: nome, Driver: texto(i.driver), Porta: texto(i.porta), Padrao: nome == padrao})
	}
	return r, nil
}

func impressoraPadrao() string {
	var n uint32 = 512
	buf := make([]uint16, n)
	if r, _, _ := procGetDefaultPrinter.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&n))); r == 0 {
		return ""
	}
	return syscall.UTF16ToString(buf)
}

// docInfo1 = DOC_INFO_1W.
type docInfo1 struct {
	nome      *uint16
	arquivo   *uint16
	tipoDados *uint16
}

// imprimirSistema manda os bytes ao spooler com o tipo de dados RAW: o driver não
// interpreta nada, a impressora recebe ZPL/PPL/ESC-POS exatamente como gerado.
func imprimirSistema(_ context.Context, impressora, nome string, dados []byte) error {
	pNome, err := syscall.UTF16PtrFromString(impressora)
	if err != nil {
		return err
	}
	var h syscall.Handle
	if r, _, e := procOpenPrinter.Call(uintptr(unsafe.Pointer(pNome)), uintptr(unsafe.Pointer(&h)), 0); r == 0 {
		return fmt.Errorf("impressora \"%s\" não encontrada no Windows: %v", impressora, e)
	}
	defer procClosePrinter.Call(uintptr(h))

	pDoc, _ := syscall.UTF16PtrFromString(nome)
	pRaw, _ := syscall.UTF16PtrFromString("RAW")
	info := docInfo1{nome: pDoc, tipoDados: pRaw}
	if r, _, e := procStartDoc.Call(uintptr(h), 1, uintptr(unsafe.Pointer(&info))); r == 0 {
		return fmt.Errorf("falha ao iniciar o documento: %v", e)
	}
	defer procEndDoc.Call(uintptr(h))
	if r, _, e := procStartPage.Call(uintptr(h)); r == 0 {
		return fmt.Errorf("falha ao iniciar a página: %v", e)
	}
	defer procEndPage.Call(uintptr(h))

	for enviados := 0; enviados < len(dados); {
		var escritos uint32
		trecho := dados[enviados:]
		r, _, e := procWritePrinter.Call(uintptr(h), uintptr(unsafe.Pointer(&trecho[0])), uintptr(len(trecho)), uintptr(unsafe.Pointer(&escritos)))
		if r == 0 || escritos == 0 {
			return fmt.Errorf("falha ao escrever na impressora: %v", e)
		}
		enviados += int(escritos)
	}
	return nil
}
