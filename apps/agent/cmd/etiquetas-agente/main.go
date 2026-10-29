// etiquetas-agente: agente local do Sistema de Etiquetas.
//
//	etiquetas-agente ativar     pede servidor, CNPJ e código de ativação e grava o token
//	etiquetas-agente executar   roda em primeiro plano (padrão sem argumentos)
//	etiquetas-agente instalar   instala como serviço do sistema (Windows/systemd) e inicia
//	etiquetas-agente desinstalar | iniciar | parar | status | versao
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"

	"github.com/kardianos/service"

	"etiquetas/agente/internal/cliente"
	"etiquetas/agente/internal/config"
)

// Preenchidas no build: -ldflags "-X main.versao=1.0.0 -X main.servidorPadrao=https://etiquetas.exemplo.com"
var (
	versao         = "dev"
	servidorPadrao = ""
)

const usoGeral = `Uso: etiquetas-agente [comando] [opções]

Comandos:
  ativar       ativa este agente (servidor, CNPJ e código gerado no painel)
  executar     conecta ao servidor em primeiro plano (padrão)
  instalar     instala e inicia como serviço do sistema (requer administrador/root)
  desinstalar  para e remove o serviço
  iniciar      inicia o serviço
  parar        para o serviço
  status       mostra o estado do serviço
  versao       mostra a versão

Opções:
`

type programa struct {
	caminhoConfig string
	log           *slog.Logger
	cancelar      context.CancelFunc
	fim           chan struct{}
}

func (p *programa) Start(s service.Service) error {
	cfg, err := config.Carregar(p.caminhoConfig)
	if err != nil {
		return err
	}
	if !cfg.Ativado() {
		return errors.New("agente não ativado: execute 'etiquetas-agente ativar' antes de iniciar o serviço")
	}
	ctx, cancelar := context.WithCancel(context.Background())
	p.cancelar = cancelar
	p.fim = make(chan struct{})
	go func() {
		defer close(p.fim)
		err := cliente.Novo(*cfg, p.caminhoConfig, versao, p.log).Executar(ctx)
		if err != nil {
			p.log.Error("agente parou", "erro", err)
			os.Exit(2) // como serviço, o gerenciador registra a falha

		}
	}()
	return nil
}

func (p *programa) Stop(s service.Service) error {
	if p.cancelar != nil {
		p.cancelar()
		<-p.fim
	}
	return nil
}

func main() {
	comando := "executar"
	args := os.Args[1:]
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		comando, args = args[0], args[1:]
	}

	flags := flag.NewFlagSet("etiquetas-agente", flag.ExitOnError)
	caminhoConfig := flags.String("config", config.CaminhoPadrao(), "arquivo de configuração")
	servidor := flags.String("servidor", "", "endereço do servidor (ex.: https://etiquetas.exemplo.com)")
	cnpj := flags.String("cnpj", "", "CNPJ da empresa (ativar)")
	codigo := flags.String("codigo", "", "código de ativação gerado no painel (ativar)")
	arquivoLog := flags.String("log", "", "grava o log neste arquivo além da saída padrão")
	flags.Usage = func() {
		fmt.Fprint(flags.Output(), usoGeral)
		flags.PrintDefaults()
	}
	_ = flags.Parse(args)

	log, fecharLog, err := abrirLog(*arquivoLog)
	if err != nil {
		sair(err)
	}
	defer fecharLog()

	p := &programa{caminhoConfig: *caminhoConfig, log: log}
	svc, err := service.New(p, &service.Config{
		Name:        "EtiquetasAgente",
		DisplayName: "Sistema de Etiquetas - Agente",
		Description: "Conecta o Sistema de Etiquetas aos bancos do ERP e às impressoras desta rede.",
		Arguments:   argumentosServico(*caminhoConfig, *arquivoLog),
		Option:      service.KeyValue{"OnFailure": "restart", "Restart": "always"},
	})
	if err != nil {
		sair(err)
	}

	switch comando {
	case "versao", "version":
		fmt.Println("etiquetas-agente", versao)
	case "ativar":
		if err := ativar(*caminhoConfig, *servidor, *cnpj, *codigo, log); err != nil {
			sair(err)
		}
	case "executar":
		if err := garantirAtivado(*caminhoConfig, *servidor, *cnpj, *codigo, log); err != nil {
			sair(err)
		}
		if err := svc.Run(); err != nil {
			sair(err)
		}
	case "instalar":
		if err := garantirAtivado(*caminhoConfig, *servidor, *cnpj, *codigo, log); err != nil {
			sair(err)
		}
		if err := svc.Install(); err != nil {
			sair(fmt.Errorf("não foi possível instalar o serviço (execute como administrador): %w", err))
		}
		if err := svc.Start(); err != nil {
			sair(err)
		}
		fmt.Println("Serviço instalado e iniciado.")
	case "desinstalar":
		_ = svc.Stop()
		if err := svc.Uninstall(); err != nil {
			sair(err)
		}
		fmt.Println("Serviço removido.")
	case "iniciar":
		if err := svc.Start(); err != nil {
			sair(err)
		}
	case "parar":
		if err := svc.Stop(); err != nil {
			sair(err)
		}
	case "status":
		st, err := svc.Status()
		if err != nil {
			sair(err)
		}
		fmt.Println(map[service.Status]string{
			service.StatusRunning: "em execução", service.StatusStopped: "parado", service.StatusUnknown: "desconhecido",
		}[st])
	default:
		flags.Usage()
		os.Exit(2)
	}
}

func garantirAtivado(caminho, servidor, cnpj, codigo string, log *slog.Logger) error {
	cfg, err := config.Carregar(caminho)
	if err != nil {
		return err
	}
	if cfg.Ativado() && servidor == "" {
		return nil
	}
	if cfg.Ativado() {
		// Só troca o endereço do servidor (ex.: mudança de domínio), mantendo o token.
		s, err := config.NormalizarServidor(servidor)
		if err != nil {
			return err
		}
		cfg.Servidor = s
		return config.Salvar(caminho, cfg)
	}
	if !service.Interactive() {
		return errors.New("agente não ativado: execute 'etiquetas-agente ativar'")
	}
	return ativar(caminho, servidor, cnpj, codigo, log)
}

func ativar(caminho, servidor, cnpj, codigo string, log *slog.Logger) error {
	cfg, err := config.Carregar(caminho)
	if err != nil {
		return err
	}
	entrada := bufio.NewReader(os.Stdin)
	if servidor == "" {
		servidor = cfg.Servidor
	}
	if servidor == "" {
		servidor = servidorPadrao
	}
	if servidor == "" {
		servidor = perguntar(entrada, "Endereço do servidor (ex.: https://etiquetas.suaempresa.com.br): ")
	}
	if servidor, err = config.NormalizarServidor(servidor); err != nil {
		return err
	}
	if cnpj == "" {
		cnpj = perguntar(entrada, "CNPJ da empresa: ")
	}
	if codigo == "" {
		codigo = perguntar(entrada, "Código de ativação (gerado no painel, em Agentes): ")
	}

	hostname, _ := os.Hostname()
	r, err := cliente.Ativar(context.Background(), servidor, cnpj, codigo, hostname)
	if err != nil {
		return err
	}
	cfg.Servidor, cfg.Token, cfg.AgenteID = servidor, r.Token, r.AgenteID
	if err := config.Salvar(caminho, cfg); err != nil {
		return fmt.Errorf("ativado, mas não foi possível gravar %s (execute como administrador): %w", caminho, err)
	}
	log.Info("agente ativado", "empresa", r.EmpresaNome, "agente", r.AgenteNome, "config", caminho)
	fmt.Printf("Agente \"%s\" ativado para %s.\n", r.AgenteNome, r.EmpresaNome)
	return nil
}

func perguntar(entrada *bufio.Reader, pergunta string) string {
	fmt.Print(pergunta)
	linha, _ := entrada.ReadString('\n')
	return strings.TrimSpace(linha)
}

// argumentosServico repassa ao serviço só o que difere do padrão.
func argumentosServico(caminhoConfig, arquivoLog string) []string {
	args := []string{"executar"}
	if caminhoConfig != config.CaminhoPadrao() {
		args = append(args, "-config", caminhoConfig)
	}
	if arquivoLog != "" {
		args = append(args, "-log", arquivoLog)
	}
	return args
}

func abrirLog(caminho string) (*slog.Logger, func(), error) {
	var saida io.Writer = os.Stderr
	fechar := func() {}
	if caminho != "" {
		f, err := os.OpenFile(caminho, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			return nil, nil, err
		}
		saida = io.MultiWriter(os.Stderr, f)
		fechar = func() { f.Close() }
	}
	return slog.New(slog.NewTextHandler(saida, nil)), fechar, nil
}

func sair(err error) {
	fmt.Fprintln(os.Stderr, "erro:", err)
	os.Exit(1)
}
