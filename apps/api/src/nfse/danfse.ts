import * as bwipjs from 'bwip-js';
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatarCentavos, formatarCnpj, ROTULO_REGIME_NFSE, type AmbienteNfse, type RegimeNfse, type ServicoNfse, type TomadorNfse } from '@etiquetas/shared';

/**
 * DANFSe (documento auxiliar da NFS-e) gerado pelo Flow. A API do DANFSe do ADN foi desligada em
 * produção (03/08/2026) e a NT 008 passou a geração aos emissores, no leiaute nacional v2.0: este PDF
 * segue os blocos dele (chave, QR Code da consulta pública, emitente, tomador, serviço, valores e as
 * marcas d'água de homologação e cancelamento). Não reproduz a arte oficial pixel a pixel.
 */
export interface DadosDanfse {
  ambiente: AmbienteNfse;
  chaveAcesso: string;
  numeroNfse: string | null;
  serie: string;
  numeroDps: number;
  emitidaEm: Date;
  competencia: string;
  cancelada: boolean;
  emitente: { razaoSocial: string; cnpj: string; inscricaoMunicipal: string | null; codigoMunicipio: string; regime: RegimeNfse; email: string | null };
  tomador: TomadorNfse | null;
  servico: ServicoNfse;
  valorCentavos: number;
  /** Do XML autorizado, quando a Sefin calculou; senão, a estimativa. */
  issCentavos: number;
  issRetido: boolean;
  xmlNfse: string | null;
}

/** Endereço da consulta pública da NFS-e pela chave (o QR Code leva até ele). */
export const URL_CONSULTA_PUBLICA = 'https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=';

const A4: [number, number] = [595.28, 841.89];
const M = 36;
const CINZA = rgb(0.42, 0.45, 0.5);
const limpo = (t: string) => t.replace(/[^\x20-\x7E -ÿ]/g, '').trim();
const dataBr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

/** Valor em centavos de um campo decimal do XML autorizado (ex.: <vISSQN>2.00</vISSQN>). */
export function centavosDoXml(xml: string | null, tag: string): number | null {
  const m = xml?.match(new RegExp(`<${tag}>(\\d+(?:\\.\\d{1,2})?)</${tag}>`));
  return m ? Math.round(Number(m[1]) * 100) : null;
}

function quebrar(texto: string, fonte: PDFFont, tamanho: number, largura: number): string[] {
  const linhas: string[] = [];
  for (const paragrafo of limpo(texto).split(/\n/)) {
    let atual = '';
    for (const palavra of paragrafo.split(/\s+/)) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (fonte.widthOfTextAtSize(tentativa, tamanho) > largura && atual) {
        linhas.push(atual);
        atual = palavra;
      } else atual = tentativa;
    }
    if (atual) linhas.push(atual);
  }
  return linhas;
}

export async function danfsePdf(d: DadosDanfse, fuso: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`DANFSe ${d.numeroNfse ?? d.chaveAcesso}`);
  pdf.setProducer('Flow');
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const p: PDFPage = pdf.addPage(A4);
  const W = A4[0] - 2 * M;
  let y = A4[1] - M;
  const t = (texto: string, x: number, yy: number, tam = 9, f: PDFFont = normal, cor = rgb(0, 0, 0)) => p.drawText(limpo(texto), { x, y: yy, size: tam, font: f, color: cor });
  const caixa = (topo: number, altura: number, titulo: string) => {
    p.drawRectangle({ x: M, y: topo - altura, width: W, height: altura, borderColor: CINZA, borderWidth: 0.7 });
    t(titulo.toUpperCase(), M + 6, topo - 11, 7, negrito, CINZA);
  };
  const campo = (rotulo: string, valor: string, x: number, yy: number, largura = 250) => {
    t(rotulo, x, yy, 6.5, normal, CINZA);
    const linhas = quebrar(valor || '-', normal, 9, largura);
    linhas.slice(0, 2).forEach((l, i) => t(l, x, yy - 11 - i * 11, 9));
  };

  // Cabeçalho com o QR Code da consulta pública.
  const qr = await pdf.embedPng(await (bwipjs.toBuffer({ bcid: 'qrcode', text: `${URL_CONSULTA_PUBLICA}${d.chaveAcesso}`, scale: 3 }) as unknown as Promise<Buffer>));
  p.drawImage(qr, { x: M + W - 84, y: y - 84, width: 84, height: 84 });
  t('DANFSe', M, y - 16, 18, negrito);
  t('Documento Auxiliar da Nota Fiscal de Serviço Eletrônica', M, y - 30, 9);
  t(`NFS-e nº ${d.numeroNfse ?? '-'}   ·   DPS série ${d.serie} nº ${d.numeroDps}`, M, y - 48, 10, negrito);
  const emissao = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, dateStyle: 'short', timeStyle: 'medium' }).format(d.emitidaEm);
  t(`Emitida em ${emissao}   ·   Competência ${dataBr(d.competencia)}`, M, y - 62, 9);
  t('Chave de acesso', M, y - 78, 6.5, normal, CINZA);
  t(d.chaveAcesso.replace(/(.{5})/g, '$1 ').trim(), M, y - 89, 8.5, negrito);
  y -= 104;

  caixa(y, 70, 'Emitente (prestador do serviço)');
  campo('Razão social', d.emitente.razaoSocial, M + 6, y - 24, 330);
  campo('CNPJ', formatarCnpj(d.emitente.cnpj), M + 360, y - 24, 160);
  campo('Inscrição municipal', d.emitente.inscricaoMunicipal ?? '-', M + 6, y - 50, 150);
  campo('Município (IBGE)', d.emitente.codigoMunicipio, M + 170, y - 50, 120);
  campo('Regime', ROTULO_REGIME_NFSE[d.emitente.regime], M + 300, y - 50, 220);
  y -= 78;

  caixa(y, 46, 'Tomador do serviço');
  const doc = d.tomador?.documento ?? '';
  campo('Nome', d.tomador?.nome || 'Tomador não identificado', M + 6, y - 24, 330);
  campo(doc.length === 11 ? 'CPF' : 'CNPJ', doc.length === 11 ? doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : doc ? formatarCnpj(doc) : '-', M + 360, y - 24, 160);
  y -= 54;

  const descricao = quebrar(d.servico.descricao, normal, 9, W - 12);
  const alturaServ = 46 + Math.min(descricao.length, 20) * 11;
  caixa(y, alturaServ, 'Serviço prestado');
  campo('Código de tributação nacional', d.servico.codigoTributacaoNacional, M + 6, y - 24, 160);
  campo('Código municipal', d.servico.codigoTributacaoMunicipal ?? '-', M + 180, y - 24, 100);
  campo('NBS', d.servico.codigoNbs ?? '-', M + 300, y - 24, 100);
  descricao.slice(0, 20).forEach((l, i) => t(l, M + 6, y - 58 - i * 11, 9));
  y -= alturaServ + 8;

  caixa(y, 46, 'Valores');
  const liquido = centavosDoXml(d.xmlNfse, 'vLiq') ?? d.valorCentavos - (d.issRetido ? d.issCentavos : 0);
  campo('Valor do serviço', formatarCentavos(d.valorCentavos), M + 6, y - 24, 120);
  campo(d.issRetido ? 'ISS retido pelo tomador' : 'ISS', d.issCentavos ? formatarCentavos(d.issCentavos) : 'Conforme o município', M + 140, y - 24, 150);
  campo('Valor líquido', formatarCentavos(liquido), M + 310, y - 24, 150);
  y -= 60;

  t('Confira a autenticidade pela chave de acesso no Portal Nacional da NFS-e (www.nfse.gov.br) ou pelo QR Code.', M, y, 7.5, normal, CINZA);
  t('Gerado pelo Flow a partir da NFS-e autorizada pela Sefin Nacional.', M, y - 11, 7.5, normal, CINZA);

  const marca = (texto: string, cor: ReturnType<typeof rgb>) => {
    const tam = 46;
    const largura = negrito.widthOfTextAtSize(texto, tam);
    p.drawText(texto, { x: A4[0] / 2 - (largura / 2) * Math.cos(Math.PI / 5), y: A4[1] / 2 - (largura / 2) * Math.sin(Math.PI / 5), size: tam, font: negrito, color: cor, opacity: 0.18, rotate: degrees(36) });
  };
  if (d.ambiente !== 'PRODUCAO') marca('NFS-e SEM VALIDADE JURÍDICA', rgb(0.5, 0.5, 0.5));
  if (d.cancelada) marca('CANCELADA', rgb(0.8, 0, 0));
  return pdf.save();
}
