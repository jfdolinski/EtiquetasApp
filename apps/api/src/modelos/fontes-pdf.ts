import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { fonteDoCatalogo, semAcentos, type Medidor } from '@etiquetas/shared';
import { StandardFonts, type PDFDocument, type PDFFont } from 'pdf-lib';
import { woffParaSfnt } from './woff';

/** Fonte pronta para desenhar; quando a família não tem negrito/itálico, o desenho simula. */
export interface FonteResolvida {
  fonte: PDFFont;
  simularNegrito: boolean;
  simularItalico: boolean;
  medir: Medidor;
}

const PADRAO: Record<string, [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};

/** Arquivo WOFF do Fontsource (subconjunto latino, com acentos do português). */
function arquivoFonte(id: string, peso: 400 | 700, estilo: 'normal' | 'italic'): string | null {
  try {
    const base = dirname(require.resolve(`@fontsource/${id}/package.json`));
    const arquivo = join(base, 'files', `${id}-latin-${peso}-${estilo}.woff`);
    return existsSync(arquivo) ? arquivo : null;
  } catch {
    return null;
  }
}

/** Helvetica/Times/Courier usam WinAnsi; o que não couber vira o equivalente sem acento. */
export function codificavel(texto: string, fonte: PDFFont): string {
  try {
    fonte.encodeText(texto);
    return texto;
  } catch {
    return [...texto]
      .map((c) => {
        try {
          fonte.encodeText(c);
          return c;
        } catch {
          return semAcentos(c);
        }
      })
      .join('');
  }
}

/** Carrega cada variante uma vez por documento. */
export class FontesPdf {
  private readonly cache = new Map<string, Promise<PDFFont>>();

  constructor(private readonly doc: PDFDocument) {
    doc.registerFontkit(fontkit);
  }

  private carregar(chave: string, criar: () => Promise<PDFFont>) {
    let f = this.cache.get(chave);
    if (!f) this.cache.set(chave, (f = criar()));
    return f;
  }

  async obter(id: string | undefined, negrito: boolean, italico: boolean): Promise<FonteResolvida> {
    const cat = fonteDoCatalogo(id);
    let fonte: PDFFont;
    let simularNegrito = false;
    let simularItalico = false;
    if (cat.padraoPdf) {
      const variantes = PADRAO[cat.id];
      fonte = await this.carregar(`${cat.id}-${negrito}-${italico}`, () => this.doc.embedFont(variantes[(negrito ? 1 : 0) + (italico ? 2 : 0)]));
    } else {
      // Procura a variante exata; senão a regular, simulando o que faltar.
      const peso = negrito && cat.negrito ? 700 : 400;
      const estilo = italico && cat.italico ? 'italic' : 'normal';
      simularNegrito = negrito && peso !== 700;
      simularItalico = italico && estilo !== 'italic';
      const arquivo = arquivoFonte(cat.id, peso, estilo) ?? arquivoFonte(cat.id, 400, 'normal');
      if (arquivo) {
        // WOFF → TTF (o fontkit lê WOFF com falhas) e sem subset: o subsetter do fontkit lança
        // erro assíncrono que derruba o processo. Os arquivos latinos têm só 15–75 KB.
        fonte = await this.carregar(arquivo, () => this.doc.embedFont(woffParaSfnt(readFileSync(arquivo)), { subset: false }));
      } else {
        fonte = await this.carregar('helvetica-fallback', () => this.doc.embedFont(StandardFonts.Helvetica));
      }
    }
    return {
      fonte,
      simularNegrito,
      simularItalico,
      medir: (texto, tamanho) => fonte.widthOfTextAtSize(codificavel(texto, fonte), tamanho),
    };
  }
}
