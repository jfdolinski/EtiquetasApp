package cliente

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// ImpressoraCadastrada é o que a API devolve das impressoras do agente.
type ImpressoraCadastrada struct {
	ID        string `json:"id"`
	Nome      string `json:"nome"`
	Linguagem string `json:"linguagem"`
	DPI       int    `json:"dpi"`
	Metodo    string `json:"metodo"`
	Endereco  string `json:"endereco"`
	Ativo     bool   `json:"ativo"`
	JaExistia bool   `json:"jaExistia,omitempty"`
}

// NovaImpressora é o cadastro feito pelo painel do agente.
type NovaImpressora struct {
	Nome      string `json:"nome"`
	Linguagem string `json:"linguagem"`
	DPI       int    `json:"dpi"`
	Metodo    string `json:"metodo"`
	Endereco  string `json:"endereco"`
	Modelo    string `json:"modelo,omitempty"`
}

const caminhoImpressoras = "/api/agente/impressoras"

func requisicaoAgente(ctx context.Context, metodo, servidor, token string, corpo any, destino any) error {
	var leitor *bytes.Reader
	if corpo != nil {
		b, err := json.Marshal(corpo)
		if err != nil {
			return err
		}
		leitor = bytes.NewReader(b)
	} else {
		leitor = bytes.NewReader(nil)
	}
	ctx, cancelar := context.WithTimeout(ctx, 20*time.Second)
	defer cancelar()
	req, err := http.NewRequestWithContext(ctx, metodo, servidor+caminhoImpressoras, leitor)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "etiquetas-agente")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("não foi possível falar com o servidor %s: %w", servidor, err)
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusUnauthorized:
		return ErrPrecisaAtivar
	case resp.StatusCode >= 300:
		return fmt.Errorf("%s", mensagemDeErro(resp))
	}
	return json.NewDecoder(resp.Body).Decode(destino)
}

// ListarImpressoras devolve as impressoras já cadastradas para este agente.
func ListarImpressoras(ctx context.Context, servidor, token string) ([]ImpressoraCadastrada, error) {
	var r []ImpressoraCadastrada
	return r, requisicaoAgente(ctx, http.MethodGet, servidor, token, nil, &r)
}

// CadastrarImpressora cria (ou devolve, se já existir) a impressora no servidor, ligada a este agente.
func CadastrarImpressora(ctx context.Context, servidor, token string, n NovaImpressora) (*ImpressoraCadastrada, error) {
	var r ImpressoraCadastrada
	if err := requisicaoAgente(ctx, http.MethodPost, servidor, token, n, &r); err != nil {
		return nil, err
	}
	return &r, nil
}
