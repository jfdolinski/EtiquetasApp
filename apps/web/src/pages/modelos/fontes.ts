import { useEffect, useState } from 'react';
import { fonteDoCatalogo, type ElementoEtiqueta, type Medidor } from '@etiquetas/shared';

// Mesmas fontes que a API embute no PDF (Fontsource, subconjunto latino). O navegador só
// baixa cada arquivo quando a fonte é usada.
import '@fontsource/roboto/latin-400.css';
import '@fontsource/roboto/latin-700.css';
import '@fontsource/roboto/latin-400-italic.css';
import '@fontsource/roboto/latin-700-italic.css';
import '@fontsource/open-sans/latin-400.css';
import '@fontsource/open-sans/latin-700.css';
import '@fontsource/open-sans/latin-400-italic.css';
import '@fontsource/open-sans/latin-700-italic.css';
import '@fontsource/montserrat/latin-400.css';
import '@fontsource/montserrat/latin-700.css';
import '@fontsource/montserrat/latin-400-italic.css';
import '@fontsource/montserrat/latin-700-italic.css';
import '@fontsource/lato/latin-400.css';
import '@fontsource/lato/latin-700.css';
import '@fontsource/lato/latin-400-italic.css';
import '@fontsource/lato/latin-700-italic.css';
import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-700.css';
import '@fontsource/poppins/latin-400-italic.css';
import '@fontsource/poppins/latin-700-italic.css';
import '@fontsource/roboto-condensed/latin-400.css';
import '@fontsource/roboto-condensed/latin-700.css';
import '@fontsource/roboto-condensed/latin-400-italic.css';
import '@fontsource/roboto-condensed/latin-700-italic.css';
import '@fontsource/oswald/latin-400.css';
import '@fontsource/oswald/latin-700.css';
import '@fontsource/bebas-neue/latin-400.css';
import '@fontsource/anton/latin-400.css';
import '@fontsource/playfair-display/latin-400.css';
import '@fontsource/playfair-display/latin-700.css';
import '@fontsource/playfair-display/latin-400-italic.css';
import '@fontsource/playfair-display/latin-700-italic.css';
import '@fontsource/merriweather/latin-400.css';
import '@fontsource/merriweather/latin-700.css';
import '@fontsource/merriweather/latin-400-italic.css';
import '@fontsource/merriweather/latin-700-italic.css';
import '@fontsource/archivo-black/latin-400.css';
import '@fontsource/bangers/latin-400.css';
import '@fontsource/lobster/latin-400.css';
import '@fontsource/pacifico/latin-400.css';
import '@fontsource/dancing-script/latin-400.css';
import '@fontsource/dancing-script/latin-700.css';
import '@fontsource/permanent-marker/latin-400.css';

/** Declaração CSS `font` (o tamanho em px é o do desenho). */
export function cssFonte(fonte: string | undefined, negrito: boolean, italico: boolean, tamanhoPx: number) {
  const f = fonteDoCatalogo(fonte);
  const familia = f.padraoPdf ? f.familia : `"${f.familia}"`;
  return `${italico ? 'italic ' : ''}${negrito ? 700 : 400} ${tamanhoPx}px ${familia}`;
}

const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

/** Mede como o PDF mede (pt), para o editor quebrar as linhas igual. */
export function medidorNavegador(fonte: string | undefined, negrito: boolean, italico: boolean): Medidor {
  const ctx = canvas!.getContext('2d')!;
  const css = cssFonte(fonte, negrito, italico, 100);
  return (texto, tamanho) => {
    ctx.font = css;
    return (ctx.measureText(texto).width / 100) * tamanho;
  };
}

/** Variantes usadas no layout: carrega antes de desenhar e avisa quando chegam (o canvas não redesenha sozinho). */
export function useFontesCarregadas(elementos: ElementoEtiqueta[]): number {
  const [versao, setVersao] = useState(0);
  const chaves = [
    ...new Set(
      elementos.flatMap((el) => (el.tipo === 'texto' || el.tipo === 'preco' ? [cssFonte(el.fonte, el.negrito, el.italico ?? false, 40)] : [])),
    ),
  ].sort();
  const assinatura = chaves.join('|');
  useEffect(() => {
    if (!chaves.length) return;
    let ativo = true;
    void Promise.all(chaves.map((c) => document.fonts.load(c).catch(() => []))).then(() => ativo && setVersao((v) => v + 1));
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);
  return versao;
}
