package cliente

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type pedidoAtivacao struct {
	CNPJ     string `json:"cnpj"`
	Codigo   string `json:"codigo"`
	Hostname string `json:"hostname,omitempty"`
}

type RespostaAtivacao struct {
	Token       string `json:"token"`
	AgenteID    string `json:"agenteId"`
	AgenteNome  string `json:"agenteNome"`
	EmpresaNome string `json:"empresaNome"`
}

// Ativar troca CNPJ + código de ativação (gerado no painel) pelo token do agente.
func Ativar(ctx context.Context, servidor, cnpj, codigo, hostname string) (*RespostaAtivacao, error) {
	corpo, _ := json.Marshal(pedidoAtivacao{CNPJ: cnpj, Codigo: codigo, Hostname: hostname})
	ctx, cancelar := context.WithTimeout(ctx, 30*time.Second)
	defer cancelar()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, servidor+"/api/agente/ativar", bytes.NewReader(corpo))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "etiquetas-agente")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("não foi possível falar com o servidor %s: %w", servidor, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ativação recusada (%d): %s", resp.StatusCode, mensagemDeErro(resp))
	}
	var r RespostaAtivacao
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil || r.Token == "" {
		return nil, fmt.Errorf("resposta inesperada do servidor (verifique o endereço %s)", servidor)
	}
	return &r, nil
}

// mensagemDeErro extrai `message` do corpo de erro do NestJS.
func mensagemDeErro(resp *http.Response) string {
	var corpo struct {
		Message any `json:"message"`
	}
	if json.NewDecoder(resp.Body).Decode(&corpo) == nil && corpo.Message != nil {
		if lista, ok := corpo.Message.([]any); ok && len(lista) > 0 {
			return fmt.Sprint(lista[0])
		}
		return fmt.Sprint(corpo.Message)
	}
	return resp.Status
}
