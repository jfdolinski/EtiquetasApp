import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { diaNoFuso, formatarCentavos, ROTULO_PERIODO_EXTRATO, ROTULO_TIPO_CHAMADA, type ExtratoEntregador } from '@etiquetas/shared';

const A4: [number, number] = [595.28, 841.89];
const MARGEM = 40;
const CINZA = rgb(0.4, 0.45, 0.5);

/** Tira o que a fonte padrão do PDF (WinAnsi) não desenha, para o texto nunca quebrar a geração. */
const limpo = (t: string) => t.replace(/[^\x20-\x7E -ÿ]/g, '').trim();
const data = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

/** Comprovante do extrato do entregador (A4, texto pesquisável), com as linhas do período. */
export async function extratoPdf(e: ExtratoEntregador, entregador: { nome: string; chavePix: string }, geradoEm: Date, fuso: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Extrato Flow Entregas - ${limpo(entregador.nome)}`);
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  let pagina = pdf.addPage(A4);
  let y = A4[1] - MARGEM;
  const escrever = (p: PDFPage, texto: string, x: number, yy: number, tamanho: number, fonte: PDFFont = normal, cor = rgb(0, 0, 0)) => p.drawText(limpo(texto), { x, y: yy, size: tamanho, font: fonte, color: cor });

  escrever(pagina, 'Extrato - Flow Entregas', MARGEM, y, 18, negrito);
  y -= 24;
  escrever(pagina, `${entregador.nome} · Pix ${entregador.chavePix}`, MARGEM, y, 10);
  y -= 14;
  const quando = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, dateStyle: 'short', timeStyle: 'short' }).format(geradoEm);
  escrever(pagina, `Período: ${ROTULO_PERIODO_EXTRATO[e.periodo]} · gerado em ${quando}`, MARGEM, y, 10, normal, CINZA);
  y -= 26;
  for (const [rotulo, valor] of [
    ['Feito no período', e.periodoCentavos],
    ['Recebido no período', e.pagoCentavos],
    ['A receber (total)', e.aReceberCentavos],
  ] as const) {
    escrever(pagina, rotulo, MARGEM, y, 11);
    escrever(pagina, formatarCentavos(valor), MARGEM + 180, y, 11, negrito);
    y -= 16;
  }
  y -= 10;

  const colunas = [MARGEM, MARGEM + 62, MARGEM + 210, MARGEM + 250, MARGEM + 340, MARGEM + 410];
  const cabecalho = (p: PDFPage) => {
    ['Data', 'Empresa', 'Nº', 'Serviço', 'Valor', 'Situação'].forEach((t, i) => escrever(p, t, colunas[i], y, 9, negrito));
    y -= 4;
    p.drawLine({ start: { x: MARGEM, y }, end: { x: A4[0] - MARGEM, y }, thickness: 0.5, color: CINZA });
    y -= 12;
  };
  cabecalho(pagina);
  if (!e.linhas.length) escrever(pagina, 'Nenhuma entrega concluída no período.', MARGEM, y, 10, normal, CINZA);
  for (const l of e.linhas) {
    if (y < MARGEM + 20) {
      pagina = pdf.addPage(A4);
      y = A4[1] - MARGEM;
      cabecalho(pagina);
    }
    const valor = formatarCentavos(l.valorCentavos + l.extraCentavos) + (l.extraCentavos ? ' *' : '');
    const situacao = l.situacao === 'PAGO' ? `Pago ${l.pagoEm ? data(l.pagoEm) : ''}` : 'A receber';
    const celulas = [data(diaNoFuso(new Date(l.concluidaEm), fuso)), l.empresa.slice(0, 26), String(l.numero), ROTULO_TIPO_CHAMADA[l.tipo].slice(0, 16), valor, situacao + (l.contestacao && !l.contestacao.respondidaEm ? ' (contestada)' : '')];
    celulas.forEach((t, i) => escrever(pagina, t, colunas[i], y, 9));
    y -= 13;
  }
  if (e.linhas.some((l) => l.extraCentavos)) {
    y -= 6;
    escrever(pagina, '* inclui extra lançado pela empresa (espera, volta).', MARGEM, Math.max(y, MARGEM), 8, normal, CINZA);
  }
  escrever(pagina, 'O Flow registra os valores; cada empresa paga direto ao entregador.', MARGEM, MARGEM - 14, 8, normal, CINZA);
  return pdf.save();
}
