// Package config guarda o mínimo que o agente precisa localmente: endereço do
// servidor e token. Conexões de banco e SQL vêm sempre do servidor e ficam só em memória.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

type Config struct {
	Servidor string `json:"servidor"`
	Token    string `json:"token,omitempty"`
	AgenteID string `json:"agenteId,omitempty"`
}

func (c *Config) Ativado() bool { return c.Token != "" }

// CaminhoPadrao: %ProgramData%\EtiquetasAgente no Windows (serviço roda como LocalSystem),
// /etc/etiquetas-agente como root no Linux, senão o diretório de configuração do usuário.
func CaminhoPadrao() string {
	if runtime.GOOS == "windows" {
		base := os.Getenv("ProgramData")
		if base == "" {
			base = `C:\ProgramData`
		}
		return filepath.Join(base, "EtiquetasAgente", "agente.json")
	}
	if os.Geteuid() == 0 {
		return "/etc/etiquetas-agente/agente.json"
	}
	if dir, err := os.UserConfigDir(); err == nil {
		return filepath.Join(dir, "etiquetas-agente", "agente.json")
	}
	return "agente.json"
}

// Carregar devolve configuração vazia se o arquivo ainda não existe.
func Carregar(caminho string) (*Config, error) {
	dados, err := os.ReadFile(caminho)
	if errors.Is(err, fs.ErrNotExist) {
		return &Config{}, nil
	}
	if err != nil {
		return nil, err
	}
	var c Config
	if err := json.Unmarshal(dados, &c); err != nil {
		return nil, fmt.Errorf("arquivo de configuração inválido (%s): %w", caminho, err)
	}
	return &c, nil
}

// Salvar grava de forma atômica (arquivo temporário + rename) com permissão 0600.
func Salvar(caminho string, c *Config) error {
	dir := filepath.Dir(caminho)
	if _, err := os.Stat(dir); errors.Is(err, fs.ErrNotExist) {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
		if err := protegerDiretorio(dir); err != nil {
			return fmt.Errorf("não foi possível restringir as permissões de %s: %w", dir, err)
		}
	}
	dados, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(caminho), ".agente-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(dados); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(0o600); err != nil && runtime.GOOS != "windows" {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), caminho)
}

// NormalizarServidor aceita "etiquetas.exemplo.com" ou URL completa e devolve
// "https://host[:porta]" sem barra final.
func NormalizarServidor(s string) (string, error) {
	s = strings.TrimSpace(strings.TrimRight(strings.TrimSpace(s), "/"))
	if s == "" {
		return "", errors.New("informe o endereço do servidor")
	}
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	if !strings.HasPrefix(s, "https://") && !strings.HasPrefix(s, "http://") {
		return "", fmt.Errorf("endereço do servidor inválido: %s", s)
	}
	s = strings.TrimSuffix(s, "/api")
	return s, nil
}

// URLWebSocket converte https→wss e http→ws.
func URLWebSocket(servidor, caminho string) string {
	if rest, ok := strings.CutPrefix(servidor, "https://"); ok {
		return "wss://" + rest + caminho
	}
	return "ws://" + strings.TrimPrefix(servidor, "http://") + caminho
}
