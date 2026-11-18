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

/** Comprovante de um pagamento registrado: quem pagou, a quem, quando, as chamadas e o total. */
export async function pagamentoPdf(
  p: { pagoEm: string; totalCentavos: number; observacao: string; criadoEm: string; criadoPorNome: string | null },
  empresa: string,
  entregador: { nome: string; chavePix: string },
  linhas: { numero: number; tipo: keyof typeof ROTULO_TIPO_CHAMADA; concluidaEm: string; destino: string; valorCentavos: number; extraCentavos: number; cancelada: boolean }[],
  fuso: string,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Pagamento Flow Entregas - ${limpo(entregador.nome)}`);
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  let pagina = pdf.addPage(A4);
  let y = A4[1] - MARGEM;
  const escrever = (texto: string, x: number, tamanho: number, fonte: PDFFont = normal, cor = rgb(0, 0, 0)) => pagina.drawText(limpo(texto), { x, y, size: tamanho, font: fonte, color: cor });

  escrever('Comprovante de pagamento - Flow Entregas', MARGEM, 16, negrito);
  y -= 24;
  for (const [rotulo, valor] of [
    ['Empresa', empresa],
    ['Entregador', entregador.nome],
    ['Chave Pix', entregador.chavePix],
    ['Pago em', data(p.pagoEm)],
    ['Registrado por', `${p.criadoPorNome ?? '-'} em ${new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, dateStyle: 'short', timeStyle: 'short' }).format(new Date(p.criadoEm))}`],
    ...(p.observacao ? [['Observação', p.observacao]] : []),
  ]) {
    escrever(rotulo, MARGEM, 10, normal, CINZA);
    escrever(valor, MARGEM + 110, 10);
    y -= 15;
  }
  y -= 6;
  escrever(`Total: ${formatarCentavos(p.totalCentavos)} (${linhas.length} chamada${linhas.length === 1 ? '' : 's'})`, MARGEM, 13, negrito);
  y -= 24;
  const colunas = [MARGEM, MARGEM + 40, MARGEM + 110, MARGEM + 190, MARGEM + 430];
  const cabecalho = () => {
    ['Nº', 'Data', 'Serviço', 'Destino', 'Valor'].forEach((t, i) => pagina.drawText(t, { x: colunas[i], y, size: 9, font: negrito }));
    y -= 4;
    pagina.drawLine({ start: { x: MARGEM, y }, end: { x: A4[0] - MARGEM, y }, thickness: 0.5, color: CINZA });
    y -= 12;
  };
  cabecalho();
  for (const l of linhas) {
    if (y < MARGEM + 20) {
      pagina = pdf.addPage(A4);
      y = A4[1] - MARGEM;
      cabecalho();
    }
    const celulas = [String(l.numero), data(diaNoFuso(new Date(l.concluidaEm), fuso)), l.cancelada ? 'Taxa de cancelamento' : ROTULO_TIPO_CHAMADA[l.tipo], l.destino.slice(0, 44), formatarCentavos(l.valorCentavos + l.extraCentavos)];
    celulas.forEach((t, i) => escrever(t, colunas[i], 9));
    y -= 13;
  }
  pagina.drawText(limpo('O Flow só registra: o pagamento foi feito pela empresa, fora do sistema.'), { x: MARGEM, y: MARGEM - 14, size: 8, font: normal, color: CINZA });
  return pdf.save();
}
