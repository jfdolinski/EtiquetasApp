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
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-400-italic.css';
import '@fontsource/inter/latin-700-italic.css';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-400-italic.css';
import '@fontsource/nunito/latin-700-italic.css';
import '@fontsource/raleway/latin-400.css';
import '@fontsource/raleway/latin-700.css';
import '@fontsource/raleway/latin-400-italic.css';
import '@fontsource/raleway/latin-700-italic.css';
import '@fontsource/ubuntu/latin-400.css';
import '@fontsource/ubuntu/latin-700.css';
import '@fontsource/ubuntu/latin-400-italic.css';
import '@fontsource/ubuntu/latin-700-italic.css';
import '@fontsource/rubik/latin-400.css';
import '@fontsource/rubik/latin-700.css';
import '@fontsource/rubik/latin-400-italic.css';
import '@fontsource/rubik/latin-700-italic.css';
import '@fontsource/work-sans/latin-400.css';
import '@fontsource/work-sans/latin-700.css';
import '@fontsource/work-sans/latin-400-italic.css';
import '@fontsource/work-sans/latin-700-italic.css';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-700.css';
import '@fontsource/barlow/latin-400-italic.css';
import '@fontsource/barlow/latin-700-italic.css';
import '@fontsource/barlow-condensed/latin-400.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-400-italic.css';
import '@fontsource/barlow-condensed/latin-700-italic.css';
import '@fontsource/fira-sans/latin-400.css';
import '@fontsource/fira-sans/latin-700.css';
import '@fontsource/fira-sans/latin-400-italic.css';
import '@fontsource/fira-sans/latin-700-italic.css';
import '@fontsource/quicksand/latin-400.css';
import '@fontsource/quicksand/latin-700.css';
import '@fontsource/comfortaa/latin-400.css';
import '@fontsource/comfortaa/latin-700.css';
import '@fontsource/josefin-sans/latin-400.css';
import '@fontsource/josefin-sans/latin-700.css';
import '@fontsource/josefin-sans/latin-400-italic.css';
import '@fontsource/josefin-sans/latin-700-italic.css';
import '@fontsource/exo-2/latin-400.css';
import '@fontsource/exo-2/latin-700.css';
import '@fontsource/exo-2/latin-400-italic.css';
import '@fontsource/exo-2/latin-700-italic.css';
import '@fontsource/titillium-web/latin-400.css';
import '@fontsource/titillium-web/latin-700.css';
import '@fontsource/titillium-web/latin-400-italic.css';
import '@fontsource/titillium-web/latin-700-italic.css';
import '@fontsource/league-spartan/latin-400.css';
import '@fontsource/league-spartan/latin-700.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-700.css';
import '@fontsource/dm-sans/latin-400-italic.css';
import '@fontsource/dm-sans/latin-700-italic.css';
import '@fontsource/mulish/latin-400.css';
import '@fontsource/mulish/latin-700.css';
import '@fontsource/mulish/latin-400-italic.css';
import '@fontsource/mulish/latin-700-italic.css';
import '@fontsource/karla/latin-400.css';
import '@fontsource/karla/latin-700.css';
import '@fontsource/karla/latin-400-italic.css';
import '@fontsource/karla/latin-700-italic.css';
import '@fontsource/source-sans-3/latin-400.css';
import '@fontsource/source-sans-3/latin-700.css';
import '@fontsource/source-sans-3/latin-400-italic.css';
import '@fontsource/source-sans-3/latin-700-italic.css';
import '@fontsource/teko/latin-400.css';
import '@fontsource/teko/latin-700.css';
import '@fontsource/fjalla-one/latin-400.css';
import '@fontsource/archivo-narrow/latin-400.css';
import '@fontsource/archivo-narrow/latin-700.css';
import '@fontsource/archivo-narrow/latin-400-italic.css';
import '@fontsource/archivo-narrow/latin-700-italic.css';
import '@fontsource/abril-fatface/latin-400.css';
import '@fontsource/alfa-slab-one/latin-400.css';
import '@fontsource/lilita-one/latin-400.css';
import '@fontsource/fredoka/latin-400.css';
import '@fontsource/fredoka/latin-700.css';
import '@fontsource/baloo-2/latin-400.css';
import '@fontsource/baloo-2/latin-700.css';
import '@fontsource/righteous/latin-400.css';
import '@fontsource/russo-one/latin-400.css';
import '@fontsource/passion-one/latin-400.css';
import '@fontsource/passion-one/latin-700.css';
import '@fontsource/luckiest-guy/latin-400.css';
import '@fontsource/bungee/latin-400.css';
import '@fontsource/titan-one/latin-400.css';
import '@fontsource/roboto-slab/latin-400.css';
import '@fontsource/roboto-slab/latin-700.css';
import '@fontsource/lora/latin-400.css';
import '@fontsource/lora/latin-700.css';
import '@fontsource/lora/latin-400-italic.css';
import '@fontsource/lora/latin-700-italic.css';
import '@fontsource/pt-serif/latin-400.css';
import '@fontsource/pt-serif/latin-700.css';
import '@fontsource/pt-serif/latin-400-italic.css';
import '@fontsource/pt-serif/latin-700-italic.css';
import '@fontsource/libre-baskerville/latin-400.css';
import '@fontsource/libre-baskerville/latin-700.css';
import '@fontsource/libre-baskerville/latin-400-italic.css';
import '@fontsource/libre-baskerville/latin-700-italic.css';
import '@fontsource/eb-garamond/latin-400.css';
import '@fontsource/eb-garamond/latin-700.css';
import '@fontsource/eb-garamond/latin-400-italic.css';
import '@fontsource/eb-garamond/latin-700-italic.css';
import '@fontsource/bree-serif/latin-400.css';
import '@fontsource/great-vibes/latin-400.css';
import '@fontsource/satisfy/latin-400.css';
import '@fontsource/kaushan-script/latin-400.css';
import '@fontsource/caveat/latin-400.css';
import '@fontsource/caveat/latin-700.css';
import '@fontsource/sacramento/latin-400.css';
import '@fontsource/shadows-into-light/latin-400.css';
import '@fontsource/amatic-sc/latin-400.css';
import '@fontsource/amatic-sc/latin-700.css';
import '@fontsource/indie-flower/latin-400.css';
import '@fontsource/courgette/latin-400.css';
import '@fontsource/roboto-mono/latin-400.css';
import '@fontsource/roboto-mono/latin-700.css';
import '@fontsource/roboto-mono/latin-400-italic.css';
import '@fontsource/roboto-mono/latin-700-italic.css';

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
