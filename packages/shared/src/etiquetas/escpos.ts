import { ampliacaoQr, avisarRecursosDesign, Avisos, codigoValido, deslocamentoAlinhamento, posicionar, type ElementoPosicionado, type OpcoesGeracao } from './comum';
import { bitmapNaCaixa } from './imagem';
import type { LayoutEtiqueta, Registro, SaidaEtiquetas } from './tipos';

/**
 * ESC/POS em modo página (impressoras térmicas de 80 mm, padrão Epson). Cada fileira de
 * etiquetas vira uma página posicionada em pontos e é impressa com FF, seguida de corte.
 * Texto na fonte A (12 × 24 pontos) com multiplicadores; página de código WPC1252.
 */
const ESC = 0x1b;
const GS = 0x1d;

class Bytes {
  private readonly partes: number[] = [];
  add(...b: number[]) {
    this.partes.push(...b);
    return this;
  }
  u16(n: number) {
    const v = Math.max(0, Math.min(0xffff, Math.round(n)));
    return this.add(v & 0xff, v >> 8);
  }
  texto(s: string) {
    for (const ch of s) {
      const c = ch.codePointAt(0)!;
      // WPC1252 ≈ Latin-1 para o português; fora disso, '?'.
      this.partes.push(c < 256 ? c : 0x3f);
    }
    return this;
  }
  get tamanho() {
    return this.partes.length;
  }
  paraArray() {
    return Uint8Array.from(this.partes);
  }
}

export function paraBase64(bytes: Uint8Array): string {
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}

function posicao(b: Bytes, x: number, yBase: number) {
  b.add(ESC, 0x24).u16(x); // ESC $ horizontal absoluta
  b.add(GS, 0x24).u16(yBase); // GS $ vertical absoluta (linha de base)
}

function elemento(b: Bytes, e: ElementoPosicionado, avisos: Avisos) {
  if (e.el.rotacao !== 0 && (e.el.tipo === 'texto' || e.el.tipo === 'preco' || e.el.tipo === 'codigo_barras' || e.el.tipo === 'qrcode')) {
    avisos.add('ESC/POS: rotação não é suportada; os elementos saem sem rotação.');
  }
  switch (e.el.tipo) {
    case 'texto':
    case 'preco': {
      if (!e.texto) return;
      const mult = Math.max(1, Math.min(8, Math.round(((e.el.tamanhoPt * 203) / 72) / 24)));
      const ocupado = 12 * mult * e.texto.length;
      if (ocupado > e.largura * 1.05) avisos.add(`Etiqueta ${e.numero}: texto "${e.texto.slice(0, 30)}" pode não caber na caixa.`);
      posicao(b, e.x + deslocamentoAlinhamento(e.el.alinhamento, e.largura, ocupado), e.y + 24 * mult);
      b.add(ESC, 0x45, e.el.negrito ? 1 : 0); // ESC E negrito
      b.add(GS, 0x21, ((mult - 1) << 4) | (mult - 1)); // GS ! tamanho
      b.texto(e.texto);
      b.add(GS, 0x21, 0, ESC, 0x45, 0);
      return;
    }
    case 'codigo_barras': {
      const c = codigoValido(e, avisos);
      if (!c) return;
      const textoAbaixo = e.el.mostrarTexto ? 24 : 0;
      const altura = Math.max(16, Math.min(255, e.altura - textoAbaixo));
      const modulo = Math.max(2, Math.min(6, Math.floor(e.largura / (e.el.simbologia === 'EAN13' ? 95 : e.el.simbologia === 'EAN8' ? 67 : (c.dados.length + 3) * 11))));
      posicao(b, e.x, e.y + altura);
      b.add(GS, 0x68, altura, GS, 0x77, modulo, GS, 0x48, e.el.mostrarTexto ? 2 : 0);
      const m = { EAN13: 67, EAN8: 68, CODE39: 69, CODE128: 73 }[e.el.simbologia];
      const dados = e.el.simbologia === 'CODE128' ? `{B${c.dados}` : c.dados;
      b.add(GS, 0x6b, m, dados.length).texto(dados);
      return;
    }
    case 'qrcode': {
      if (!e.texto) return;
      const bytes = new TextEncoder().encode(e.texto);
      const tamanho = Math.max(1, Math.min(16, ampliacaoQr(e.texto, Math.min(e.largura, e.altura), 16)));
      posicao(b, e.x, e.y);
      b.add(GS, 0x28, 0x6b, 4, 0, 49, 65, 50, 0); // modelo 2
      b.add(GS, 0x28, 0x6b, 3, 0, 49, 67, tamanho); // tamanho do módulo
      b.add(GS, 0x28, 0x6b, 3, 0, 49, 69, 49); // correção M
      b.add(GS, 0x28, 0x6b).u16(bytes.length + 3).add(49, 80, 48, ...bytes); // armazena
      b.add(GS, 0x28, 0x6b, 3, 0, 49, 81, 48); // imprime
      return;
    }
    case 'retangulo':
    case 'linha':
    case 'elipse':
    case 'estrela':
      avisos.add('ESC/POS: linhas e formas não são impressas nesta linguagem.');
      return;
    case 'imagem': {
      const bm = bitmapNaCaixa(e.el, e.largura, e.altura);
      // ESC * modo 33 (24 pontos, densidade dupla): faixas de 24 linhas, 3 bytes por coluna.
      for (let faixa = 0; faixa < bm.altura; faixa += 24) {
        posicao(b, e.x, e.y + faixa + 24); // no modo página a faixa fica acima da linha de base
        b.add(ESC, 0x2a, 33).u16(bm.largura);
        for (let x = 0; x < bm.largura; x++) {
          for (let k = 0; k < 3; k++) {
            let byte = 0;
            for (let bit = 0; bit < 8; bit++) {
              const y = faixa + k * 8 + bit;
              if (y < bm.altura && bm.dados[y * bm.bytesPorLinha + (x >> 3)] & (0x80 >> (x & 7))) byte |= 0x80 >> bit;
            }
            b.add(byte);
          }
        }
      }
    }
  }
}

export function gerarEscpos(layout: LayoutEtiqueta, registros: Registro[], opcoes: OpcoesGeracao): SaidaEtiquetas {
  const avisos = new Avisos();
  avisarRecursosDesign(layout, 'ESC/POS', avisos);
  const b = new Bytes();
  b.add(ESC, 0x40, ESC, 0x74, 16); // inicializa, página de código WPC1252
  if (opcoes.dpi > 255) avisos.add('ESC/POS: DPI acima de 255 não é suportado; usando 203.');
  const dpi = Math.min(255, opcoes.dpi);
  for (const p of posicionar(layout, registros, { ...opcoes, dpi })) {
    b.add(GS, 0x50, dpi, dpi); // GS P: unidade = 1/dpi polegada
    b.add(ESC, 0x4c); // ESC L: modo página
    b.add(ESC, 0x57).u16(0).u16(0).u16(p.larguraPontos).u16(p.alturaPontos); // ESC W: área
    b.add(ESC, 0x54, 0); // ESC T: direção normal
    for (const e of p.elementos) elemento(b, e, avisos);
    b.add(0x0c); // FF: imprime a página e volta ao modo padrão
    b.add(GS, 0x56, 66, 0); // GS V: avança e corta (ignorado sem guilhotina)
  }
  return { linguagem: 'ESCPOS', mime: 'application/octet-stream', codificacao: 'base64', conteudo: paraBase64(b.paraArray()), avisos: avisos.lista() };
}
