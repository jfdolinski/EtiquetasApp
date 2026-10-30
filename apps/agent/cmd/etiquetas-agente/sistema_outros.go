//go:build !windows

package main

import (
	"errors"
	"os"

	"github.com/kardianos/service"
)

const comandoPadrao = "executar"

const podePerguntar = true

func anexarConsole() {}

func abrirPainel(bool, string) error {
	return errors.New("o painel com ícone só existe no Windows; use 'etiquetas-agente status'")
}

func prepararExecutavel(service.Service) (string, error) { return os.Executable() }

func instalarOuAtualizar(svc service.Service, _ string, _ []string) error {
	if _, err := svc.Status(); errors.Is(err, service.ErrNotInstalled) {
		return svc.Install()
	}
	return nil
}

func registrarInicio(string) error { return nil }

func removerInicio() error { return nil }
