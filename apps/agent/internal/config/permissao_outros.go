//go:build !windows

package config

import "os"

func protegerDiretorio(dir string) error { return os.Chmod(dir, 0o700) }
