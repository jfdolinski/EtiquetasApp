import { describe, expect, it } from 'vitest';
import { caminhoRastreio, mostraCodigoAoCliente, mostraPosicaoAoCliente, pontoDoCliente, previsaoMinutos, textoParaCliente } from './entregas-rastreio';

const p = (lat: number, lon: number) => ({ lat, lon, endereco: 'x', contato: '', telefone: '', instrucoes: '' });

describe('rastreio do destinatário', () => {
  it('o cliente está no destino da entrega e na origem da coleta', () => {
    const o = p(1, 1);
    const d = p(2, 2);
    expect(pontoDoCliente('ENTREGA', o, d)).toBe(d);
    expect(pontoDoCliente('COLETA', o, d)).toBe(o);
    expect(pontoDoCliente('DEVOLUCAO_MAQUINA', o, d)).toBe(o);
  });

  it('posição só no trecho até o cliente; código só na entrega em andamento', () => {
    expect(mostraPosicaoAoCliente('ENTREGA', 'ACEITA')).toBe(false);
    expect(mostraPosicaoAoCliente('ENTREGA', 'COLETADA')).toBe(true);
    expect(mostraPosicaoAoCliente('ENTREGA', 'NO_DESTINO')).toBe(false);
    expect(mostraPosicaoAoCliente('COLETA', 'ACEITA')).toBe(true);
    expect(mostraPosicaoAoCliente('COLETA', 'COLETADA')).toBe(false);
    expect(mostraCodigoAoCliente('ENTREGA', 'NO_DESTINO')).toBe(true);
    expect(mostraCodigoAoCliente('ENTREGA', 'CONCLUIDA')).toBe(false);
    expect(mostraCodigoAoCliente('COLETA', 'ACEITA')).toBe(false);
  });

  it('previsão pela velocidade do veículo, no mínimo 1 min', () => {
    const de = { lat: -23.55, lon: -46.63 };
    const ate = { lat: -23.55 + 5 / 111.32, lon: -46.63 };
    // 5 km em linha reta × 1,4 = 7 km; moto a 25 km/h ≈ 17 min, a pé a 4,5 km/h ≈ 93 min.
    expect(previsaoMinutos(de, ate, 'MOTO')).toBe(17);
    expect(previsaoMinutos(de, ate, 'A_PE')).toBe(93);
    expect(previsaoMinutos(de, de, 'CARRO')).toBe(1);
  });

  it('textos para quem recebe', () => {
    expect(textoParaCliente('ENTREGA', 'COLETADA')).toBe('Saiu para entrega');
    expect(textoParaCliente('COLETA', 'ACEITA')).toBe('O entregador está a caminho');
    expect(caminhoRastreio('abc')).toBe('/rastreio/abc');
  });
});
