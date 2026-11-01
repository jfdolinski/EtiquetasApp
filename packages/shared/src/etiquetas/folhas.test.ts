import { describe, expect, it } from 'vitest';
import { posicionar } from './comum';
import { limitesPorFolha, lotesDeEtiquetas, problemaNasFolhas, tamanhosDasFolhas, validarLayout } from './layout';
import { LAYOUT_PADRAO, type LayoutEtiqueta } from './tipos';

const FOLHA: LayoutEtiqueta = {
  ...LAYOUT_PADRAO,
  larguraMm: 60,
  alturaMm: 30,
  colunas: 3,
  espacamentoHorizontalMm: 0,
  espacamentoVerticalMm: 0,
  margens: { superior: 0, inferior: 0, esquerda: 0, direita: 0 },
  papel: { tipo: 'folha', larguraMm: 210, alturaMm: 297 }, // 3 x 9 = 27 por folha
  elementos: [],
};

describe('mínimo e máximo por folha', () => {
  it('sem limite ou em rolo, não há limites', () => {
    expect(limitesPorFolha(FOLHA)).toBeNull();
    expect(limitesPorFolha({ ...LAYOUT_PADRAO, minimoPorFolha: 5 })).toBeNull();
  });

  it('completa o que faltou com o que cabe e 1', () => {
    expect(limitesPorFolha({ ...FOLHA, minimoPorFolha: 5 })).toEqual({ minimo: 5, maximo: 27 });
    expect(limitesPorFolha({ ...FOLHA, maximoPorFolha: 10 })).toEqual({ minimo: 1, maximo: 10 });
  });

  it('divide sem deixar folha abaixo do mínimo, com o menor número de folhas', () => {
    const l = { minimo: 8, maximo: 21 };
    expect(tamanhosDasFolhas(21, l)).toEqual([21]);
    expect(tamanhosDasFolhas(25, l)).toEqual([17, 8]);
    expect(tamanhosDasFolhas(42, l)).toEqual([21, 21]);
    expect(tamanhosDasFolhas(43, l)).toEqual([21, 14, 8]);
    expect(tamanhosDasFolhas(8, l)).toEqual([8]);
    expect(tamanhosDasFolhas(0, l)).toEqual([]);
    for (let total = 8; total < 200; total++) {
      const t = tamanhosDasFolhas(total, l)!;
      expect(t.reduce((a, b) => a + b, 0)).toBe(total);
      expect(t.every((x) => x >= 8 && x <= 21)).toBe(true);
    }
  });

  it('quando não dá, diz quantas usar', () => {
    expect(tamanhosDasFolhas(5, { minimo: 8, maximo: 21 })).toBeNull();
    expect(problemaNasFolhas(5, { minimo: 8, maximo: 21 })).toMatch(/faltam 3/);
    expect(tamanhosDasFolhas(22, { minimo: 20, maximo: 21 })).toBeNull();
    expect(problemaNasFolhas(22, { minimo: 20, maximo: 21 })).toMatch(/use 21 ou 40/);
    expect(problemaNasFolhas(22, { minimo: 21, maximo: 21 })).toMatch(/exatamente 21.*use 21 ou 42/);
    expect(problemaNasFolhas(21, { minimo: 21, maximo: 21 })).toBeNull();
    expect(problemaNasFolhas(3, null)).toBeNull();
  });

  it('todas as linguagens recebem as páginas certas', () => {
    const layout = { ...FOLHA, minimoPorFolha: 8, maximoPorFolha: 21, elementos: [{ id: 't', tipo: 'texto', x: 0, y: 0, largura: 10, altura: 5, rotacao: 0, valor: { tipo: 'fixo', texto: 'x' }, prefixo: '', sufixo: '', tamanhoPt: 8, negrito: false, alinhamento: 'esquerda' }] } as unknown as LayoutEtiqueta;
    const paginas = posicionar(layout, Array.from({ length: 25 }, () => ({})), { dpi: 203, hoje: '2026-11-01' });
    expect(paginas.map((p) => p.elementos.length)).toEqual([17, 8]);
    expect(paginas[1].elementos[0].numero).toBe(18);
  });

  it('máximo menor que a folha limita mesmo sem mínimo', () => {
    const layout = { ...FOLHA, maximoPorFolha: 4, elementos: [{ id: 't', tipo: 'texto', x: 0, y: 0, largura: 10, altura: 5, rotacao: 0, valor: { tipo: 'fixo', texto: 'x' }, prefixo: '', sufixo: '', tamanhoPt: 8, negrito: false, alinhamento: 'esquerda' }] } as unknown as LayoutEtiqueta;
    expect(posicionar(layout, Array.from({ length: 9 }, () => ({})), { dpi: 203, hoje: '2026-11-01' }).map((p) => p.elementos.length)).toEqual([4, 4, 1]);
  });

  it('lotes grandes não cortam folha ao meio', () => {
    const lotes = lotesDeEtiquetas(50, { minimo: 8, maximo: 21 }, 25);
    expect(lotes.reduce((a, b) => a + b, 0)).toBe(50);
    for (const n of lotes) expect(tamanhosDasFolhas(n, { minimo: 8, maximo: 21 })).not.toBeNull();
    expect(lotesDeEtiquetas(5, null, 2)).toEqual([2, 2, 1]);
  });

  it('valida os limites contra o que cabe', () => {
    expect(validarLayout({ ...FOLHA, minimoPorFolha: 5, maximoPorFolha: 27 })).toEqual([]);
    expect(validarLayout({ ...FOLHA, maximoPorFolha: 28 }).join()).toMatch(/máximo por folha é 27/);
    expect(validarLayout({ ...FOLHA, minimoPorFolha: 10, maximoPorFolha: 5 }).join()).toMatch(/não pode passar/);
    expect(validarLayout({ ...FOLHA, minimoPorFolha: 0 }).join()).toMatch(/mínimo/);
    expect(validarLayout({ ...FOLHA, minimoPorFolha: 1.5 }).join()).toMatch(/mínimo/);
  });
});
