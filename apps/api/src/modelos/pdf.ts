import {
  Avisos,
  ancora,
  codigoValido,
  deslocamentoAlinhamento,
  eixos,
  posicionar,
  semAcentos,
  type ElementoPosicionado,
  type LayoutEtiqueta,
  type Registro,
  type Rotacao,
  type SaidaEtiquetas,
} from '@etiquetas/shared';
import * as bwipjs from 'bwip-js';
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';

/** Resolução interna: 720 "pontos" por polegada = décimos de ponto do PDF. */
const DPI = 720;
const pt = (v: number) => v / 10;

const BCID = { EAN13: 'ean13', EAN8: 'ean8', CODE128: 'code128', CODE39: 'code39' } as const;
const GIRO_BWIP: Record<Rotacao, 'N' | 'R' | 'I' | 'L'> = { 0: 'N', 90: 'R', 180: 'I', 270: 'L' };

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

/** Quebra o texto em linhas que caibam na largura (por palavra; palavra longa é cortada). */
function quebrar(texto: string, fonte: PDFFont, tamanho: number, largura: number): string[] {
  const linhas: string[] = [];
  let atual = '';
  for (const palavra of texto.split(/\s+/)) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (fonte.widthOfTextAtSize(tentativa, tamanho) <= largura || !atual) atual = tentativa;
    else {
      linhas.push(atual);
      atual = palavra;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

/** Helvetica padrão usa WinAnsi; o que não couber vira o equivalente sem acento. */
function codificavel(texto: string, fonte: PDFFont): string {
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

class DesenhoPdf {
  private readonly imagens = new Map<string, PDFImage>();

  constructor(
    private readonly doc: PDFDocument,
    private readonly fontes: { normal: PDFFont; negrito: PDFFont },
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

  async elemento(pagina: PDFPage, e: ElementoPosicionado) {
    const H = pagina.getHeight();
    const caixa = { x: pt(e.x), y: H - pt(e.y) - pt(e.altura), width: pt(e.largura), height: pt(e.altura) };

    switch (e.el.tipo) {
      case 'texto': {
        if (!e.texto) return;
        const fonte = e.el.negrito ? this.fontes.negrito : this.fontes.normal;
        const tamanho = e.el.tamanhoPt;
        const { comprimento, espessura } = eixos(e);
        const entrelinha = tamanho * 1.15;
        const maxLinhas = Math.max(1, Math.floor(pt(espessura) / entrelinha + 0.15));
        const linhas = quebrar(codificavel(e.texto, fonte), fonte, tamanho, pt(comprimento)).slice(0, maxLinhas);
        const a = ancora(e);
        linhas.forEach((linha, i) => {
          const largura = fonte.widthOfTextAtSize(linha, tamanho);
          const alinhamento = e.el.tipo === 'texto' ? e.el.alinhamento : 'esquerda';
          // Alinhamento calculado em pontos do PDF; u e v ficam em décimos (unidade da página).
          const u = deslocamentoAlinhamento(alinhamento, pt(comprimento), largura) * 10;
          const v = (tamanho * 0.8 + i * entrelinha) * 10; // linha de base, em décimos de ponto
          const p = girar(a, u, v, e.el.rotacao);
          pagina.drawText(linha, { x: pt(p.x), y: H - pt(p.y), size: tamanho, font: fonte, rotate: degrees(-e.el.rotacao) });
        });
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
        pagina.drawImage(img, caixa);
        return;
      }
      case 'qrcode': {
        if (!e.texto) return;
        const opcoes = { bcid: 'qrcode', text: e.texto, scale: 4, eclevel: 'M', rotate: GIRO_BWIP[e.el.rotacao] };
        const img = await this.imagemCodigo(JSON.stringify(opcoes), opcoes);
        const lado = Math.min(caixa.width, caixa.height);
        pagina.drawImage(img, { x: caixa.x, y: caixa.y + caixa.height - lado, width: lado, height: lado });
        return;
      }
      case 'retangulo': {
        const espessura = (e.el.espessuraMm * 72) / 25.4;
        pagina.drawRectangle({
          ...caixa,
          color: e.el.preenchido ? rgb(0, 0, 0) : undefined,
          borderColor: rgb(0, 0, 0),
          borderWidth: e.el.preenchido ? 0 : espessura,
        });
        return;
      }
      case 'linha': {
        const espessura = (e.el.espessuraMm * 72) / 25.4;
        const horizontal = e.largura >= e.altura;
        pagina.drawRectangle({
          x: caixa.x,
          y: horizontal ? caixa.y + caixa.height - espessura : caixa.y,
          width: horizontal ? caixa.width : espessura,
          height: horizontal ? espessura : caixa.height,
          color: rgb(0, 0, 0),
        });
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
  const desenho = new DesenhoPdf(
    doc,
    { normal: await doc.embedFont(StandardFonts.Helvetica), negrito: await doc.embedFont(StandardFonts.HelveticaBold) },
    avisos,
  );

  for (const p of posicionar(layout, registros, { dpi: DPI, hoje, indiceInicial })) {
    const pagina = doc.addPage([pt(p.larguraPontos), pt(p.alturaPontos)]);
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
