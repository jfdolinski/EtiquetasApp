//go:build !windows

package impressao

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// imprimirSistema usa o CUPS (`lp -o raw`): os bytes vão sem conversão para a fila.
func imprimirSistema(ctx context.Context, impressora, nome string, dados []byte) error {
	if strings.HasPrefix(impressora, "-") {
		return fmt.Errorf("nome de impressora inválido: %s", impressora)
	}
	cmd := exec.CommandContext(ctx, "lp", "-d", impressora, "-o", "raw", "-t", nome)
	cmd.Stdin = bytes.NewReader(dados)
	var saida bytes.Buffer
	cmd.Stdout, cmd.Stderr = &saida, &saida
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("lp falhou: %v: %s", err, strings.TrimSpace(saida.String()))
	}
	return nil
}
