package atualizacao

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"
)

// ArquivoAssinatura fica em /downloads/, ao lado do executável.
const ArquivoAssinatura = NomeExecutavel + ".sig"

// ChavePublica vem do build de uma versão assinada. Vazia (builds sem assinatura), a integridade
// depende só do HTTPS e do SHA-256, como antes. Preenchida, invadir o servidor não basta: a chave
// privada fica fora dele, e o agente recusa o que não foi assinado antes mesmo de executar.
var ChavePublica = ""

// MensagemAssinada amarra o arquivo à versão: uma versão antiga assinada não passa por uma mais nova.
func MensagemAssinada(versao, sha256Hex string) []byte {
	return []byte("etiquetas-agente|" + versao + "|" + strings.ToLower(sha256Hex))
}

func ConferirAssinatura(chavePublica, versao, sha256Hex, assinatura string) error {
	chave, err := base64.StdEncoding.DecodeString(strings.TrimSpace(chavePublica))
	if err != nil || len(chave) != ed25519.PublicKeySize {
		return errors.New("chave pública de atualização inválida neste agente")
	}
	sig, err := base64.StdEncoding.DecodeString(strings.TrimSpace(assinatura))
	if err != nil || len(sig) != ed25519.SignatureSize {
		return errors.New("assinatura da atualização em formato inválido")
	}
	if !ed25519.Verify(ed25519.PublicKey(chave), MensagemAssinada(versao, sha256Hex), sig) {
		return errors.New("a assinatura da atualização não confere")
	}
	return nil
}

func exigirAssinatura(ctx context.Context, servidor, versao, sha256Hex string) error {
	if ChavePublica == "" {
		return nil
	}
	r, err := abrir(ctx, servidor, ArquivoAssinatura)
	if err != nil {
		return fmt.Errorf("versão sem assinatura recusada: %w", err)
	}
	defer r.Body.Close()
	dados, err := io.ReadAll(io.LimitReader(r.Body, 1024))
	if err != nil {
		return err
	}
	return ConferirAssinatura(ChavePublica, versao, sha256Hex, string(dados))
}
