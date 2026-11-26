import { describe, expect, it } from 'vitest';
import { comprimentoDaAssinatura, etapaDaFoto, MAX_PEDIDOS_JUNTOS, podePegarOutra, problemaNaAssinatura, problemaNosPedidosJuntos, rasterizarAssinatura, rotuloDaFoto } from './index';

const rabisco: [number, number][] = [
  [0.1, 0.5],
  [0.3, 0.2],
  [0.5, 0.8],
  [0.7, 0.3],
];

describe('assinatura', () => {
  it('exige traços de verdade e o nome de quem recebeu', () => {
    expect(problemaNaAssinatura(null)).toMatch(/assinar/);
    expect(problemaNaAssinatura({ tracos: [rabisco], recebedor: '' })).toMatch(/nome/);
    expect(problemaNaAssinatura({ tracos: [[[0.5, 0.5]]], recebedor: 'Ana' })).toMatch(/assinar/);
    expect(problemaNaAssinatura({ tracos: [[[0.5, 1.5], [0.6, 0.5]]], recebedor: 'Ana' })).toMatch(/inválida/);
    expect(problemaNaAssinatura({ tracos: Array.from({ length: 61 }, () => rabisco), recebedor: 'Ana' })).toMatch(/demais/);
    expect(problemaNaAssinatura({ tracos: [rabisco], recebedor: 'Ana Souza' })).toBeNull();
    expect(comprimentoDaAssinatura([rabisco])).toBeGreaterThan(0.6);
  });
  it('vira imagem preta sobre branco', () => {
    const r = rasterizarAssinatura([rabisco], 200);
    expect(r).toMatchObject({ largura: 200, altura: 80 });
    const pretos = r.pixels.filter((p) => p === 0).length;
    expect(pretos).toBeGreaterThan(200);
    expect(pretos).toBeLessThan(200 * 80 * 0.2);
    // O primeiro ponto do traço está pintado.
    expect(r.pixels[Math.round(0.5 * 79) * 200 + Math.round(0.1 * 199)]).toBe(0);
  });
  it('foto da assinatura de cada parada', () => {
    expect(etapaDaFoto('ASSINATURA')).toBe('ASSINATURA');
    expect(etapaDaFoto('ASSINATURA', 2)).toBe('ASSINATURA_2');
    expect(etapaDaFoto('COLETA', 2)).toBe('COLETA_2');
    expect(rotuloDaFoto('ASSINATURA_2')).toBe('Assinatura na parada 3');
  });
});

describe('mais de uma chamada por vez', () => {
  it('só da mesma empresa e dentro do limite', () => {
    expect(podePegarOutra([], 'a', 1)).toBe(true);
    expect(podePegarOutra([{ empresaId: 'a' }], 'a', 1)).toBe(false);
    expect(podePegarOutra([{ empresaId: 'a' }], 'a', 2)).toBe(true);
    expect(podePegarOutra([{ empresaId: 'a' }, { empresaId: 'a' }], 'a', 2)).toBe(false);
    expect(podePegarOutra([{ empresaId: 'b' }], 'a', 3)).toBe(false);
  });
});

describe('pedidos juntos', () => {
  it('de dois até o limite das paradas', () => {
    expect(problemaNosPedidosJuntos(1)).toMatch(/dois/);
    expect(problemaNosPedidosJuntos(2)).toBeNull();
    expect(problemaNosPedidosJuntos(MAX_PEDIDOS_JUNTOS)).toBeNull();
    expect(problemaNosPedidosJuntos(MAX_PEDIDOS_JUNTOS + 1)).toMatch(/até 10/);
  });
});
