import { describe, expect, it } from 'vitest';
import {
  chegouPerto,
  gerarCodigoConfirmacao,
  normalizarSerie,
  problemaNaChamada,
  problemaNaTabelaPrecos,
  resumoDoEndereco,
  rotaEstimada,
  TABELA_PRECOS_PADRAO,
  valorDaChamada,
  type NovaChamada,
} from './entregas-chamadas';

const SE = { lat: -23.5505, lon: -46.6333 };
const PAULISTA = { lat: -23.5614, lon: -46.6559 };
const parada = (p: { lat: number; lon: number }, endereco = 'Praça da Sé, 10, São Paulo') => ({ ...p, endereco, contato: 'Ana', telefone: '11987654321', instrucoes: '' });

describe('preço da chamada', () => {
  it('base cobre os km inclusos; o resto é proporcional', () => {
    const p = { baseCentavos: 800, porKmCentavos: 150, kmIncluso: 3 };
    expect(valorDaChamada(p, 2000)).toBe(800);
    expect(valorDaChamada(p, 3000)).toBe(800);
    expect(valorDaChamada(p, 5500)).toBe(800 + 375);
    expect(valorDaChamada(p, -10)).toBe(800);
  });

  it('confere a tabela', () => {
    expect(problemaNaTabelaPrecos(TABELA_PRECOS_PADRAO)).toBeNull();
    expect(problemaNaTabelaPrecos({ ...TABELA_PRECOS_PADRAO, COLETA: { baseCentavos: -1, porKmCentavos: 0, kmIncluso: 0 } })).toMatch(/Coleta/);
  });

  it('sem servidor de rotas, estima pela linha reta', () => {
    const r = rotaEstimada(SE, PAULISTA);
    expect(r.metros).toBeGreaterThan(3500);
    expect(r.metros).toBeLessThan(4000);
    expect(r.segundos).toBeGreaterThan(400);
  });
});

describe('chamada', () => {
  const ok: NovaChamada = { tipo: 'ENTREGA', origem: parada(SE), destino: parada(PAULISTA, 'Av. Paulista, 1578, São Paulo'), serieEsperada: null, observacao: '' };

  it('aponta o problema', () => {
    expect(problemaNaChamada(ok)).toBeNull();
    expect(problemaNaChamada({ ...ok, destino: parada(SE) })).toMatch(/mesmo lugar/);
    expect(problemaNaChamada({ ...ok, origem: { ...ok.origem, endereco: '' } })).toMatch(/coleta/);
    expect(problemaNaChamada({ ...ok, destino: { ...ok.destino, lat: 0, lon: 0 } })).toMatch(/destino/);
    expect(problemaNaChamada({ ...ok, serieEsperada: 'a1' })).toMatch(/série/);
  });

  it('chegada só perto do ponto', () => {
    expect(chegouPerto({ lat: -23.5506, lon: -46.6334 }, SE, 10)).toBe(true);
    expect(chegouPerto(PAULISTA, SE, 10)).toBe(false);
    // GPS impreciso ganha até 100 m a mais, não mais que isso.
    const a240m = { lat: SE.lat + 0.00216, lon: SE.lon };
    expect(chegouPerto(a240m, SE, 30)).toBe(false);
    expect(chegouPerto(a240m, SE, 5000)).toBe(true);
  });

  it('código de 4 dígitos e série sem pontuação', () => {
    expect(gerarCodigoConfirmacao(() => 0.0042)).toBe('0042');
    expect(gerarCodigoConfirmacao()).toMatch(/^\d{4}$/);
    expect(normalizarSerie(' ab-12.34 ')).toBe('AB1234');
  });

  it('resumo do endereço esconde rua e número', () => {
    expect(resumoDoEndereco('10, Praça da Sé, Sé, São Paulo, Região Imediata de São Paulo, Região Metropolitana de São Paulo, São Paulo, Região Sudeste, 01001-000, Brasil')).toBe('Sé, São Paulo');
    expect(resumoDoEndereco('Rua das Flores, 100 - Centro, Campinas')).toBe('Campinas');
  });
});
