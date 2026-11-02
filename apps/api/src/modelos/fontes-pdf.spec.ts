import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FONTES } from '@etiquetas/shared';
import { PDFDocument } from 'pdf-lib';
import { codificavel, FontesPdf } from './fontes-pdf';

const proprias = FONTES.filter((f) => !f.padraoPdf);
const importacoesDoSite = readFileSync(join(__dirname, '../../../web/src/pages/modelos/fontes.ts'), 'utf8');
const arquivo = (id: string, peso: number, estilo: string) => join(dirname(require.resolve(`@fontsource/${id}/package.json`)), 'files', `${id}-latin-${peso}-${estilo}.woff`);

describe('PDF com as fontes do catálogo', () => {
  it('embute todas, em todas as variantes, e escreve com acentos', async () => {
    const doc = await PDFDocument.create();
    const pagina = doc.addPage();
    const fontes = new FontesPdf(doc);
    for (const f of FONTES) {
      for (const [negrito, italico] of [[false, false], [true, false], [false, true], [true, true]]) {
        const r = await fontes.obter(f.id, negrito, italico);
        pagina.drawText(codificavel('Promoção açúcar R$ 4,99', r.fonte), { font: r.fonte, size: 8 });
        expect(r.medir('Promoção', 10)).toBeGreaterThan(0);
      }
    }
    expect((await doc.save()).length).toBeGreaterThan(1000);
  }, 120_000);
});

describe('catálogo de fontes', () => {
  it('tem ids únicos', () => {
    expect(new Set(FONTES.map((f) => f.id)).size).toBe(FONTES.length);
  });

  it.each(proprias.map((f) => [f.id, f] as const))('%s: o catálogo diz só o que o pacote tem, e o site carrega a mesma variante', (id, f) => {
    expect(existsSync(arquivo(id, 400, 'normal'))).toBe(true);
    expect(importacoesDoSite).toContain(`@fontsource/${id}/latin-400.css`);
    if (f.negrito) {
      expect(existsSync(arquivo(id, 700, 'normal'))).toBe(true);
      expect(importacoesDoSite).toContain(`@fontsource/${id}/latin-700.css`);
    }
    if (f.italico) {
      expect(existsSync(arquivo(id, 400, 'italic'))).toBe(true);
      expect(importacoesDoSite).toContain(`@fontsource/${id}/latin-400-italic.css`);
    }
  });
});
