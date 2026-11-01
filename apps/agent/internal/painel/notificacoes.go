package painel

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"etiquetas/agente/internal/estado"
)

const (
	// Aviso mais antigo que isso não vira balão (computador ficou desligado, por exemplo).
	validadeBalao = 12 * time.Hour
	maxBaloes     = 3
	maxVistas     = 60
)

// BaloesNovos separa o que ainda não apareceu para este usuário, do mais antigo ao mais novo.
// O que passar de maxBaloes vira um resumo: uma fila longa de balões atrapalharia quem trabalha.
func BaloesNovos(lista []estado.Notificacao, vistas map[string]bool, agora time.Time) (baloes []estado.Notificacao, excedentes int) {
	for i := len(lista) - 1; i >= 0; i-- {
		n := lista[i]
		if !vistas[n.ID] && agora.Sub(n.Hora) <= validadeBalao {
			baloes = append(baloes, n)
		}
	}
	if len(baloes) > maxBaloes {
		excedentes = len(baloes) - maxBaloes
		baloes = baloes[excedentes:]
	}
	return baloes, excedentes
}

// LembrarVistas junta os ids atuais aos já vistos, sem crescer para sempre.
func LembrarVistas(vistas []string, lista []estado.Notificacao) []string {
	ja := map[string]bool{}
	for _, v := range vistas {
		ja[v] = true
	}
	for i := len(lista) - 1; i >= 0; i-- {
		if !ja[lista[i].ID] {
			vistas = append(vistas, lista[i].ID)
			ja[lista[i].ID] = true
		}
	}
	if len(vistas) > maxVistas {
		vistas = vistas[len(vistas)-maxVistas:]
	}
	return vistas
}

// O que já apareceu fica por usuário do Windows: o status é único no computador.
func caminhoVistas() string {
	return filepath.Join(os.Getenv("LOCALAPPDATA"), "EtiquetasAgente", "notificacoes-vistas.json")
}

func lerVistas(caminho string) []string {
	var vistas []string
	if dados, err := os.ReadFile(caminho); err == nil {
		_ = json.Unmarshal(dados, &vistas)
	}
	return vistas
}

func gravarVistas(caminho string, vistas []string) {
	dados, err := json.Marshal(vistas)
	if err != nil || os.MkdirAll(filepath.Dir(caminho), 0o755) != nil {
		return
	}
	_ = os.WriteFile(caminho, dados, 0o600)
}
