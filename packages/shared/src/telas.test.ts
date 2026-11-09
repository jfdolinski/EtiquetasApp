import { describe, expect, it } from 'vitest';
import {
  aplicarParametros,
  codigoDoVinculoDaTela,
  codigoParaLer,
  dentroDoHorarioDaTela,
  familiaDoFormato,
  linkDoVinculoDaTela,
  PARAMETROS_TELAS_PADRAO,
  parametrosVigentes,
  problemaNosParametros,
  problemaNosPrazos,
  resolucaoConfere,
  resolucaoValida,
  situacaoDaTela,
  telaAcesaDe,
} from './telas';

describe('formato e resolução', () => {
  it.each([
    [1920, 1080, 'HORIZONTAL'],
    [3840, 2160, 'HORIZONTAL'],
    [1080, 1920, 'VERTICAL'],
    [1280, 800, 'QUASE_QUADRADO'],
    [1024, 768, 'QUASE_QUADRADO'],
    [960, 320, 'FAIXA'],
  ])('%i×%i é %s', (l, a, f) => expect(familiaDoFormato(l, a)).toBe(f));

  it('aceita painel pequeno e recusa medida impossível', () => {
    expect(resolucaoValida(192, 96)).toBe(true);
    expect(resolucaoValida(0, 100)).toBe(false);
    expect(resolucaoValida(1920.5, 1080)).toBe(false);
    expect(resolucaoValida(20000, 1080)).toBe(false);
  });

  it('TV 4K que informa Full HD confere; formato diferente não', () => {
    expect(resolucaoConfere({ largura: 3840, altura: 2160 }, { largura: 1920, altura: 1080 })).toBe(true);
    expect(resolucaoConfere({ largura: 960, altura: 320 }, { largura: 1920, altura: 1080 })).toBe(false);
    expect(resolucaoConfere({ largura: 960, altura: 320 }, { largura: null, altura: null })).toBe(true);
  });
});

describe('vínculo', () => {
  it('lê o link do QR e o código digitado', () => {
    const link = linkDoVinculoDaTela('https://sistema.exemplo', 'K7M29QXT');
    expect(link).toBe('https://sistema.exemplo/telas/vincular#codigo=K7M29QXT');
    expect(codigoDoVinculoDaTela(link)).toBe('K7M29QXT');
    expect(codigoDoVinculoDaTela('k7m2-9qxt')).toBe('K7M29QXT');
    expect(codigoParaLer('K7M29QXT')).toBe('K7M2-9QXT');
  });

  it('recusa outra coisa', () => {
    expect(codigoDoVinculoDaTela('https://sistema.exemplo/')).toBeNull();
    expect(codigoDoVinculoDaTela('7891000100103')).toBeNull();
    expect(codigoDoVinculoDaTela('')).toBeNull();
  });
});

describe('situação da tela', () => {
  const agora = new Date('2026-11-08T15:00:00Z');
  const prazos = { minutosOnline: 2, minutosOffline: 5 };
  const ha = (min: number) => new Date(agora.getTime() - min * 60_000);
  const tela = (ultimoContatoEm: Date | null, horarioInicio: string | null = null, horarioFim: string | null = null) => ({ vinculada: true, ultimoContatoEm, horarioInicio, horarioFim });

  it('vai de online a offline pelo tempo sem aviso', () => {
    expect(situacaoDaTela(tela(ha(1)), agora, '12:00', prazos)).toBe('ONLINE');
    expect(situacaoDaTela(tela(ha(3)), agora, '12:00', prazos)).toBe('INSTAVEL');
    expect(situacaoDaTela(tela(ha(5)), agora, '12:00', prazos)).toBe('OFFLINE');
    expect(situacaoDaTela(tela(null), agora, '12:00', prazos)).toBe('OFFLINE');
  });

  it('fora do horário não é problema, e tela que responde continua online', () => {
    expect(situacaoDaTela(tela(ha(60), '08:00', '18:00'), agora, '22:00', prazos)).toBe('FORA_DO_HORARIO');
    expect(situacaoDaTela(tela(ha(1), '08:00', '18:00'), agora, '22:00', prazos)).toBe('ONLINE');
    expect(situacaoDaTela(tela(ha(60), '08:00', '18:00'), agora, '12:00', prazos)).toBe('OFFLINE');
  });

  it('sem equipamento vinculado', () => {
    expect(situacaoDaTela({ vinculada: false, ultimoContatoEm: null, horarioInicio: null, horarioFim: null }, agora, '12:00', prazos)).toBe('AGUARDANDO_VINCULO');
  });

  it('horário que passa da meia-noite', () => {
    expect(dentroDoHorarioDaTela('18:00', '02:00', '23:00')).toBe(true);
    expect(dentroDoHorarioDaTela('18:00', '02:00', '01:59')).toBe(true);
    expect(dentroDoHorarioDaTela('18:00', '02:00', '02:00')).toBe(false);
    expect(dentroDoHorarioDaTela(null, null, '02:00')).toBe(true);
  });
});

describe('parâmetros', () => {
  it('a empresa sobrescreve o global, que sobrescreve o padrão', () => {
    const p = parametrosVigentes({ fatiaAnunciosPct: 20, aprovacaoObrigatoria: true }, { aprovacaoObrigatoria: false });
    expect(p.fatiaAnunciosPct).toBe(20);
    expect(p.aprovacaoObrigatoria).toBe(false);
    expect(p.videoTamanhoMaximoMb).toBe(PARAMETROS_TELAS_PADRAO.videoTamanhoMaximoMb);
  });

  it('ignora o que não reconhece ao ler', () => {
    expect(parametrosVigentes({ qualquer: 1, fatiaAnunciosPct: 'muito' }, null)).toEqual(PARAMETROS_TELAS_PADRAO);
  });

  it('confere valores e faixas', () => {
    expect(problemaNosParametros({ fatiaAnunciosPct: 15, aprovacaoObrigatoria: true })).toBeNull();
    expect(problemaNosParametros({ fatiaAnunciosPct: null })).toBeNull();
    expect(problemaNosParametros({ fatiaAnunciosPct: 90 })).toContain('entre 0 e 50');
    expect(problemaNosParametros({ fatiaAnunciosPct: 1.5 })).toContain('entre 0 e 50');
    expect(problemaNosParametros({ aprovacaoObrigatoria: 'sim' })).toContain('inválido');
    expect(telaAcesaDe(true, true)).toBe('PEDIDO_ACEITO');
    expect(telaAcesaDe(true, false)).toBe('PEDIDO_ACEITO');
    expect(telaAcesaDe(false, true)).toBe('SO_VIDEO');
    expect(telaAcesaDe(false, false)).toBe('RECUSADO');
    expect(problemaNosParametros({ outro: 1 })).toContain('desconhecido');
  });

  it('null volta a herdar', () => {
    expect(aplicarParametros({ fatiaAnunciosPct: 20, videoAlturaMaxima: 720 }, { fatiaAnunciosPct: null, minutosOnline: 3 })).toEqual({ videoAlturaMaxima: 720, minutosOnline: 3 });
  });

  it('offline precisa vir depois de online', () => {
    expect(problemaNosPrazos({ ...PARAMETROS_TELAS_PADRAO, minutosOnline: 5, minutosOffline: 5 })).toContain('maior');
    expect(problemaNosPrazos(PARAMETROS_TELAS_PADRAO)).toBeNull();
  });
});
