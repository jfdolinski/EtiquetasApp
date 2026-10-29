import {
  ampliacaoQr,
  Avisos,
  codigoValido,
  eixos,
  larguraModulo,
  posicionar,
  type ElementoPosicionado,
  type OpcoesGeracao,
} from './comum';
import { mmParaPontos } from './valores';
import type { LayoutEtiqueta, Registro, Rotacao, SaidaEtiquetas } from './tipos';

const ORIENTACAO: Record<Rotacao, string> = { 0: 'N', 90: 'R', 180: 'I', 270: 'B' };
const JUSTIFICA = { esquerda: 'L', centro: 'C', direita: 'R' } as const;

/** ^FH: `_` vira indicador hexadecimal; ^ e ~ são comandos em ZPL. */
function campo(texto: string): string {
  return `^FH^FD${texto.replace(/[_^~]/g, (c) => `_${c.charCodeAt(0).toString(16).toUpperCase()}`)}^FS`;
}

function elemento(e: ElementoPosicionado, dpi: number, avisos: Avisos): string {
  const o = ORIENTACAO[e.el.rotacao];
  const fo = `^FO${e.x},${e.y}`;
  const { comprimento, espessura } = eixos(e);

  switch (e.el.tipo) {
    case 'texto': {
      if (!e.texto) return '';
      const altura = Math.max(10, Math.round((e.el.tamanhoPt * dpi) / 72));
      const linhas = Math.max(1, Math.floor(espessura / altura));
      const corpo = `^A0${o},${altura}^FB${comprimento},${linhas},0,${JUSTIFICA[e.el.alinhamento]},0${campo(e.texto)}`;
      // ZPL não tem negrito na fonte 0: imprime de novo deslocado 1–2 pontos.
      const reforco = e.el.negrito ? `^FO${e.x + Math.max(1, Math.round(dpi / 200))},${e.y}${corpo}` : '';
      return fo + corpo + reforco;
    }
    case 'codigo_barras': {
      const c = codigoValido(e, avisos);
      if (!c) return '';
      const texto = e.el.mostrarTexto ? 'Y' : 'N';
      const altura = Math.max(10, espessura - (e.el.mostrarTexto ? mmParaPontos(3, dpi) : 0));
      const modulo = larguraModulo(e.el.simbologia, c.dados, comprimento);
      const by = `^BY${modulo},3,${altura}`;
      switch (e.el.simbologia) {
        case 'EAN13':
          return `${fo}${by}^BE${o},${altura},${texto},N${campo(c.dados)}`;
        case 'EAN8':
          return `${fo}${by}^B8${o},${altura},${texto},N${campo(c.dados)}`;
        case 'CODE39':
          return `${fo}${by}^B3${o},N,${altura},${texto},N${campo(c.dados)}`;
        case 'CODE128':
          // Modo A (automático): a impressora escolhe os subconjuntos B/C.
          return `${fo}${by}^BC${o},${altura},${texto},N,N,A${campo(c.dados)}`;
      }
      return '';
    }
    case 'qrcode': {
      if (!e.texto) return '';
      if (e.el.rotacao !== 0) avisos.add('ZPL: QR code é sempre impresso sem rotação.');
      const amp = ampliacaoQr(e.texto, Math.min(e.largura, e.altura), 10);
      // ^BQ desenha ~10 pontos abaixo do ^FO; MA = correção M, entrada automática.
      return `^FO${e.x},${Math.max(0, e.y - 10)}^BQN,2,${amp}^FH^FDMA,${e.texto.replace(/[_^~]/g, (ch) => `_${ch.charCodeAt(0).toString(16).toUpperCase()}`)}^FS`;
    }
    case 'retangulo': {
      const t = Math.max(1, mmParaPontos(e.el.espessuraMm, dpi));
      return `${fo}^GB${e.largura},${e.altura},${e.el.preenchido ? Math.min(e.largura, e.altura) : t}^FS`;
    }
    case 'linha': {
      const t = Math.max(1, mmParaPontos(e.el.espessuraMm, dpi));
      return e.largura >= e.altura ? `${fo}^GB${e.largura},${t},${t}^FS` : `${fo}^GB${t},${e.altura},${t}^FS`;
    }
  }
}

/** Gera ZPL II: um formato (^XA…^XZ) por fileira de etiquetas, UTF-8 (^CI28). */
export function gerarZpl(layout: LayoutEtiqueta, registros: Registro[], opcoes: OpcoesGeracao): SaidaEtiquetas {
  const avisos = new Avisos();
  const formatos = posicionar(layout, registros, opcoes).map((p) =>
    [
      '^XA',
      '^CI28',
      `^PW${p.larguraPontos}`,
      `^LL${p.alturaPontos}`,
      '^LH0,0',
      ...p.elementos.map((e) => elemento(e, opcoes.dpi, avisos)).filter(Boolean),
      '^PQ1',
      '^XZ',
    ].join('\n'),
  );
  return { linguagem: 'ZPL', mime: 'text/plain; charset=utf-8', codificacao: 'texto', conteudo: formatos.join('\n'), avisos: avisos.lista() };
}
