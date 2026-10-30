//go:build windows

package painel

import (
	"encoding/json"
	"errors"
	"fmt"
	"image/color"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"fyne.io/systray"

	"etiquetas/agente/internal/config"
	"etiquetas/agente/internal/estado"
	"etiquetas/agente/internal/icone"
)

type Opcoes struct {
	Versao         string
	ServidorPadrao string
	// Oculto: iniciado com o Windows; só abre a janela se o agente precisar de atenção.
	Oculto bool
	// Config: arquivo de configuração do agente (o mesmo do serviço).
	Config string
}

type Painel struct {
	op         Opcoes
	executavel string
	instancia  *instanciaUnica
	icones     map[color.RGBA][]byte

	mu       sync.Mutex
	operacao Operacao
	janela   uintptr // HWND da janela aberta (0 = fechada)
	abrindo  bool
	corAtual color.RGBA
	dica     string

	imp       impressorasPainel
	abaPedida string
}

// Executar mostra o ícone na bandeja e só volta quando o usuário fechar o ícone.
func Executar(op Opcoes) error {
	inst := adquirirInstancia()
	if inst == nil {
		return nil // já aberto: a outra instância mostra a janela
	}
	ajustarDPI()
	exe, err := os.Executable()
	if err != nil {
		inst.liberar()
		return err
	}
	p := &Painel{op: op, executavel: exe, instancia: inst, icones: map[color.RGBA][]byte{}}
	systray.Run(p.aoIniciar, inst.liberar)
	return nil
}

func (p *Painel) icone(cor color.RGBA) []byte {
	if b, ok := p.icones[cor]; ok {
		return b
	}
	b := icone.ICO(cor)
	p.icones[cor] = b
	return b
}

func corDaSituacao(s string) color.RGBA {
	switch s {
	case estado.Conectado:
		return icone.Verde
	case estado.Conectando, FaltaInstalar:
		return icone.Amarelo
	case NaoAtivado:
		return icone.Cinza
	}
	return icone.Vermelho
}

func (p *Painel) aoIniciar() {
	p.corAtual = icone.Cinza
	systray.SetIcon(p.icone(icone.Cinza))
	systray.SetTitle("Agente de Etiquetas")
	systray.SetTooltip("Agente de Etiquetas")
	systray.SetOnTapped(p.abrirJanela) // clique simples abre a janela; o direito, o menu

	mAbrir := systray.AddMenuItem("Abrir o painel", "Mostra a situação do agente")
	mImpressoras := systray.AddMenuItem("Impressoras…", "Procurar, testar e cadastrar impressoras deste computador")
	mSistema := systray.AddMenuItem("Abrir o sistema no navegador", "")
	systray.AddSeparator()
	mReiniciar := systray.AddMenuItem("Reiniciar o agente", "Pede permissão de administrador")
	systray.AddSeparator()
	mFechar := systray.AddMenuItem("Fechar este ícone", "O agente continua funcionando em segundo plano")

	go func() {
		for {
			select {
			case <-mAbrir.ClickedCh:
				p.abrirJanela()
			case <-mImpressoras.ClickedCh:
				p.mu.Lock()
				p.abaPedida = "impressoras"
				p.mu.Unlock()
				p.abrirJanela()
			case <-mSistema.ClickedCh:
				p.abrirSistema()
			case <-mReiniciar.ClickedCh:
				go p.acaoAdmin("Reiniciando o agente…", "Agente reiniciado.", "reiniciar")
			case <-mFechar.ClickedCh:
				p.mu.Lock()
				h := p.janela
				p.mu.Unlock()
				if h != 0 {
					fecharJanela(h)
				}
				systray.Quit()
				return
			}
		}
	}()
	go p.instancia.aguardarPedidos(p.abrirJanela)
	go promoverIcone(p.executavel)

	v := p.visao()
	p.atualizarIcone(v)
	if !p.op.Oculto || v.Situacao == NaoAtivado || v.Situacao == estado.Recusado {
		p.abrirJanela()
	}
	go func() {
		for range time.Tick(2 * time.Second) {
			p.atualizarIcone(p.visao())
		}
	}()
}

func (p *Painel) atualizarIcone(v Visao) {
	cor := corDaSituacao(v.Situacao)
	dica := "Agente de Etiquetas: " + v.Titulo
	if v.Status != nil && v.Status.EmpresaNome != "" {
		dica += "\n" + v.Status.EmpresaNome
	}
	if len([]rune(dica)) > 120 {
		dica = string([]rune(dica)[:120])
	}
	p.mu.Lock()
	mudouCor, mudouDica := cor != p.corAtual, dica != p.dica
	p.corAtual, p.dica = cor, dica
	p.mu.Unlock()
	if mudouCor {
		systray.SetIcon(p.icone(cor))
	}
	if mudouDica {
		systray.SetTooltip(dica)
	}
}

// visao junta o estado do serviço, o status publicado e a operação em andamento.
func (p *Painel) visao() Visao {
	st, err := estado.Ler(config.CaminhoStatus())
	if err != nil {
		st = nil
	}
	// A configuração só é legível para quem ativou e para administradores.
	cfg, err := config.Carregar(p.op.Config)
	configAtivada := err == nil && cfg.Ativado()
	servico := estadoServico()
	agora := time.Now()
	situacao, titulo, descricao := Situacao(servico, st, configAtivada, agora)
	rodando := StatusRecente(st, agora)
	if !rodando && configAtivada {
		// Agente parado ou versão antiga: identidade vem da ativação; da última execução
		// só fica a atividade (ajuda a entender por que parou).
		ativ := &estado.Instantaneo{Ativado: true, Servidor: cfg.Servidor, CNPJ: cfg.CNPJ, EmpresaNome: cfg.EmpresaNome, AgenteNome: cfg.AgenteNome}
		if st != nil {
			ativ.Eventos = st.Eventos
		}
		st = ativ
	}
	p.mu.Lock()
	op := p.operacao
	p.mu.Unlock()
	v := Visao{
		Situacao:       situacao,
		Titulo:         titulo,
		Descricao:      descricao,
		Servico:        servico,
		Status:         st,
		ServidorPadrao: p.op.ServidorPadrao,
		Versao:         p.op.Versao,
		Operacao:       op,
		AgenteRodando:  rodando,
	}
	// Com o serviço instalado, uma cópia antiga na pasta Inicializar disputa o token com ele.
	if servico != ServicoNaoInstalado {
		v.CopiasAntigas = copiasNaInicializacao()
	}
	return v
}

// instalar: já ativado (versão antiga ou `ativar`), só falta o serviço.
func (p *Painel) instalar() {
	go func() {
		if p.acaoAdmin("Instalando o agente…", "Agente instalado.", "instalar") {
			p.relancarInstalado()
		}
	}()
}

// removerCopiasAntigas encerra os agentes que não rodam de Arquivos de Programas e
// apaga as cópias e atalhos da pasta Inicializar do usuário.
func (p *Painel) removerCopiasAntigas() error {
	encerrarAgentesAntigos(p.executavel, config.ExecutavelInstalado())
	time.Sleep(500 * time.Millisecond) // o Windows solta o arquivo depois que o processo termina
	var erros []string
	for _, c := range copiasNaInicializacao() {
		if err := os.Remove(c); err != nil {
			erros = append(erros, filepath.Base(c))
		}
	}
	if len(erros) > 0 {
		return fmt.Errorf("Não foi possível apagar %s. Apague pela pasta Inicializar do Windows.", strings.Join(erros, ", "))
	}
	p.mu.Lock()
	p.operacao = Operacao{OK: "Cópia antiga removida."}
	p.mu.Unlock()
	return nil
}

// copiasNaInicializacao: executáveis e atalhos do agente na pasta Inicializar do usuário.
func copiasNaInicializacao() []string {
	pasta := filepath.Join(os.Getenv("APPDATA"), `Microsoft\Windows\Start Menu\Programs\Startup`)
	itens, err := os.ReadDir(pasta)
	if err != nil {
		return nil
	}
	var r []string
	for _, i := range itens {
		nome := strings.ToLower(i.Name())
		if strings.HasPrefix(nome, "etiquetas-agente") && (strings.HasSuffix(nome, ".exe") || strings.HasSuffix(nome, ".lnk")) {
			r = append(r, filepath.Join(pasta, i.Name()))
		}
	}
	return r
}

func (p *Painel) servidor() string {
	if st, err := estado.Ler(config.CaminhoStatus()); err == nil && st.Servidor != "" {
		return st.Servidor
	}
	return p.op.ServidorPadrao
}

func (p *Painel) abrirSistema() {
	if s := p.servidor(); s != "" {
		_ = abrir(s)
	}
}

// resultado é o que o comando elevado grava (opção -resultado de main).
type resultado struct {
	OK       bool   `json:"ok"`
	Mensagem string `json:"mensagem"`
}

// acaoAdmin roda um comando do agente como administrador e acompanha o resultado.
func (p *Painel) acaoAdmin(titulo, sucesso string, args ...string) bool {
	p.mu.Lock()
	if p.operacao.Andamento {
		p.mu.Unlock()
		return false
	}
	p.operacao = Operacao{Andamento: true, Titulo: titulo}
	p.mu.Unlock()

	arquivo := filepath.Join(os.TempDir(), fmt.Sprintf("etiquetas-agente-%d.json", time.Now().UnixNano()))
	defer os.Remove(arquivo)
	codigo, err := executarComoAdmin(p.executavel, append(args, "-resultado", arquivo))

	op := Operacao{}
	switch {
	case errors.Is(err, ErrPermissaoNegada):
		op.Erro = "Cancelado: a permissão de administrador não foi concedida."
	case err != nil:
		op.Erro = "Não foi possível executar: " + err.Error()
	default:
		var r resultado
		dados, errLer := os.ReadFile(arquivo)
		if errLer == nil {
			errLer = json.Unmarshal(dados, &r)
		}
		switch {
		case errLer == nil && r.OK:
			op.OK = sucesso
			if r.Mensagem != "" {
				op.OK = r.Mensagem
			}
		case errLer == nil:
			op.Erro = r.Mensagem
		case codigo == 0:
			op.OK = sucesso
		default:
			op.Erro = fmt.Sprintf("O comando terminou com erro (código %d).", codigo)
		}
	}
	p.mu.Lock()
	p.operacao = op
	p.mu.Unlock()
	return op.Erro == ""
}

// ativar instala o agente como serviço com o código gerado no painel web.
func (p *Painel) ativar(servidor, cnpj, codigo string) error {
	cnpj, codigo = strings.TrimSpace(cnpj), strings.TrimSpace(codigo)
	if servidor = strings.TrimSpace(servidor); servidor == "" {
		servidor = p.op.ServidorPadrao
	}
	switch {
	case servidor == "":
		return errors.New("Informe o endereço do sistema.")
	case len(strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' || r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' {
			return r
		}
		return -1
	}, cnpj)) != 14:
		return errors.New("Informe o CNPJ completo da empresa.")
	case len(codigo) < 8:
		return errors.New("Informe o código de ativação (8 letras e números).")
	}
	go func() {
		if p.acaoAdmin("Ativando e instalando o agente…", "Agente ativado e instalado.", "instalar", "-servidor", servidor, "-cnpj", cnpj, "-codigo", codigo) {
			p.relancarInstalado()
		}
	}()
	return nil
}

// relancarInstalado: depois de instalar a partir de Downloads, passa a rodar a cópia
// de Arquivos de Programas (a que inicia com o Windows).
func (p *Painel) relancarInstalado() {
	destino := config.ExecutavelInstalado()
	if strings.EqualFold(filepath.Clean(destino), filepath.Clean(p.executavel)) {
		return
	}
	if _, err := os.Stat(destino); err != nil {
		return
	}
	time.Sleep(1500 * time.Millisecond) // deixa o usuário ver a mensagem de sucesso
	p.mu.Lock()
	h := p.janela
	p.mu.Unlock()
	if h != 0 {
		fecharJanela(h)
	}
	p.instancia.liberar()
	if err := abrir(destino, "painel"); err != nil {
		return
	}
	systray.Quit()
}

// visaoDaPagina: a da janela entrega, uma vez, a aba pedida pelo menu do ícone (o ícone
// também consulta a visão e não pode consumir o pedido).
func (p *Painel) visaoDaPagina() Visao {
	v := p.visao()
	p.mu.Lock()
	v.Aba, p.abaPedida = p.abaPedida, ""
	p.mu.Unlock()
	return v
}
