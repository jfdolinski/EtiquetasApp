import { describe, expect, it } from 'vitest';
import { comprimentoDoPercurso, etapaDaFoto, ordemMaisCurta, podeDesistir, rotuloDaFoto, taxaDoCancelamento, vaiProRastro } from './entregas-operacao';

const km = (norte: number, leste = 0) => ({ lat: -23.5 + norte / 111.32, lon: -46.6 + leste / 102 });

describe('operação', () => {
  it('desiste só antes de coletar', () => {
    expect(podeDesistir('ACEITA')).toBe(true);
    expect(podeDesistir('NA_COLETA')).toBe(true);
    expect(podeDesistir('COLETADA')).toBe(false);
  });

  it('taxa só com entregador e chamada em andamento', () => {
    expect(taxaDoCancelamento('ACEITA', true, 500)).toBe(500);
    expect(taxaDoCancelamento('COLETADA', true, 500)).toBe(500);
    expect(taxaDoCancelamento('ABERTA', false, 500)).toBe(0);
    expect(taxaDoCancelamento('ACEITA', true, undefined)).toBe(0);
  });

  it('nome e rótulo da foto por parada', () => {
    expect(etapaDaFoto('ENTREGA', 0)).toBe('ENTREGA');
    expect(etapaDaFoto('ENTREGA', 2)).toBe('ENTREGA_2');
    expect(etapaDaFoto('COLETA', 3)).toBe('COLETA_3');
    expect(rotuloDaFoto('ENTREGA_2')).toBe('Foto da entrega na parada 3');
    expect(rotuloDaFoto('COLETA')).toBe('Foto da coleta');
  });

  it('rastro só quando andou ou passou tempo', () => {
    const agora = new Date('2026-11-18T12:00:00Z');
    const ultimo = { ...km(0), em: new Date(agora.getTime() - 30_000) };
    expect(vaiProRastro(null, km(0), agora)).toBe(true);
    expect(vaiProRastro(ultimo, km(0.01), agora)).toBe(false);
    expect(vaiProRastro(ultimo, km(0.05), agora)).toBe(true);
    expect(vaiProRastro({ ...ultimo, em: new Date(agora.getTime() - 130_000) }, km(0), agora)).toBe(true);
  });
});

describe('ordem das paradas', () => {
  it('acha a ordem mais curta a partir da coleta', () => {
    const origem = km(0);
    // Digitadas fora de ordem: 3 km, 1 km, 2 km ao norte.
    const pontos = [km(3), km(1), km(2)];
    expect(ordemMaisCurta(origem, pontos)).toEqual([1, 2, 0]);
    expect(comprimentoDoPercurso(origem, [1, 2, 0].map((i) => pontos[i]))).toBeLessThan(comprimentoDoPercurso(origem, pontos));
  });

  it('com o primeiro fixo, só reordena os outros', () => {
    expect(ordemMaisCurta(km(0), [km(3), km(1), km(2), km(4)], true)).toEqual([0, 3, 2, 1]);
    expect(ordemMaisCurta(km(0), [km(1)])).toEqual([0]);
  });

  it('o 2-opt desfaz o cruzamento que o vizinho mais próximo deixa', () => {
    const origem = km(0);
    const pontos = [km(1, 0.1), km(1, -1), km(2, 1.2), km(2.5, -1.3), km(4, 0)];
    const ordem = ordemMaisCurta(origem, pontos);
    expect([...ordem].sort()).toEqual([0, 1, 2, 3, 4]);
    // Nunca pior que a ordem digitada.
    expect(comprimentoDoPercurso(origem, ordem.map((i) => pontos[i]))).toBeLessThanOrEqual(comprimentoDoPercurso(origem, pontos));
  });
});

describe('etapa sem internet', () => {
  it('aceita a hora guardada só se for plausível', async () => {
    const { momentoDaEtapa, etapaAtrasada } = await import('./entregas-operacao');
    const agora = new Date('2026-11-18T12:00:00Z');
    expect(momentoDaEtapa('2026-11-18T11:30:00Z', agora).toISOString()).toBe('2026-11-18T11:30:00.000Z');
    expect(momentoDaEtapa('2026-11-16T11:30:00Z', agora)).toBe(agora);
    expect(momentoDaEtapa('2026-11-18T12:10:00Z', agora)).toBe(agora);
    expect(momentoDaEtapa('2026-11-18T12:01:00Z', agora).toISOString()).toBe(agora.toISOString());
    expect(momentoDaEtapa('lixo', agora)).toBe(agora);
    expect(momentoDaEtapa(undefined, agora)).toBe(agora);
    expect(etapaAtrasada(new Date('2026-11-18T11:58:00Z'), agora)).toBe(true);
    expect(etapaAtrasada(new Date('2026-11-18T11:59:30Z'), agora)).toBe(false);
  });
});
