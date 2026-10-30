import {
  Avisos,
  ancora,
  cinzaDoElemento,
  codigoValido,
  corRgb,
  diagramarPreco,
  eixos,
  emPaginas,
  paginar,
  planejarTexto,
  pontosEstrela,
  posicionar,
  type Contorno,
  type Cor,
  type ElementoPosicionado,
  type ElementoPreco,
  type ElementoTexto,
  type LayoutEtiqueta,
  type Registro,
  type Rotacao,
  type SaidaEtiquetas,
} from '@etiquetas/shared';
import * as bwipjs from 'bwip-js';
import { degrees, PDFDocument, rgb, type PDFImage, type PDFPage } from 'pdf-lib';
import { codificavel, FontesPdf, type FonteResolvida } from './fontes-pdf';
import { pngCinza } from './png';

/** Resolução interna: 720 "pontos" por polegada = décimos de ponto do PDF. */
const DPI = 720;
const pt = (v: number) => v / 10;
const mmPt = (mm: number) => (mm * 72) / 25.4;

const BCID = { EAN13: 'ean13', EAN8: 'ean8', CODE128: 'code128', CODE39: 'code39' } as const;
const GIRO_BWIP: Record<Rotacao, 'N' | 'R' | 'I' | 'L'> = { 0: 'N', 90: 'R', 180: 'I', 270: 'L' };

const cor = (c: Cor | null | undefined, padrao = '#000000') => rgb(...corRgb(c, padrao));

/** Ponto local (u ao longo do texto, v para baixo) → página (y para baixo), girando no sentido horário. */
function girar(a: { x: number; y: number }, u: number, v: number, rot: Rotacao) {
  switch (rot) {
    case 90:
      return { x: a.x - v, y: a.y + u };
    case 180:
      return { x: a.x - u, y: a.y - v };
    case 270:
      return { x: a.x + v, y: a.y - u };
    default:
      return { x: a.x + u, y: a.y + v };
  }
}

/** Tracejado proporcional à espessura (pt). */
const tracejado = (espessura: number) => [Math.max(2, espessura * 3), Math.max(1.5, espessura * 2)];

/** Contorno de retângulo de cantos arredondados em SVG (y para baixo, origem no canto). */
function caminhoArredondado(w: number, h: number, r: number) {
  const k = Math.min(r, w / 2, h / 2);
  return `M ${k} 0 H ${w - k} A ${k} ${k} 0 0 1 ${w} ${k} V ${h - k} A ${k} ${k} 0 0 1 ${w - k} ${h} H ${k} A ${k} ${k} 0 0 1 0 ${h - k} V ${k} A ${k} ${k} 0 0 1 ${k} 0 Z`;
}

interface Traco {
  texto: string;
  u: number;
  v: number;
  tamanho: number;
  largura: number;
}

class DesenhoPdf {
  private readonly imagens = new Map<string, PDFImage>();

  constructor(
    private readonly doc: PDFDocument,
    private readonly fontes: FontesPdf,
    private readonly avisos: Avisos,
  ) {}

  private async imagemCodigo(chave: string, opcoes: Parameters<typeof bwipjs.toBuffer>[0]) {
    let img = this.imagens.get(chave);
    if (!img) {
      img = await this.doc.embedPng(await bwipjs.toBuffer(opcoes));
      this.imagens.set(chave, img);
    }
    return img;
  }

  /**
   * Desenha trechos de texto (já posicionados no sistema local da caixa, em pt) com cor,
   * contorno, espaçamento entre letras, decorações e negrito/itálico simulados.
   */
  private tracos(pagina: PDFPage, e: ElementoPosicionado, el: ElementoTexto | ElementoPreco, f: FonteResolvida, tracos: Traco[]) {
    const H = pagina.getHeight();
    const a = ancora(e);
    const rot = e.el.rotacao;
    const opacidade = el.opacidade ?? 1;
    const espacamento = el.tipo === 'texto' ? (el.espacamentoLetras ?? 0) : 0;
    const desenhar = (t: Traco, du: number, dv: number, c: ReturnType<typeof cor>) => {
      const escrever = (texto: string, u: number) => {
        const p = girar(a, (u + du) * 10, (t.v + dv) * 10, rot);
        pagina.drawText(codificavel(texto, f.fonte), {
          x: pt(p.x),
          y: H - pt(p.y),
          size: t.tamanho,
          font: f.fonte,
          color: c,
          opacity: opacidade,
          rotate: degrees(-rot),
          // No pdf-lib, ySkew é que inclina as letras na horizontal (como itálico).
          ySkew: f.simularItalico ? degrees(12) : undefined,
        });
      };
      if (!espacamento) escrever(t.texto, t.u);
      else {
        let u = t.u;
        for (const ch of t.texto) {
          escrever(ch, u);
          u += f.medir(ch, t.tamanho) + espacamento;
        }
      }
    };
    const contorno: Contorno | null | undefined = el.contorno;
    const corTexto = cor(el.cor);
    for (const t of tracos) {
      if (contorno) {
        // Contorno: o texto repetido em volta, na cor do contorno, antes do preenchimento.
        const r = contorno.espessuraPt;
        const corContorno = cor(contorno.cor);
        for (let i = 0; i < 16; i++) {
          const ang = (i * Math.PI) / 8;
          desenhar(t, Math.cos(ang) * r, Math.sin(ang) * r, corContorno);
        }
      }
      desenhar(t, 0, 0, corTexto);
      if (f.simularNegrito) desenhar(t, t.tamanho * 0.03, 0, corTexto);
      if (el.tipo === 'texto' && (el.sublinhado || el.tachado)) {
        const espessura = Math.max(0.5, t.tamanho * 0.06);
        const linhas = [el.sublinhado ? t.v + t.tamanho * 0.12 : null, el.tachado ? t.v - t.tamanho * 0.28 : null];
        for (const v of linhas) {
          if (v === null) continue;
          const p0 = girar(a, t.u * 10, v * 10, rot);
          const p1 = girar(a, (t.u + t.largura) * 10, v * 10, rot);
          pagina.drawLine({ start: { x: pt(p0.x), y: H - pt(p0.y) }, end: { x: pt(p1.x), y: H - pt(p1.y) }, thickness: espessura, color: corTexto, opacity: opacidade });
        }
      }
    }
  }

  private fundo(pagina: PDFPage, caixa: { x: number; y: number; width: number; height: number }, c: Cor | null | undefined, opacidade: number) {
    if (c) pagina.drawRectangle({ ...caixa, color: cor(c), opacity: opacidade });
  }

  async elemento(pagina: PDFPage, e: ElementoPosicionado) {
    const H = pagina.getHeight();
    const caixa = { x: pt(e.x), y: H - pt(e.y) - pt(e.altura), width: pt(e.largura), height: pt(e.altura) };
    const opacidade = e.el.opacidade ?? 1;
    if (opacidade <= 0) return;

    switch (e.el.tipo) {
      case 'texto': {
        this.fundo(pagina, caixa, e.el.corFundo, opacidade);
        if (!e.texto) return;
        const f = await this.fontes.obter(e.el.fonte, e.el.negrito, e.el.italico ?? false);
        const { comprimento, espessura } = eixos(e);
        const plano = planejarTexto(e.el, e.texto, pt(comprimento), pt(espessura), f.medir);
        this.tracos(pagina, e, e.el, f, plano.linhas.map((l) => ({ ...l, tamanho: plano.tamanhoPt })));
        return;
      }
      case 'preco': {
        this.fundo(pagina, caixa, e.el.corFundo, opacidade);
        if (!e.texto) return;
        const f = await this.fontes.obter(e.el.fonte, e.el.negrito, e.el.italico ?? false);
        const { comprimento, espessura } = eixos(e);
        const pedacos = diagramarPreco(e.el, e.texto, pt(comprimento), pt(espessura), f.medir);
        this.tracos(pagina, e, e.el, f, pedacos.map((p) => ({ texto: p.texto, u: p.u, v: p.v, tamanho: p.tamanhoPt, largura: f.medir(p.texto, p.tamanhoPt) })));
        return;
      }
      case 'codigo_barras': {
        const c = codigoValido(e, this.avisos);
        if (!c) return;
        const opcoes = {
          bcid: BCID[e.el.simbologia],
          text: c.completo,
          scale: 3,
          height: 10,
          includetext: e.el.mostrarTexto,
          textxalign: 'center' as const,
          rotate: GIRO_BWIP[e.el.rotacao],
        };
        const img = await this.imagemCodigo(JSON.stringify(opcoes), opcoes);
        pagina.drawImage(img, { ...caixa, opacity: opacidade });
        return;
      }
      case 'qrcode': {
        if (!e.texto) return;
        const opcoes = { bcid: 'qrcode', text: e.texto, scale: 4, eclevel: 'M', rotate: GIRO_BWIP[e.el.rotacao] };
        const img = await this.imagemCodigo(JSON.stringify(opcoes), opcoes);
        const lado = Math.min(caixa.width, caixa.height);
        pagina.drawImage(img, { x: caixa.x, y: caixa.y + caixa.height - lado, width: lado, height: lado, opacity: opacidade });
        return;
      }
      case 'retangulo':
      case 'elipse':
      case 'estrela': {
        const el = e.el;
        const t = el.espessuraMm > 0 ? mmPt(el.espessuraMm) : 0;
        const estilo = {
          color: el.preenchido ? cor(el.corPreenchimento) : undefined,
          borderColor: t > 0 ? cor(el.corBorda) : undefined,
          borderWidth: t,
          borderDashArray: el.tracejado && t > 0 ? tracejado(t) : undefined,
          opacity: opacidade,
          borderOpacity: opacidade,
        };
        // A borda fica por dentro da caixa (como no editor).
        const w = Math.max(0.1, caixa.width - t);
        const h = Math.max(0.1, caixa.height - t);
        if (el.tipo === 'elipse') {
          pagina.drawEllipse({ x: caixa.x + caixa.width / 2, y: caixa.y + caixa.height / 2, xScale: w / 2, yScale: h / 2, ...estilo });
        } else if (el.tipo === 'estrela') {
          const pontos = pontosEstrela(w, h, el.pontas, el.raioInterno);
          const caminho = `M ${pontos.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`;
          pagina.drawSvgPath(caminho, { x: caixa.x + t / 2, y: caixa.y + caixa.height - t / 2, ...estilo });
        } else if (el.raioMm) {
          pagina.drawSvgPath(caminhoArredondado(w, h, mmPt(el.raioMm)), { x: caixa.x + t / 2, y: caixa.y + caixa.height - t / 2, ...estilo });
        } else {
          pagina.drawRectangle({ x: caixa.x + t / 2, y: caixa.y + t / 2, width: w, height: h, ...estilo });
        }
        return;
      }
      case 'linha': {
        const espessura = mmPt(e.el.espessuraMm);
        const horizontal = e.largura >= e.altura;
        const topo = caixa.y + caixa.height;
        const [inicio, fim] = horizontal
          ? [{ x: caixa.x, y: topo - espessura / 2 }, { x: caixa.x + caixa.width, y: topo - espessura / 2 }]
          : [{ x: caixa.x + espessura / 2, y: topo }, { x: caixa.x + espessura / 2, y: caixa.y }];
        pagina.drawLine({
          start: inicio,
          end: fim,
          thickness: espessura,
          color: cor(e.el.cor),
          dashArray: e.el.tracejado ? tracejado(espessura) : undefined,
          opacity: opacidade,
        });
        return;
      }
      case 'imagem': {
        const el = e.el;
        const chave = `imagem:${el.id}`;
        let img = this.imagens.get(chave);
        if (!img) {
          if (el.original) {
            const [, tipo, dados] = el.original.match(/^data:image\/(png|jpeg);base64,(.*)$/) ?? [];
            const bytes = Buffer.from(dados ?? '', 'base64');
            img = tipo === 'jpeg' ? await this.doc.embedJpg(bytes) : await this.doc.embedPng(bytes);
          } else {
            img = await this.doc.embedPng(pngCinza(cinzaDoElemento(el)));
          }
          this.imagens.set(chave, img);
        }
        // drawImage gira em torno do canto inferior esquerdo (anti-horário): ajusta a âncora para cair na caixa.
        const { x, y, width: W, height: Hc } = caixa;
        const deitado = el.rotacao === 90 || el.rotacao === 270;
        const [w, h] = deitado ? [Hc, W] : [W, Hc];
        const ancoras: Record<Rotacao, { x: number; y: number }> = {
          0: { x, y },
          90: { x, y: y + Hc },
          180: { x: x + W, y: y + Hc },
          270: { x: x + W, y },
        };
        pagina.drawImage(img, { ...ancoras[el.rotacao], width: w, height: h, rotate: degrees(-el.rotacao), opacity: opacidade });
      }
    }
  }
}

/** PDF vetorial: uma página por fileira (rolo) ou por folha, no tamanho exato do papel. */
export async function gerarPdf(layout: LayoutEtiqueta, registros: Registro[], hoje: string, indiceInicial = 0): Promise<SaidaEtiquetas> {
  const avisos = new Avisos();
  const doc = await PDFDocument.create();
  doc.setTitle('Etiquetas');
  doc.setProducer('Sistema de Etiquetas');
  const desenho = new DesenhoPdf(doc, new FontesPdf(doc), avisos);

  const pag = paginar(layout);
  const porPagina = emPaginas(registros, pag.porPagina).map((r) => r.length);
  const paginas = posicionar(layout, registros, { dpi: DPI, hoje, indiceInicial });
  for (const [k, p] of paginas.entries()) {
    const pagina = doc.addPage([pt(p.larguraPontos), pt(p.alturaPontos)]);
    if (layout.corFundo) {
      for (let i = 0; i < porPagina[k]; i++) {
        const o = pag.origem(i);
        const altura = mmPt(layout.alturaMm);
        pagina.drawRectangle({ x: mmPt(o.x), y: pagina.getHeight() - mmPt(o.y) - altura, width: mmPt(layout.larguraMm), height: altura, color: cor(layout.corFundo) });
      }
    }
    for (const e of p.elementos) await desenho.elemento(pagina, e);
  }
  const bytes = await doc.save();
  return {
    linguagem: 'PDF',
    mime: 'application/pdf',
    codificacao: 'base64',
    conteudo: Buffer.from(bytes).toString('base64'),
    avisos: avisos.lista(),
  };
}
