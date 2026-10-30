// etiquetas-agente: agente local do Sistema de Etiquetas.
//
//	etiquetas-agente            Windows: abre o painel (ícone ao lado do relógio); Linux: executar
//	etiquetas-agente painel     abre o painel da bandeja (Windows)
//	etiquetas-agente ativar     ativa com servidor, CNPJ e código de ativação e grava o token
//	etiquetas-agente executar   roda em primeiro plano (é o que o serviço executa)
//	etiquetas-agente instalar   instala como serviço do sistema (Windows/systemd) e inicia
//	etiquetas-agente desinstalar | iniciar | parar | reiniciar | status | versao
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/kardianos/service"

	"etiquetas/agente/internal/cliente"
	"etiquetas/agente/internal/config"
	"etiquetas/agente/internal/estado"
)

// Preenchidas no build: -ldflags "-X main.versao=1.0.0 -X main.servidorPadrao=https://etiquetas.exemplo.com"
var (
	versao         = "dev"
	servidorPadrao = ""
)

const usoGeral = `Uso: etiquetas-agente [comando] [opções]

Comandos:
  painel       abre o painel do agente, com ícone ao lado do relógio (Windows; padrão com dois cliques)
  ativar       ativa este agente (servidor, CNPJ e código gerado no painel)
  executar     conecta ao servidor em primeiro plano (padrão no Linux)
  instalar     instala e inicia como serviço do sistema (requer administrador/root)
  desinstalar  para e remove o serviço
  iniciar      inicia o serviço
  parar        para o serviço
  reiniciar    reinicia o serviço
  status       mostra o estado do serviço
  versao       mostra a versão

Opções:
`

type programa struct {
	caminhoConfig string
	log           *slog.Logger
	cancelar      context.CancelFunc
	fim           chan struct{}
	fimEstado     chan struct{}
}

func (p *programa) Start(s service.Service) error {
	cfg, err := config.Carregar(p.caminhoConfig)
	if err != nil {
		return err
	}
	st := estado.Novo(config.CaminhoStatus(), estado.Instantaneo{
		Versao:      versao,
		Servidor:    cfg.Servidor,
		CNPJ:        cfg.CNPJ,
		EmpresaNome: cfg.EmpresaNome,
		AgenteNome:  cfg.AgenteNome,
		Ativado:     cfg.Ativado(),
	})
	if !cfg.Ativado() {
		// O painel lê isto e mostra o formulário de ativação.
		st.Atualizar(func(i *estado.Instantaneo) { i.Situacao = estado.Parado })
		_ = st.Gravar()
		return errors.New("agente não ativado: execute 'etiquetas-agente ativar' antes de iniciar o serviço")
	}
	log := p.log
	st.Evento("info", "Agente iniciado.")
	ctx, cancelar := context.WithCancel(context.Background())
	p.cancelar = cancelar
	p.fim = make(chan struct{})
	p.fimEstado = make(chan struct{})
	go func() {
		defer close(p.fimEstado)
		st.Manter(ctx)
	}()
	go func() {
		defer close(p.fim)
		for {
			c := cliente.Novo(*cfg, p.caminhoConfig, versao, log)
			c.Estado = st
			err := c.Executar(ctx)
			if err == nil {
				return // parada pedida
			}
			log.Error("agente parou", "erro", err)
			if service.Interactive() {
				os.Exit(2)
			}
			// Como serviço, sair faria o gerenciador reiniciar em loop sem resolver nada (o token
			// continua recusado). Espera e tenta de novo, relendo a configuração: o agente volta
			// sozinho se for reativado no painel ou se o técnico rodar `etiquetas-agente ativar`.
			select {
			case <-ctx.Done():
				return
			case <-time.After(esperaAposRecusa):
			}
			if novo, err := config.Carregar(p.caminhoConfig); err == nil && novo.Ativado() {
				cfg = novo
				st.Atualizar(func(i *estado.Instantaneo) {
					i.Servidor, i.CNPJ, i.EmpresaNome, i.AgenteNome = novo.Servidor, novo.CNPJ, novo.EmpresaNome, novo.AgenteNome
				})
			}
		}
	}()
	return nil
}

const esperaAposRecusa = 5 * time.Minute

func (p *programa) Stop(s service.Service) error {
	if p.cancelar != nil {
		p.cancelar()
		<-p.fim
		<-p.fimEstado
	}
	return nil
}

// arquivoResultado: quando o painel roda um comando como administrador, a saída do
// console não aparece; o resultado vai para este arquivo (opção -resultado).
var arquivoResultado string

func main() {
	comando := comandoPadrao
	args := os.Args[1:]
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		comando, args = args[0], args[1:]
	}
	if comando != "painel" {
		anexarConsole()
	}

	flags := flag.NewFlagSet("etiquetas-agente", flag.ExitOnError)
	caminhoConfig := flags.String("config", config.CaminhoPadrao(), "arquivo de configuração")
	servidor := flags.String("servidor", "", "endereço do servidor (ex.: https://etiquetas.exemplo.com)")
	cnpj := flags.String("cnpj", "", "CNPJ da empresa (ativar)")
	codigo := flags.String("codigo", "", "código de ativação gerado no painel (ativar)")
	arquivoLog := flags.String("log", "", "grava o log neste arquivo além da saída padrão")
	oculto := flags.Bool("oculto", false, "painel: só mostra a janela se o agente precisar de atenção (início com o Windows)")
	flags.StringVar(&arquivoResultado, "resultado", "", "grava o resultado do comando neste arquivo (uso interno do painel)")
	flags.Usage = func() {
		fmt.Fprint(flags.Output(), usoGeral)
		flags.PrintDefaults()
	}
	_ = flags.Parse(args)

	if comando == "painel" {
		if err := abrirPainel(*oculto); err != nil {
			sair(err)
		}
		return
	}

	log, fecharLog, err := abrirLog(*arquivoLog)
	if err != nil {
		sair(err)
	}
	defer fecharLog()

	p := &programa{caminhoConfig: *caminhoConfig, log: log}
	svc, err := novoServico(p, "", *caminhoConfig, *arquivoLog)
	if err != nil {
		sair(err)
	}

	switch comando {
	case "versao", "version":
		fmt.Println("etiquetas-agente", versao)
	case "ativar":
		r, err := ativar(*caminhoConfig, *servidor, *cnpj, *codigo, log)
		if err != nil {
			sair(err)
		}
		concluir(fmt.Sprintf("Agente %q ativado para %s.", r.AgenteNome, r.EmpresaNome))
	case "executar":
		if _, err := garantirAtivado(*caminhoConfig, *servidor, *cnpj, *codigo, log); err != nil {
			sair(err)
		}
		if err := svc.Run(); err != nil {
			sair(err)
		}
	case "instalar":
		r, err := garantirAtivado(*caminhoConfig, *servidor, *cnpj, *codigo, log)
		if err != nil {
			sair(err)
		}
		executavel, err := prepararExecutavel(svc)
		if err != nil {
			sair(fmt.Errorf("não foi possível copiar o agente para %s (execute como administrador): %w", executavel, err))
		}
		instalado, err := novoServico(p, executavel, *caminhoConfig, *arquivoLog)
		if err != nil {
			sair(err)
		}
		if err := instalarOuAtualizar(instalado, executavel, argumentosServico(*caminhoConfig, *arquivoLog)); err != nil {
			sair(fmt.Errorf("não foi possível instalar o serviço (execute como administrador): %w", err))
		}
		if err := instalado.Start(); err != nil {
			sair(fmt.Errorf("serviço instalado, mas não iniciou: %w", err))
		}
		if err := registrarInicio(executavel); err != nil {
			log.Warn("não foi possível colocar o painel para iniciar com o Windows", "erro", err)
		}
		if r != nil {
			concluir(fmt.Sprintf("Pronto! Este computador foi ativado para %s e o agente está instalado.", r.EmpresaNome))
		} else {
			concluir("Serviço instalado e iniciado.")
		}
	case "desinstalar":
		_ = svc.Stop()
		if err := svc.Uninstall(); err != nil {
			sair(err)
		}
		_ = removerInicio()
		concluir("Serviço removido.")
	case "iniciar":
		if err := svc.Start(); err != nil {
			sair(err)
		}
		concluir("Agente iniciado.")
	case "parar":
		if err := svc.Stop(); err != nil {
			sair(err)
		}
		concluir("Agente parado.")
	case "reiniciar":
		if err := svc.Restart(); err != nil {
			sair(err)
		}
		concluir("Agente reiniciado.")
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

// novoServico: `executavel` vazio = o próprio programa.
func novoServico(p *programa, executavel, caminhoConfig, arquivoLog string) (service.Service, error) {
	return service.New(p, &service.Config{
		Name:        "EtiquetasAgente",
		DisplayName: "Sistema de Etiquetas - Agente",
		Description: "Conecta o Sistema de Etiquetas aos bancos do ERP e às impressoras desta rede.",
		Executable:  executavel,
		Arguments:   argumentosServico(caminhoConfig, arquivoLog),
		Option:      service.KeyValue{"OnFailure": "restart", "Restart": "always"},
	})
}

// garantirAtivado ativa quando ainda não há token ou quando um código novo foi
// informado (reativação). Devolve a resposta da ativação, se houve.
func garantirAtivado(caminho, servidor, cnpj, codigo string, log *slog.Logger) (*cliente.RespostaAtivacao, error) {
	cfg, err := config.Carregar(caminho)
	if err != nil {
		return nil, err
	}
	if cfg.Ativado() && codigo == "" {
		if servidor == "" {
			return nil, nil
		}
		// Só troca o endereço do servidor (ex.: mudança de domínio), mantendo o token.
		s, err := config.NormalizarServidor(servidor)
		if err != nil {
			return nil, err
		}
		cfg.Servidor = s
		return nil, config.Salvar(caminho, cfg)
	}
	if !cfg.Ativado() && !service.Interactive() {
		return nil, errors.New("agente não ativado: execute 'etiquetas-agente ativar'")
	}
	return ativar(caminho, servidor, cnpj, codigo, log)
}

func ativar(caminho, servidor, cnpj, codigo string, log *slog.Logger) (*cliente.RespostaAtivacao, error) {
	cfg, err := config.Carregar(caminho)
	if err != nil {
		return nil, err
	}
	entrada := bufio.NewReader(os.Stdin)
	if servidor == "" {
		servidor = cfg.Servidor
	}
	if servidor == "" {
		servidor = servidorPadrao
	}
	if (servidor == "" || cnpj == "" || codigo == "") && !podePerguntar {
		return nil, errors.New("informe -servidor, -cnpj e -codigo, ou abra o agente com dois cliques para ativar pela janela")
	}
	if servidor == "" {
		servidor = perguntar(entrada, "Endereço do servidor (ex.: https://etiquetas.suaempresa.com.br): ")
	}
	if servidor, err = config.NormalizarServidor(servidor); err != nil {
		return nil, err
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
		return nil, err
	}
	cfg.Servidor, cfg.Token, cfg.AgenteID = servidor, r.Token, r.AgenteID
	cfg.CNPJ, cfg.EmpresaNome, cfg.AgenteNome = config.FormatarCNPJ(cnpj), r.EmpresaNome, r.AgenteNome
	if err := config.Salvar(caminho, cfg); err != nil {
		return nil, fmt.Errorf("ativado, mas não foi possível gravar %s (execute como administrador): %w", caminho, err)
	}
	log.Info("agente ativado", "empresa", r.EmpresaNome, "agente", r.AgenteNome, "config", caminho)
	return r, nil
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

func gravarResultado(ok bool, mensagem string) {
	if arquivoResultado == "" {
		return
	}
	dados, _ := json.Marshal(map[string]any{"ok": ok, "mensagem": mensagem})
	_ = os.WriteFile(arquivoResultado, dados, 0o644)
}

func concluir(mensagem string) {
	fmt.Println(mensagem)
	gravarResultado(true, mensagem)
}

func sair(err error) {
	fmt.Fprintln(os.Stderr, "erro:", err)
	gravarResultado(false, primeiraMaiuscula(err.Error()))
	os.Exit(1)
}

func primeiraMaiuscula(s string) string {
	if s == "" {
		return s
	}
	r := []rune(s)
	return strings.ToUpper(string(r[0])) + string(r[1:])
}
