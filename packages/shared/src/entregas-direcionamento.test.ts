import { describe, expect, it } from 'vitest';
import {
  classificar,
  motivoDaOferta,
  motivoParaEntregador,
  notasDoCandidato,
  problemaNasRegras,
  quantosOferecer,
  raioDaRodada,
  REGRAS_DIRECIONAMENTO_PADRAO,
  regrasVigentes,
  textoDoMotivo,
  type CandidatoDirecionamento,
} from './entregas-direcionamento';

const cand = (id: string, x: Partial<CandidatoDirecionamento> = {}): CandidatoDirecionamento => ({
  id,
  nome: id,
  veiculo: 'MOTO',
  metrosAteColeta: 2000,
  minutosLivre: 30,
  ofertadas30d: 0,
  aceitas30d: 0,
  avaliacao: null,
  preferido: false,
  bloqueado: false,
  jaOfertado: false,
  ...x,
});

const R = REGRAS_DIRECIONAMENTO_PADRAO;

describe('regras de direcionamento', () => {
  it('o padrão é válido e o gravado parcial completa com ele', () => {
    expect(problemaNasRegras(R)).toBeNull();
    const v = regrasVigentes({ modo: 'GRUPO', pesos: { proximidade: 70 }, veiculos: { ENTREGA: ['MOTO', 'XX'] } });
    expect(v.modo).toBe('GRUPO');
    expect(v.raioKm).toBe(8);
    expect(regrasVigentes({ raioKm: '9', invasor: 1 })).toEqual(R);
    expect(v.pesos).toEqual({ ...R.pesos, proximidade: 70 });
    expect(v.veiculos.ENTREGA).toEqual(['MOTO']);
    expect(v.veiculos.COLETA).toEqual(R.veiculos.COLETA);
    expect(regrasVigentes(null)).toEqual(R);
  });

  it('recusa pesos que não somam 100, raio limite menor e serviço sem veículo', () => {
    expect(problemaNasRegras({ ...R, pesos: { ...R.pesos, proximidade: 60 } })).toBe('Os pesos somam 110; precisam somar 100.');
    expect(problemaNasRegras({ ...R, raioKm: 10, raioLimiteKm: 5 })).toMatch(/raio limite/);
    expect(problemaNasRegras({ ...R, veiculos: { ...R.veiculos, COLETA: [] } })).toMatch(/ao menos um veículo/);
    expect(problemaNasRegras({ ...R, modo: 'GRUPO', tamanhoGrupo: 1 })).toMatch(/grupo/);
  });

  it('o raio cresce a cada rodada até o limite', () => {
    expect([0, 1, 2, 3, 4, 9].map((r) => raioDaRodada(R, r))).toEqual([8, 10, 12, 14, 15, 15]);
    expect(quantosOferecer(R)).toBe(1);
    expect(quantosOferecer({ ...R, modo: 'GRUPO', tamanhoGrupo: 4 })).toBe(4);
  });

  it('notas: sem histórico e sem avaliação valem 0,8', () => {
    expect(notasDoCandidato(cand('a', { metrosAteColeta: 2000, minutosLivre: 90 }), 8)).toEqual({ proximidade: 0.75, tempoLivre: 1, aceite: 0.8, avaliacao: 0.8, preferido: 0 });
    expect(notasDoCandidato(cand('b', { ofertadas30d: 10, aceitas30d: 4, avaliacao: 5, preferido: true }), 8)).toMatchObject({ aceite: 0.4, avaliacao: 1, preferido: 1 });
  });
});

describe('classificar', () => {
  it('filtra com o motivo e ordena pelos pontos', () => {
    const r = classificar(
      [
        cand('perto', { metrosAteColeta: 500, minutosLivre: 5 }),
        cand('livre', { metrosAteColeta: 3000, minutosLivre: 60 }),
        cand('longe', { metrosAteColeta: 9000 }),
        cand('bloq', { bloqueado: true }),
        cand('bici', { veiculo: 'BICICLETA' }),
        cand('jafoi', { jaOfertado: true }),
      ],
      { ...R, veiculos: { ...R.veiculos, ENTREGA: ['MOTO', 'CARRO'] } },
      'ENTREGA',
      8,
    );
    expect(r.classificados.map((c) => [c.id, c.posicao, c.total])).toEqual([
      ['livre', 1, 2],
      ['perto', 2, 2],
    ]);
    // livre: 50×0,625 + 25×1 + 10×0,8 + 10×0,8 = 72,3; perto: 50×0,9375 + 25×0,083 + 16 = 64,9
    expect(r.classificados[0].pontos).toBe(72.3);
    expect(Object.fromEntries(r.descartados.map((d) => [d.id, d.motivo]))).toEqual({
      longe: 'a 9,0 km, fora do raio de 8 km',
      bloq: 'bloqueado pela empresa',
      bici: 'bicicleta não atende este serviço',
      jafoi: 'já recebeu esta chamada',
    });
  });

  it('preferidos primeiro, só preferidos e empate por tempo livre', () => {
    const lista = [cand('a', { metrosAteColeta: 500 }), cand('b', { metrosAteColeta: 4000, preferido: true })];
    expect(classificar(lista, R, 'ENTREGA', 8).classificados[0].id).toBe('a');
    expect(classificar(lista, { ...R, preferidosPrimeiro: true }, 'ENTREGA', 8).classificados[0].id).toBe('b');
    expect(classificar(lista, { ...R, somentePreferidos: true }, 'ENTREGA', 8).classificados.map((c) => c.id)).toEqual(['b']);
    const empate = classificar([cand('x', { minutosLivre: 80 }), cand('y', { minutosLivre: 61 })], { ...R, pesos: { proximidade: 100, tempoLivre: 0, aceite: 0, avaliacao: 0, preferido: 0 } }, 'ENTREGA', 8);
    expect(empate.classificados.map((c) => c.id)).toEqual(['x', 'y']);
  });

  it('o motivo explica a escolha para a empresa e para o entregador', () => {
    const [primeiro] = classificar([cand('a', { metrosAteColeta: 1200, minutosLivre: 40, ofertadas30d: 5, aceitas30d: 4 }), cand('b')], R, 'ENTREGA', 8).classificados;
    const m = motivoDaOferta(primeiro, R, 0, 8);
    expect(textoDoMotivo(m)).toBe(`1,2 km, 40 min livre, aceite 80% → 1º de 2 (${primeiro.pontos.toLocaleString('pt-BR')} pontos)`);
    expect(motivoParaEntregador(m)).toBe('Você foi o 1º de 2: você está a 1,2 km da coleta.');
    expect(motivoParaEntregador({ ...m, notas: { ...m.notas, proximidade: 0.1 } })).toBe('Você foi o 1º de 2: você está há mais tempo sem chamada.');
  });
});
