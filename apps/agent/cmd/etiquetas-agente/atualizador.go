package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/kardianos/service"

	"etiquetas/agente/internal/atualizacao"
	"etiquetas/agente/internal/config"
	"etiquetas/agente/internal/estado"
)

const (
	primeiraVerificacao  = 2 * time.Minute
	intervaloVerificacao = 6 * time.Hour
	// Para reler a opção mudada no painel e publicar no status.
	intervaloPreferencias = 30 * time.Second
	// Não troca com etiqueta saindo: o trabalho interrompido viraria erro para o operador.
	esperaOcioso = 10 * time.Minute

	estabilidadeVersaoNova = 30 * time.Second
	limiteVersaoNova       = 3 * time.Minute
)

// manterAtualizado roda dentro do serviço instalado.
func (p *programa) manterAtualizado(ctx context.Context, st *estado.Estado) {
	caminho := atualizacao.CaminhoPreferencias(p.caminhoConfig)
	p.avisarResultadoAnterior(caminho, st)
	proxima := time.Now().Add(primeiraVerificacao)
	for {
		prefs := atualizacao.LerPreferencias(caminho)
		ligada := !prefs.Desligada
		st.Atualizar(func(i *estado.Instantaneo) { i.AtualizacaoAutomatica = &ligada })
		if ligada && !time.Now().Before(proxima) {
			proxima = time.Now().Add(intervaloVerificacao)
			if err := p.verificarAtualizacao(ctx, st, prefs); err != nil && ctx.Err() == nil {
				p.log.Warn("atualização automática", "erro", err)
				st.Evento("aviso", "Atualização automática não concluída: "+err.Error())
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(intervaloPreferencias):
		}
	}
}

// avisarResultadoAnterior conta na atividade recente o que aconteceu na última troca.
func (p *programa) avisarResultadoAnterior(caminho string, st *estado.Estado) {
	prefs := atualizacao.LerPreferencias(caminho)
	mudou := false
	if prefs.Atualizando == versao {
		st.Evento("info", "Agente atualizado automaticamente para a versão "+versao+".")
		prefs.Atualizando, mudou = "", true
	}
	if prefs.VersaoRecusada != "" && !prefs.RecusaAvisada {
		st.Evento("aviso", "A versão "+prefs.VersaoRecusada+" não funcionou aqui e o agente voltou para a "+versao+". Motivo: "+prefs.MotivoRecusa)
		prefs.RecusaAvisada, mudou = true, true
	}
	if mudou {
		if err := atualizacao.SalvarPreferencias(caminho, prefs); err != nil {
			p.log.Warn("não foi possível gravar as preferências de atualização", "erro", err)
		}
	}
}

func (p *programa) verificarAtualizacao(ctx context.Context, st *estado.Estado, prefs atualizacao.Preferencias) error {
	cfg, err := config.Carregar(p.caminhoConfig)
	if err != nil {
		return err
	}
	atualizacao.Limpar(config.ExecutavelInstalado())
	nova, err := atualizacao.VersaoPublicada(ctx, cfg.Servidor)
	if err != nil {
		return err
	}
	st.Atualizar(func(i *estado.Instantaneo) {
		agora := time.Now()
		i.UltimaVerificacao, i.VersaoDisponivel = &agora, nova
	})
	if !atualizacao.MaisNova(nova, versao) || nova == prefs.VersaoRecusada {
		return nil
	}
	limite := time.Now().Add(esperaOcioso)
	for p.ocupado.Load() > 0 {
		if time.Now().After(limite) {
			return errors.New("há impressão em andamento; tenta de novo mais tarde")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(5 * time.Second):
		}
	}
	st.Evento("info", "Baixando a versão "+nova+" do agente.")
	return aplicarAtualizacao(ctx, cfg.Servidor, nova, p.caminhoConfig)
}

// aplicarAtualizacao baixa, confere e troca os arquivos, e deixa o vigia reiniciar o serviço.
// Se o vigia não sobe, nada mudou de verdade: desfaz a troca e o serviço segue como estava.
func aplicarAtualizacao(ctx context.Context, servidor, nova, caminhoConfig string) error {
	exe := config.ExecutavelInstalado()
	if err := atualizacao.Preparar(ctx, servidor, exe, nova); err != nil {
		return err
	}
	if err := atualizacao.Trocar(exe); err != nil {
		os.Remove(atualizacao.CaminhoNovo(exe))
		return err
	}
	caminho := atualizacao.CaminhoPreferencias(caminhoConfig)
	prefs := atualizacao.LerPreferencias(caminho)
	prefs.Atualizando = nova
	if err := atualizacao.SalvarPreferencias(caminho, prefs); err != nil {
		_ = atualizacao.Reverter(exe)
		return err
	}
	if err := iniciarVigia(atualizacao.CaminhoAntigo(exe), nova, caminhoConfig, caminhoLogAtualizacao(caminhoConfig)); err != nil {
		_ = atualizacao.Reverter(exe)
		return fmt.Errorf("não foi possível reiniciar o agente: %w", err)
	}
	return nil
}

func caminhoLogAtualizacao(caminhoConfig string) string {
	return filepath.Join(filepath.Dir(caminhoConfig), "atualizacao.log")
}

// concluirAtualizacao é o vigia: roda do executável antigo, fora do serviço que ele reinicia.
func concluirAtualizacao(svc service.Service, nova, caminhoConfig string, log *slog.Logger) error {
	exe := config.ExecutavelInstalado()
	vigia := &atualizacao.Vigia{
		Versao:    nova,
		Reiniciar: func() error { return reiniciarServico(svc) },
		Parar:     svc.Stop,
		Iniciar:   svc.Start,
		Reverter:  func() error { return atualizacao.Reverter(exe) },
		Ler: func() (atualizacao.Situacao, error) {
			st, err := estado.Ler(config.CaminhoStatus())
			if err != nil {
				return atualizacao.Situacao{}, err
			}
			return atualizacao.Situacao{Versao: st.Versao, PID: st.PID, AtualizadoEm: st.AtualizadoEm, IniciadoEm: st.IniciadoEm}, nil
		},
		Agora:        time.Now,
		Esperar:      time.Sleep,
		Estabilidade: estabilidadeVersaoNova,
		Limite:       limiteVersaoNova,
	}
	log.Info("reiniciando o serviço para a versão nova", "versao", nova)
	err := vigia.Conduzir()
	if err == nil {
		log.Info("versão nova de pé", "versao", nova)
		return nil
	}
	log.Error("atualização desfeita", "versao", nova, "erro", err)
	caminho := atualizacao.CaminhoPreferencias(caminhoConfig)
	prefs := atualizacao.LerPreferencias(caminho)
	prefs.VersaoRecusada, prefs.MotivoRecusa, prefs.RecusaAvisada, prefs.Atualizando = nova, err.Error(), false, ""
	if errSalvar := atualizacao.SalvarPreferencias(caminho, prefs); errSalvar != nil {
		log.Error("não foi possível gravar a versão recusada", "erro", errSalvar)
	}
	return err
}

// reiniciarServico: parar pode demorar se houver consulta em andamento; só desiste se não subir.
func reiniciarServico(svc service.Service) error {
	_ = svc.Stop()
	var err error
	for range 10 {
		if err = svc.Start(); err == nil {
			return nil
		}
		time.Sleep(3 * time.Second)
	}
	return err
}

// atualizarAgora é o botão do painel: confere na hora, como administrador.
func atualizarAgora(caminhoConfig string) (string, error) {
	if !atualizacaoSuportada {
		return "", errors.New("a atualização pelo próprio agente só existe no Windows")
	}
	if versao == "dev" {
		return "", errors.New("esta é uma versão de desenvolvimento: não se atualiza sozinha")
	}
	cfg, err := config.Carregar(caminhoConfig)
	if err != nil {
		return "", err
	}
	if !cfg.Ativado() {
		return "", errors.New("agente não ativado")
	}
	ctx := context.Background()
	exe := config.ExecutavelInstalado()
	atualizacao.Limpar(exe)
	nova, err := atualizacao.VersaoPublicada(ctx, cfg.Servidor)
	if err != nil {
		return "", err
	}
	if !atualizacao.MaisNova(nova, versao) {
		return "O agente já está na versão mais nova (" + versao + ").", nil
	}
	if prefs := atualizacao.LerPreferencias(atualizacao.CaminhoPreferencias(caminhoConfig)); nova == prefs.VersaoRecusada {
		return "", fmt.Errorf("a versão %s já falhou neste computador: %s", nova, prefs.MotivoRecusa)
	}
	if err := aplicarAtualizacao(ctx, cfg.Servidor, nova, caminhoConfig); err != nil {
		return "", err
	}
	return "Atualizando para a versão " + nova + ": o agente reinicia em instantes.", nil
}

func definirAtualizacaoAutomatica(caminhoConfig string, ligada bool) error {
	caminho := atualizacao.CaminhoPreferencias(caminhoConfig)
	prefs := atualizacao.LerPreferencias(caminho)
	prefs.Desligada = !ligada
	return atualizacao.SalvarPreferencias(caminho, prefs)
}
