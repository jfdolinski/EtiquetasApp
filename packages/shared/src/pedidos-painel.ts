/**
 * O lado da loja nos pedidos: situações, propostas de alteração (que o cliente aceita ou recusa no
 * link de acompanhamento), conversa pelo WhatsApp e a folha de lançamento na impressora térmica.
 */
import { dadosCodigoBarras } from './etiquetas/valores';
import {
  formatarCelular,
  formatarCentavos,
  MAX_QUANTIDADE_ITEM,
  LIMITES_PEDIDOS,
  ROTULO_MODALIDADE,
  ROTULO_PAGAMENTO,
  subtotalDe,
  textoEndereco,
  textoFaixa,
  totaisDoPedido,
  unidadesDe,
  type EnderecoPedido,
  type FaixaAgendamento,
  type FormaPagamento,
  type ItemConferido,
  type ModalidadeEntrega,
  type SituacaoPedido,
  type TotaisPedido,
} from './pedidos';

// Situação -----------------------------------------------------------------------------------

/** O caminho normal; cancelar vale de qualquer situação que ainda não terminou. */
export const PROXIMA_SITUACAO: Partial<Record<SituacaoPedido, SituacaoPedido>> = { NOVO: 'EM_SEPARACAO', EM_SEPARACAO: 'PRONTO', PRONTO: 'CONCLUIDO' };

export const situacaoFinal = (s: SituacaoPedido) => s === 'CONCLUIDO' || s === 'CANCELADO';

/** O cliente desiste enquanto a loja ainda não despachou (recebido ou em separação). */
export const clientePodeCancelar = (s: SituacaoPedido) => s === 'NOVO' || s === 'EM_SEPARACAO';
/** Depois de sair para entrega (ou ficar pronto para retirar), o cliente confirma que recebeu. */
export const clientePodeConfirmar = (s: SituacaoPedido) => s === 'PRONTO';

export function podeMudarSituacao(de: SituacaoPedido, para: SituacaoPedido): boolean {
  if (situacaoFinal(de)) return false;
  return para === 'CANCELADO' || PROXIMA_SITUACAO[de] === para;
}

/** O texto do botão que leva à próxima situação. */
export function rotuloAvancar(de: SituacaoPedido, modalidade: ModalidadeEntrega): string | null {
  switch (PROXIMA_SITUACAO[de]) {
    case 'EM_SEPARACAO':
      return 'Aceitar pedido';
    case 'PRONTO':
      return modalidade === 'RETIRADA' ? 'Avisar que está pronto' : 'Saiu para entrega';
    case 'CONCLUIDO':
      return modalidade === 'RETIRADA' ? 'Cliente retirou' : 'Entregue';
    default:
      return null;
  }
}

export const LIMITE_MOTIVO_CANCELAMENTO = 300;

// Proposta de alteração ----------------------------------------------------------------------

/** O que a loja propõe. Só mexe no que já está no pedido: produto novo, o cliente pede de novo. */
export interface PropostaPedido {
  /** Quantidade nova de cada produto do pedido; 0 tira. */
  itens: { codigo: string; quantidade: number }[];
  modalidade: ModalidadeEntrega;
  taxaCentavos: number;
  descontoCentavos: number;
  agendamento: FaixaAgendamento | null;
  /** O porquê, para o cliente: "acabou o feijão de 1 kg". */
  mensagem: string;
}

/** O pedido como está, no que a proposta pode mudar. */
export interface EstadoPedido {
  itens: ItemConferido[];
  modalidade: ModalidadeEntrega;
  taxaCentavos: number;
  descontoCentavos: number;
  agendamento: FaixaAgendamento | null;
  temEndereco: boolean;
  trocoParaCentavos: number | null;
}

export const LIMITE_MENSAGEM_PROPOSTA = 300;

/** Os itens com as quantidades novas, sem os retirados, na ordem do pedido. */
export function itensDaProposta(itens: ItemConferido[], p: Pick<PropostaPedido, 'itens'>): ItemConferido[] {
  const novas = new Map(p.itens.map((i) => [i.codigo, i.quantidade]));
  return itens.map((i) => ({ ...i, quantidade: novas.get(i.codigo) ?? i.quantidade })).filter((i) => i.quantidade > 0);
}

export function totaisDaProposta(atual: EstadoPedido, p: PropostaPedido): TotaisPedido {
  return totaisDoPedido(itensDaProposta(atual.itens, p), p.taxaCentavos, atual.trocoParaCentavos, p.descontoCentavos);
}

const mesmaFaixa = (a: FaixaAgendamento | null, b: FaixaAgendamento | null) => (!a && !b) || (!!a && !!b && a.data === b.data && a.inicio === b.inicio && a.fim === b.fim);

/** `faixas`: as que o cliente poderia escolher agora; a que o pedido já tem continua valendo. */
export function problemaNaProposta(atual: EstadoPedido, p: PropostaPedido, faixas: FaixaAgendamento[]): string | null {
  const codigos = new Set(atual.itens.map((i) => i.codigo));
  if (!Array.isArray(p.itens) || p.itens.some((i) => !codigos.has(i.codigo))) return 'Só dá para mudar os produtos que já estão no pedido.';
  if (p.itens.some((i) => !Number.isInteger(i.quantidade) || i.quantidade < 0 || i.quantidade > MAX_QUANTIDADE_ITEM)) return 'Quantidade inválida.';
  const itens = itensDaProposta(atual.itens, p);
  if (itens.length === 0) return 'Sobrou nenhum produto: para isso, cancele o pedido.';
  if (!ROTULO_MODALIDADE[p.modalidade]) return 'Forma de entrega inválida.';
  if (p.modalidade !== 'RETIRADA' && !atual.temEndereco) return 'O cliente escolheu retirar e não informou endereço: não dá para mudar para entrega.';
  if (p.modalidade === 'AGENDADA') {
    if (!p.agendamento) return 'Escolha o dia e o horário da entrega.';
    if (!mesmaFaixa(p.agendamento, atual.agendamento) && !faixas.some((f) => mesmaFaixa(f, p.agendamento))) return 'Este horário não está disponível.';
  }
  const valido = (v: number) => Number.isInteger(v) && v >= 0 && v <= LIMITES_PEDIDOS.valorMaximoCentavos;
  if (!valido(p.taxaCentavos)) return 'Taxa de entrega inválida.';
  if (!valido(p.descontoCentavos)) return 'Desconto inválido.';
  if (p.descontoCentavos > subtotalDe(itens) + p.taxaCentavos) return 'O desconto não pode passar do total.';
  if ((p.mensagem ?? '').length > LIMITE_MENSAGEM_PROPOSTA) return `A mensagem pode ter até ${LIMITE_MENSAGEM_PROPOSTA} caracteres.`;
  if (diferencasDaPropostaPedido(atual, p).length === 0) return 'A proposta não muda nada no pedido.';
  return null;
}

/** O que muda, em frases para o cliente e para a loja. */
export function diferencasDaPropostaPedido(atual: EstadoPedido, p: PropostaPedido): string[] {
  const linhas: string[] = [];
  const novas = new Map(p.itens.map((i) => [i.codigo, i.quantidade]));
  for (const i of atual.itens) {
    const q = novas.get(i.codigo);
    if (q === undefined || q === i.quantidade) continue;
    linhas.push(q === 0 ? `${i.nome}: retirado do pedido` : `${i.nome}: de ${i.quantidade} para ${q}`);
  }
  if (p.modalidade !== atual.modalidade) linhas.push(`Entrega: de ${ROTULO_MODALIDADE[atual.modalidade].titulo} para ${ROTULO_MODALIDADE[p.modalidade].titulo}`);
  if (p.modalidade === 'AGENDADA' && !mesmaFaixa(p.agendamento, atual.agendamento) && p.agendamento) linhas.push(`Horário: ${textoFaixa(p.agendamento, '')}`);
  if (p.taxaCentavos !== atual.taxaCentavos) linhas.push(`Taxa de entrega: de ${formatarCentavos(atual.taxaCentavos)} para ${formatarCentavos(p.taxaCentavos)}`);
  if (p.descontoCentavos !== atual.descontoCentavos) linhas.push(p.descontoCentavos ? `Desconto: ${formatarCentavos(p.descontoCentavos)}` : 'Sem desconto');
  return linhas;
}

/** O que o cliente vê no acompanhamento enquanto a proposta espera. */
export interface PropostaPublica {
  /** Identifica a versão: responder a uma proposta trocada no meio do caminho é recusado. */
  versao: string;
  mensagem: string;
  diferencas: string[];
  itens: ItemConferido[];
  modalidade: ModalidadeEntrega;
  agendamento: FaixaAgendamento | null;
  totais: TotaisPedido;
}

// Painel -------------------------------------------------------------------------------------

export interface EventoPedido {
  em: string;
  texto: string;
  /** Nome de quem fez, na loja; nulo quando foi o cliente. */
  por: string | null;
}

export interface PedidoResumo {
  id: string;
  numero: number;
  situacao: SituacaoPedido;
  criadoEm: string;
  clienteNome: string;
  modalidade: ModalidadeEntrega;
  agendamento: FaixaAgendamento | null;
  totalCentavos: number;
  unidades: number;
  /** Uma proposta da loja espera a resposta do cliente. */
  aguardandoCliente: boolean;
}

export interface PedidoCompleto extends PedidoResumo {
  /** Nome da loja, para a mensagem do WhatsApp. */
  empresa: string;
  clienteTelefone: string;
  endereco: EnderecoPedido | null;
  pagamento: FormaPagamento;
  trocoParaCentavos: number | null;
  observacao: string;
  itens: ItemConferido[];
  totais: TotaisPedido;
  /** O link de acompanhamento, para mandar ao cliente. */
  codigoAcompanhamento: string;
  aceitoPorNome: string | null;
  proposta: (PropostaPedido & { versao: string; autorNome: string | null; diferencas: string[]; totais: TotaisPedido }) | null;
  /** A última resposta do cliente a uma proposta. */
  respostaProposta: { aceita: boolean; em: string } | null;
  motivoCancelamento: string | null;
  historico: EventoPedido[];
  /** As faixas de agora, para propor outro horário. */
  faixas: FaixaAgendamento[];
}

export interface FiltroPedidos {
  situacao?: SituacaoPedido | 'ABERTOS';
  de?: string;
  ate?: string;
  busca?: string;
}

// WhatsApp -----------------------------------------------------------------------------------

/** Abre a conversa com o cliente, com a mensagem já escrita. Só o telefone e o texto vão no link. */
export function linkWhatsApp(telefone: string, mensagem: string): string {
  return `https://wa.me/55${telefone.replace(/\D/g, '')}?text=${encodeURIComponent(mensagem)}`;
}

export function mensagemWhatsApp(tipo: 'contato' | 'proposta', p: { numero: number; clienteNome: string }, empresa: string, linkAcompanhamento: string): string {
  const primeiro = p.clienteNome.trim().split(/\s+/)[0];
  if (tipo === 'proposta') return `Olá, ${primeiro}! Aqui é da ${empresa}. Precisamos mudar uma coisa no seu pedido nº ${p.numero}. Confira e confirme por aqui: ${linkAcompanhamento}`;
  return `Olá, ${primeiro}! Aqui é da ${empresa}, sobre o seu pedido nº ${p.numero}. Acompanhe por aqui: ${linkAcompanhamento}`;
}

// Folha de lançamento ------------------------------------------------------------------------

export type SimbologiaFolha = 'EAN13' | 'EAN8' | 'CODE128';

export type BlocoFolha =
  | { tipo: 'texto'; texto: string; negrito?: boolean; grande?: boolean; centro?: boolean }
  | { tipo: 'separador' }
  | { tipo: 'titulo'; texto: string }
  | { tipo: 'barras'; simbologia: SimbologiaFolha; dados: string; legenda: string };

export interface DadosFolha {
  empresa: string;
  numero: number;
  /** Já no fuso da loja: "10/11/2026 14:32". */
  quando: string;
  clienteNome: string;
  clienteTelefone: string;
  modalidade: ModalidadeEntrega;
  agendamento: FaixaAgendamento | null;
  endereco: EnderecoPedido | null;
  pagamento: FormaPagamento;
  trocoParaCentavos: number | null;
  observacao: string;
  atendente: { codigo: string; nome: string };
  itens: ItemConferido[];
  totais: TotaisPedido;
}

/** 48 colunas: fonte A num papel de 80 mm. */
export const COLUNAS_FOLHA = 48;

/**
 * O código do produto como a embalagem: EAN quando é EAN de verdade (dígito conferido), senão Code 128.
 * Nulo quando nem Code 128 aceita (acento, por exemplo): o produto sai só em texto, para digitar.
 */
export function codigoDaFolha(codigo: string): { simbologia: SimbologiaFolha; dados: string } | null {
  const v = codigo.trim();
  if (/^\d{13}$/.test(v) && !('erro' in dadosCodigoBarras('EAN13', v))) return { simbologia: 'EAN13', dados: v };
  if (/^\d{8}$/.test(v) && !('erro' in dadosCodigoBarras('EAN8', v))) return { simbologia: 'EAN8', dados: v };
  return 'erro' in dadosCodigoBarras('CODE128', v) ? null : { simbologia: 'CODE128', dados: v };
}

/** Nome cortado com reticências e o resto alinhado à direita, numa linha só. */
export function linhaDoProduto(nome: string, preco: string, contagem: string, colunas = COLUNAS_FOLHA): string {
  const direita = `${preco}  ${contagem}`;
  const espaco = colunas - 4 - direita.length - 1;
  const n = nome.length > espaco ? `${nome.slice(0, Math.max(1, espaco - 1))}…` : nome;
  return `[ ] ${n}${' '.repeat(Math.max(1, colunas - 4 - n.length - direita.length))}${direita}`;
}

/**
 * A folha, na ordem em que o ERP pede: atendente, telefone e um código por unidade de cada produto.
 * Os títulos separam as partes: o cabeçalho é só texto, para o leitor não pegar nada por engano.
 */
export function blocosDaFolha(d: DadosFolha): { blocos: BlocoFolha[]; avisos: string[] } {
  const b: BlocoFolha[] = [];
  const avisos: string[] = [];
  b.push({ tipo: 'texto', texto: d.empresa, negrito: true, centro: true });
  b.push({ tipo: 'texto', texto: `PEDIDO ${d.numero}`, negrito: true, grande: true, centro: true });
  b.push({ tipo: 'texto', texto: d.quando, centro: true });
  b.push({ tipo: 'separador' });
  b.push({ tipo: 'texto', texto: `${d.clienteNome} · ${formatarCelular(d.clienteTelefone)}` });
  b.push({ tipo: 'texto', texto: `${ROTULO_MODALIDADE[d.modalidade].titulo}${d.agendamento ? `: ${textoFaixa(d.agendamento, '')}` : ''}` });
  if (d.endereco) b.push({ tipo: 'texto', texto: textoEndereco(d.endereco) });
  const troco = d.pagamento === 'DINHEIRO' && d.trocoParaCentavos !== null ? ` · troco para ${formatarCentavos(d.trocoParaCentavos)}${d.totais.trocoCentavos !== null ? ` = ${formatarCentavos(d.totais.trocoCentavos)}` : ' (não cobre o total)'}` : '';
  b.push({ tipo: 'texto', texto: `Pagamento: ${ROTULO_PAGAMENTO[d.pagamento]}${troco}` });
  if (d.observacao) b.push({ tipo: 'texto', texto: `Obs.: ${d.observacao}` });

  b.push({ tipo: 'separador' });
  b.push({ tipo: 'titulo', texto: '1. CÓDIGO DO ATENDENTE' });
  const atendente = codigoDaFolha(d.atendente.codigo);
  if (atendente) b.push({ tipo: 'barras', simbologia: 'CODE128', dados: atendente.dados, legenda: `${d.atendente.codigo} – ${d.atendente.nome}` });
  else {
    b.push({ tipo: 'texto', texto: `${d.atendente.codigo} – ${d.atendente.nome}` });
    avisos.push('O código do atendente tem caracteres que o código de barras não aceita: saiu só em texto.');
  }

  b.push({ tipo: 'separador' });
  b.push({ tipo: 'titulo', texto: '2. TELEFONE DO CLIENTE' });
  b.push({ tipo: 'barras', simbologia: 'CODE128', dados: d.clienteTelefone, legenda: formatarCelular(d.clienteTelefone) });

  b.push({ tipo: 'separador' });
  b.push({ tipo: 'titulo', texto: '3. AGORA PASSE OS PRODUTOS' });
  for (const i of d.itens) {
    const codigo = i.codigoBarras || i.codigo;
    const barras = codigoDaFolha(codigo);
    if (!barras) avisos.push(`${i.nome}: o código “${codigo}” não vira código de barras; saiu só em texto.`);
    for (let n = 1; n <= i.quantidade; n++) {
      const legenda = linhaDoProduto(i.nome, formatarCentavos(i.precoCentavos), `${n}/${i.quantidade}`);
      if (barras) b.push({ tipo: 'barras', simbologia: barras.simbologia, dados: barras.dados, legenda });
      else b.push({ tipo: 'texto', texto: `${legenda}  cód. ${codigo}` });
    }
  }

  b.push({ tipo: 'separador' });
  b.push({ tipo: 'texto', texto: `Total de unidades: ${unidadesDe(d.itens)}` });
  b.push({ tipo: 'texto', texto: `Produtos: ${formatarCentavos(d.totais.subtotalCentavos)} · Entrega: ${formatarCentavos(d.totais.taxaCentavos)}` });
  if (d.totais.descontoCentavos) b.push({ tipo: 'texto', texto: `Desconto: -${formatarCentavos(d.totais.descontoCentavos)}` });
  b.push({ tipo: 'texto', texto: `TOTAL: ${formatarCentavos(d.totais.totalCentavos)}`, negrito: true, grande: true });
  return { blocos: b, avisos };
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
/** 10 mm a 203 dpi: o leitor acerta sem precisar mirar. */
const ALTURA_BARRAS = 80;

/** Os que a página WPC1252 tem fora do Latin-1: cada um ocupa uma coluna, como na tela. */
const CP1252: Record<string, number> = { '…': 0x85, '–': 0x96, '—': 0x97, '“': 0x93, '”': 0x94, '‘': 0x91, '’': 0x92 };

/** Bytes na página de código WPC1252 (ESC t 16); o que ela não tem vira '?'. */
function emLatin1(texto: string): number[] {
  const bytes: number[] = [];
  for (const ch of texto) {
    const c = ch.codePointAt(0)!;
    bytes.push(c < 256 ? c : (CP1252[ch] ?? 0x3f));
  }
  return bytes;
}

/** Quebra o texto em linhas da largura do papel, sem cortar palavra quando dá. */
export function quebrarLinhasFolha(texto: string, colunas = COLUNAS_FOLHA): string[] {
  const linhas: string[] = [];
  let atual = '';
  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    if (!atual) atual = palavra;
    else if (atual.length + 1 + palavra.length <= colunas) atual += ` ${palavra}`;
    else {
      linhas.push(atual);
      atual = palavra;
    }
    while (atual.length > colunas) {
      linhas.push(atual.slice(0, colunas));
      atual = atual.slice(colunas);
    }
  }
  if (atual) linhas.push(atual);
  return linhas.length ? linhas : [''];
}

/**
 * ESC/POS em modo padrão (linha a linha), que toda térmica de cupom entende. Os códigos de barras usam
 * o comando da própria impressora (GS k), não imagem, e saem centralizados, um por linha.
 */
export function folhaEscPos(blocos: BlocoFolha[]): Uint8Array {
  const b: number[] = [ESC, 0x40, ESC, 0x74, 16];
  for (const x of blocos) {
    if (x.tipo === 'separador') {
      b.push(ESC, 0x61, 0, ...emLatin1('-'.repeat(COLUNAS_FOLHA)), LF);
    } else if (x.tipo === 'titulo') {
      b.push(ESC, 0x61, 0, ESC, 0x45, 1, ...emLatin1(x.texto), ESC, 0x45, 0, LF);
    } else if (x.tipo === 'texto') {
      const colunas = x.grande ? COLUNAS_FOLHA / 2 : COLUNAS_FOLHA;
      b.push(ESC, 0x61, x.centro ? 1 : 0, ESC, 0x45, x.negrito ? 1 : 0, GS, 0x21, x.grande ? 0x11 : 0);
      for (const l of quebrarLinhasFolha(x.texto, colunas)) b.push(...emLatin1(l), LF);
      b.push(GS, 0x21, 0, ESC, 0x45, 0);
    } else {
      // GS h altura, GS w largura do módulo, GS H sem o texto embaixo: a legenda é nossa.
      b.push(LF, ESC, 0x61, 1, GS, 0x68, ALTURA_BARRAS, GS, 0x77, 2, GS, 0x48, 0);
      const m = { EAN13: 67, EAN8: 68, CODE128: 73 }[x.simbologia];
      const dados = x.simbologia === 'CODE128' ? `{B${x.dados}` : x.simbologia === 'EAN13' ? x.dados.slice(0, 12) : x.dados.slice(0, 7);
      b.push(GS, 0x6b, m, dados.length, ...emLatin1(dados));
      // A legenda já vem do tamanho da linha, com os espaços que alinham o preço: vai como está.
      b.push(ESC, 0x61, 0, ...emLatin1(x.legenda.slice(0, COLUNAS_FOLHA)), LF);
    }
  }
  b.push(LF, LF, LF, LF, GS, 0x56, 66, 0);
  return Uint8Array.from(b);
}
