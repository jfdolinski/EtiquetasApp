//go:build windows

package config

import (
	"os/exec"
	"os/user"
)

// protegerDiretorio remove a herança de permissões do diretório da configuração
// (ProgramData é legível por todos os usuários) e deixa acesso só para SYSTEM,
// Administradores e o usuário que está ativando. SIDs evitam problemas com
// Windows em outros idiomas ("Administradores" × "Administrators").
func protegerDiretorio(dir string) error {
	args := []string{dir, "/inheritance:r",
		"/grant:r", "*S-1-5-18:(OI)(CI)F", // SYSTEM
		"/grant:r", "*S-1-5-32-544:(OI)(CI)F", // Administradores
	}
	if u, err := user.Current(); err == nil {
		args = append(args, "/grant:r", u.Username+":(OI)(CI)F")
	}
	return exec.Command("icacls", args...).Run()
}
