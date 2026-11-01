// Comando assinar-versao: chaves e assinatura das atualizações do agente. A chave privada nunca vai
// para o servidor; no GitHub ela fica no segredo AGENTE_CHAVE_PRIVADA (ver docs/DEPLOY.md).
//
//	assinar-versao gerar-chaves <arquivo-da-chave-privada>
//	AGENTE_CHAVE_PRIVADA=... assinar-versao assinar <versao> <executavel>   # assinatura na saída padrão
package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"strings"

	"etiquetas/agente/internal/atualizacao"
)

func main() {
	if err := executar(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "erro:", err)
		os.Exit(1)
	}
}

func executar(args []string) error {
	switch {
	case len(args) == 2 && args[0] == "gerar-chaves":
		pub, priv, err := ed25519.GenerateKey(nil)
		if err != nil {
			return err
		}
		// O_EXCL: rodar de novo não apaga a chave que já está em uso.
		f, err := os.OpenFile(args[1], os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			return err
		}
		defer f.Close()
		if _, err := f.WriteString(base64.StdEncoding.EncodeToString(priv) + "\n"); err != nil {
			return err
		}
		fmt.Println("Chave privada gravada em", args[1])
		fmt.Println("Chave pública (variável AGENTE_CHAVE_PUBLICA):", base64.StdEncoding.EncodeToString(pub))
		return nil
	case len(args) == 3 && args[0] == "assinar":
		priv, err := base64.StdEncoding.DecodeString(strings.TrimSpace(os.Getenv("AGENTE_CHAVE_PRIVADA")))
		if err != nil || len(priv) != ed25519.PrivateKeySize {
			return fmt.Errorf("AGENTE_CHAVE_PRIVADA ausente ou inválida")
		}
		f, err := os.Open(args[2])
		if err != nil {
			return err
		}
		defer f.Close()
		h := sha256.New()
		if _, err := io.Copy(h, f); err != nil {
			return err
		}
		sha := hex.EncodeToString(h.Sum(nil))
		fmt.Println(base64.StdEncoding.EncodeToString(ed25519.Sign(priv, atualizacao.MensagemAssinada(args[1], sha))))
		return nil
	}
	return fmt.Errorf("uso: assinar-versao gerar-chaves <arquivo> | assinar <versao> <executavel>")
}
