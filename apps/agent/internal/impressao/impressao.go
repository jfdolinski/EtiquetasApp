// Package impressao entrega os bytes já gerados pelo servidor (ZPL, PPLA, PPLB, ESC/POS)
// à impressora: direto pela rede (RAW, porta 9100) ou pelo spooler do sistema.
package impressao

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"
	"time"
)

const (
	MetodoRede    = "REDE"
	MetodoSistema = "SISTEMA"

	tempoConexao = 10 * time.Second
	tempoEnvio   = 60 * time.Second
	tamanhoMax   = 32 << 20
)

// Imprimir envia `dados` sem conversão (RAW). Só volta sem erro depois de entregar tudo.
func Imprimir(ctx context.Context, metodo, endereco, nome string, dados []byte) error {
	if len(dados) == 0 {
		return errors.New("trabalho sem conteúdo")
	}
	if len(dados) > tamanhoMax {
		return fmt.Errorf("trabalho grande demais (%d bytes)", len(dados))
	}
	switch metodo {
	case MetodoRede:
		return imprimirRede(ctx, endereco, dados)
	case MetodoSistema:
		if endereco == "" {
			return errors.New("informe o nome da impressora do sistema")
		}
		return imprimirSistema(ctx, endereco, nome, dados)
	}
	return fmt.Errorf("método de impressão desconhecido: %s", metodo)
}

func imprimirRede(ctx context.Context, endereco string, dados []byte) error {
	host, porta, err := net.SplitHostPort(endereco)
	if err != nil {
		return fmt.Errorf("endereço da impressora inválido (%s): use IP:porta", endereco)
	}
	if p, err := strconv.Atoi(porta); err != nil || p < 1 || p > 65535 || host == "" {
		return fmt.Errorf("endereço da impressora inválido: %s", endereco)
	}

	d := net.Dialer{Timeout: tempoConexao}
	conn, err := d.DialContext(ctx, "tcp", endereco)
	if err != nil {
		return fmt.Errorf("não foi possível conectar à impressora %s: %w", endereco, err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(tempoEnvio))
	if _, err := conn.Write(dados); err != nil {
		return fmt.Errorf("falha ao enviar para a impressora %s: %w", endereco, err)
	}
	// Fecha a escrita e espera a impressora encerrar (ou o prazo curto), para não cortar o fim do envio.
	if tcp, ok := conn.(*net.TCPConn); ok {
		_ = tcp.CloseWrite()
		_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		buf := make([]byte, 256)
		for {
			if _, err := conn.Read(buf); err != nil {
				break
			}
		}
	}
	return nil
}
