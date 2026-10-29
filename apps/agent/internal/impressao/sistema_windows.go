//go:build windows

package impressao

import (
	"context"
	"fmt"
	"syscall"
	"unsafe"
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
