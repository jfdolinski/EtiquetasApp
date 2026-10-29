import { describe, expect, it } from 'vitest';
import {
  avaliarAssinatura,
  diasEntre,
  mesclarParametros,
  PARAMETROS_COBRANCA_PADRAO,
  renderizarMensagem,
  somarMeses,
  validarParametros,
} from './cobranca';

const P = { diasAvisoPrevio: 5, diasCarencia: 5, diasAteBloqueio: 15 };

describe('avaliarAssinatura', () => {
  it('percorre a linha do tempo da mensalidade', () => {
    const v = '2026-11-10';
    expect(avaliarAssinatura('2026-11-01', v, P)).toMatchObject({ etapa: 'EM_DIA', status: 'ATIVA', diasAtraso: -9 });
    expect(avaliarAssinatura('2026-11-05', v, P)).toMatchObject({ etapa: 'AVISO_PREVIO', status: 'ATIVA' });
    expect(avaliarAssinatura('2026-11-10', v, P)).toMatchObject({ etapa: 'AVISO_PREVIO', status: 'ATIVA', diasAtraso: 0 });
    expect(avaliarAssinatura('2026-11-11', v, P)).toMatchObject({ etapa: 'CARENCIA', status: 'CARENCIA', diasAtraso: 1 });
    expect(avaliarAssinatura('2026-11-15', v, P)).toMatchObject({ etapa: 'CARENCIA', status: 'CARENCIA' });
    expect(avaliarAssinatura('2026-11-16', v, P)).toMatchObject({ etapa: 'PRE_BLOQUEIO', status: 'CARENCIA', diasParaBloqueio: 9 });
    expect(avaliarAssinatura('2026-11-25', v, P)).toMatchObject({ etapa: 'BLOQUEADA', status: 'BLOQUEADA', diasParaBloqueio: 0 });
  });

  it('carência igual ao bloqueio: sem etapa de pré-bloqueio', () => {
    const p = { diasAvisoPrevio: 0, diasCarencia: 3, diasAteBloqueio: 3 };
    expect(avaliarAssinatura('2026-11-12', '2026-11-10', p).etapa).toBe('CARENCIA');
    expect(avaliarAssinatura('2026-11-13', '2026-11-10', p).etapa).toBe('BLOQUEADA');
  });

  it('dias entre datas atravessando o horário de verão e a virada do ano', () => {
    expect(diasEntre('2026-12-30', '2027-01-02')).toBe(3);
    expect(diasEntre('2018-11-03', '2018-11-05')).toBe(2);
  });
});

describe('somarMeses', () => {
  it('mantém o dia de vencimento e ajusta ao fim do mês', () => {
    expect(somarMeses('2026-11-10', 1, 10)).toBe('2026-12-10');
    expect(somarMeses('2026-12-10', 2, 10)).toBe('2027-02-10');
    expect(somarMeses('2027-01-28', 1, 31)).toBe('2027-02-28');
    expect(somarMeses('2027-02-28', 1, 31)).toBe('2027-03-31');
  });
});

describe('mensagens e parâmetros', () => {
  it('preenche as variáveis', () => {
    const avaliacao = avaliarAssinatura('2026-11-17', '2026-11-10', P);
    const msg = renderizarMensagem('{empresa}: {valor} venceu em {vencimento}, {dias_atraso} dias; bloqueio em {dias_para_bloqueio}. {outra}', {
      empresa: 'Mercado A',
      valor: 1234.5,
      vencimento: '2026-11-10',
      avaliacao,
    });
    expect(msg).toBe('Mercado A: R$ 1.234,50 venceu em 10/11/2026, 7 dias; bloqueio em 8. {outra}');
  });

  it('empresa sobrescreve só o que definiu', () => {
    const p = mesclarParametros(PARAMETROS_COBRANCA_PADRAO, { diasCarencia: 10, diasAteBloqueio: null });
    expect(p.diasCarencia).toBe(10);
    expect(p.diasAteBloqueio).toBe(PARAMETROS_COBRANCA_PADRAO.diasAteBloqueio);
    expect(validarParametros({ diasCarencia: 10, diasAteBloqueio: 5 })).toHaveLength(1);
  });
});
