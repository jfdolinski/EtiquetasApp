//go:build windows

package main

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/kardianos/service"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
	"golang.org/x/sys/windows/svc/mgr"

	"etiquetas/agente/internal/config"
	"etiquetas/agente/internal/painel"
)

// No Windows, dois cliques abrem o painel. O executável é compilado como aplicativo
// gráfico (-H windowsgui), sem janela de console.
const comandoPadrao = "painel"

// Sem console próprio não dá para perguntar: a ativação vem por opções ou pelo painel.
const podePerguntar = false

const (
	chaveInicio = `Software\Microsoft\Windows\CurrentVersion\Run`
	nomeInicio  = "EtiquetasAgente"
)

var procAttachConsole = windows.NewLazySystemDLL("kernel32.dll").NewProc("AttachConsole")

// anexarConsole: aplicativo gráfico chamado pelo prompt de comando escreve nele.
func anexarConsole() {
	// Saída já redirecionada (arquivo ou pipe de um script): mantém.
	if h, err := windows.GetStdHandle(windows.STD_OUTPUT_HANDLE); err == nil && h != 0 && h != windows.InvalidHandle {
		if t, _ := windows.GetFileType(h); t != windows.FILE_TYPE_UNKNOWN {
			return
		}
	}
	const attachParentProcess = ^uintptr(0) // (DWORD)-1
	if r, _, _ := procAttachConsole.Call(attachParentProcess); r == 0 {
		return // sem console pai (ex.: serviço) ou já tem console próprio
	}
	if f, err := os.OpenFile("CONOUT$", os.O_WRONLY, 0); err == nil {
		os.Stdout, os.Stderr = f, f
	}
}

func abrirPainel(oculto bool) error {
	return painel.Executar(painel.Opcoes{Versao: versao, ServidorPadrao: servidorPadrao, Oculto: oculto})
}

// prepararExecutavel para o serviço (se estiver rodando) e copia este programa para
// Arquivos de Programas, de onde o serviço e o painel passam a rodar.
func prepararExecutavel(svc service.Service) (string, error) {
	destino := config.ExecutavelInstalado()
	origem, err := os.Executable()
	if err != nil {
		return destino, err
	}
	if st, err := svc.Status(); err == nil && st == service.StatusRunning {
		_ = svc.Stop()
	}
	if strings.EqualFold(filepath.Clean(origem), filepath.Clean(destino)) {
		return destino, nil
	}
	if err := os.MkdirAll(filepath.Dir(destino), 0o755); err != nil {
		return destino, err
	}
	if err := copiar(origem, destino); err != nil {
		// Em uso (painel aberto por outro usuário): o Windows deixa renomear um
		// executável em uso, então tira o antigo do caminho e copia de novo.
		antigo := destino + ".antigo"
		_ = os.Remove(antigo)
		if os.Rename(destino, antigo) != nil {
			return destino, err
		}
		if err := copiar(origem, destino); err != nil {
			return destino, err
		}
	}
	return destino, nil
}

func copiar(origem, destino string) error {
	de, err := os.Open(origem)
	if err != nil {
		return err
	}
	defer de.Close()
	para, err := os.OpenFile(destino, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(para, de); err != nil {
		para.Close()
		return err
	}
	return para.Close()
}

// instalarOuAtualizar instala o serviço ou, se ele já existe, só aponta para o
// executável novo. Remover e recriar falha quando alguém está com o serviço aberto
// (o Windows o deixa "marcado para exclusão").
func instalarOuAtualizar(svc service.Service, executavel string, args []string) error {
	if _, err := svc.Status(); errors.Is(err, service.ErrNotInstalled) {
		return svc.Install()
	}
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	s, err := m.OpenService("EtiquetasAgente")
	if err != nil {
		return err
	}
	defer s.Close()
	c, err := s.Config()
	if err != nil {
		return err
	}
	partes := []string{windows.EscapeArg(executavel)}
	for _, a := range args {
		partes = append(partes, windows.EscapeArg(a))
	}
	c.BinaryPathName = strings.Join(partes, " ")
	c.StartType = mgr.StartAutomatic
	return s.UpdateConfig(c)
}

// registrarInicio abre o painel (escondido, só o ícone) quando qualquer usuário entra no Windows.
func registrarInicio(executavel string) error {
	k, _, err := registry.CreateKey(registry.LOCAL_MACHINE, chaveInicio, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	return k.SetStringValue(nomeInicio, windows.EscapeArg(executavel)+" painel -oculto")
}

func removerInicio() error {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, chaveInicio, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	return k.DeleteValue(nomeInicio)
}
