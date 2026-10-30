import {
  ampliacaoQr,
  ancora,
  Avisos,
  codigoValido,
  deslocamentoAlinhamento,
  eixos,
  larguraModulo,
  posicionar,
  semAcentos,
  type ElementoPosicionado,
  type OpcoesGeracao,
} from './comum';
import { paraBase64 } from './escpos';
import { bitmapNaCaixa } from './imagem';
import { mmParaPontos } from './valores';
import type { LayoutEtiqueta, Registro, Rotacao, SaidaEtiquetas } from './tipos';

/** Fontes residentes EPL/PPLB (largura × altura em pontos) a 203 e 300 dpi. */
const FONTES: Record<'203' | '300', [number, number][]> = {
  '203': [[8, 12], [10, 16], [12, 20], [14, 24], [32, 48]],
  '300': [[12, 20], [16, 28], [20, 36], [24, 44], [48, 80]],
};

const ROTACAO: Record<Rotacao, number> = { 0: 0, 90: 1, 180: 2, 270: 3 };

/** Escolhe fonte e multiplicador cuja altura mais se aproxima da desejada. */
export function escolherFontePplb(alturaDesejada: number, dpi: number) {
  const tabela = FONTES[dpi >= 300 ? '300' : '203'];
  let melhor = { fonte: 1, mult: 1, largura: tabela[0][0], altura: tabela[0][1] };
  for (let f = 0; f < tabela.length; f++) {
    for (let m = 1; m <= 9; m++) {
      const h = tabela[f][1] * m;
      if (Math.abs(h - alturaDesejada) < Math.abs(melhor.altura - alturaDesejada)) {
        melhor = { fonte: f + 1, mult: m, largura: tabela[f][0] * m, altura: h };
      }
    }
  }
  return melhor;
}

function aspas(texto: string) {
  return `"${semAcentos(texto).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Linha de comando; GW leva bytes crus depois do cabeçalho. */
type Comando = string | { cabecalho: string; dados: Uint8Array };

function elemento(e: ElementoPosicionado, dpi: number, avisos: Avisos): Comando[] {
  const r = ROTACAO[e.el.rotacao];
  const { comprimento, espessura } = eixos(e);

  switch (e.el.tipo) {
    case 'texto': {
      if (!e.texto) return [];
      const f = escolherFontePplb((e.el.tamanhoPt * dpi) / 72, dpi);
      const ocupado = (f.largura + 2 * f.mult) * e.texto.length;
      if (ocupado > comprimento * 1.05) avisos.add(`Etiqueta ${e.numero}: texto "${e.texto.slice(0, 30)}" pode não caber na caixa (PPLB não quebra linha).`);
      const p = ancora(e, deslocamentoAlinhamento(e.el.alinhamento, comprimento, ocupado));
      const cmd = (dx: number) => `A${p.x + dx},${p.y},${r},${f.fonte},${f.mult},${f.mult},N,${aspas(e.texto)}`;
      return e.el.negrito ? [cmd(0), cmd(1)] : [cmd(0)];
    }
    case 'codigo_barras': {
      const c = codigoValido(e, avisos);
      if (!c) return [];
      const tipos = { EAN13: 'E30', EAN8: 'E80', CODE128: '1', CODE39: '3' } as const;
      const modulo = larguraModulo(e.el.simbologia, c.dados, comprimento);
      const altura = Math.max(10, espessura - (e.el.mostrarTexto ? mmParaPontos(3, dpi) : 0));
      const p = ancora(e, 0);
      return [`B${p.x},${p.y},${r},${tipos[e.el.simbologia]},${modulo},${modulo * 3},${altura},${e.el.mostrarTexto ? 'B' : 'N'},${aspas(c.dados)}`];
    }
    case 'qrcode': {
      if (!e.texto) return [];
      if (e.el.rotacao !== 0) avisos.add('PPLB: QR code é sempre impresso sem rotação.');
      const amp = ampliacaoQr(e.texto, Math.min(e.largura, e.altura), 99);
      return [`b${e.x},${e.y},Q,m2,s${amp},eM,iA,${aspas(e.texto)}`];
    }
    case 'retangulo': {
      const t = Math.max(1, mmParaPontos(e.el.espessuraMm, dpi));
      if (e.el.preenchido) return [`LO${e.x},${e.y},${e.largura},${e.altura}`];
      return [`X${e.x},${e.y},${t},${e.x + e.largura},${e.y + e.altura}`];
    }
    case 'linha': {
      const t = Math.max(1, mmParaPontos(e.el.espessuraMm, dpi));
      return [e.largura >= e.altura ? `LO${e.x},${e.y},${e.largura},${t}` : `LO${e.x},${e.y},${t},${e.altura}`];
    }
    case 'imagem': {
      const b = bitmapNaCaixa(e.el, e.largura, e.altura);
      // No GW do EPL/PPLB o bit 0 é que imprime (preto): inverte o bitmap.
      const dados = b.dados.map((byte) => ~byte & 0xff);
      return [{ cabecalho: `GW${e.x},${e.y},${b.bytesPorLinha},${b.altura},`, dados }];
    }
  }
}

function emBytes(comandos: Comando[]): Uint8Array {
  const partes: Uint8Array[] = [];
  const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0x7f);
  for (const c of comandos) {
    if (typeof c === 'string') partes.push(ascii(c + '\n'));
    else partes.push(ascii(c.cabecalho), c.dados, ascii('\n'));
  }
  const total = new Uint8Array(partes.reduce((t, p) => t + p.length, 0));
  let i = 0;
  for (const p of partes) {
    total.set(p, i);
    i += p.length;
  }
  return total;
}

/** Gera PPLB (compatível com EPL2), um formulário por fileira de etiquetas. */
export function gerarPplb(layout: LayoutEtiqueta, registros: Registro[], opcoes: OpcoesGeracao): SaidaEtiquetas {
  const avisos = new Avisos();
  const gap = mmParaPontos(layout.papel.tipo === 'rolo' ? layout.espacamentoVerticalMm : 0, opcoes.dpi);
  const paginas = posicionar(layout, registros, opcoes);
  const comandos = paginas.flatMap((p): Comando[] => [
    '',
    'N',
    `q${p.larguraPontos}`,
    `Q${p.alturaPontos},${gap}`,
    ...p.elementos.flatMap((e) => elemento(e, opcoes.dpi, avisos)),
    'P1',
  ]);
  if (paginas.some((p) => p.elementos.some((e) => e.texto !== semAcentos(e.texto)))) {
    avisos.add('PPLB: acentos e caracteres especiais foram removidos.');
  }
  if (comandos.some((c) => typeof c !== 'string')) {
    // Imagem (GW) tem bytes binários: a saída deixa de ser texto.
    return { linguagem: 'PPLB', mime: 'application/octet-stream', codificacao: 'base64', conteudo: paraBase64(emBytes(comandos)), avisos: avisos.lista() };
  }
  return { linguagem: 'PPLB', mime: 'text/plain; charset=us-ascii', codificacao: 'texto', conteudo: comandos.join('\n') + '\n', avisos: avisos.lista() };
}
