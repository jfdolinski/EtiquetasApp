/**
 * Pedidos pelo link da empresa: o cliente final monta um carrinho com a cópia dos produtos da consulta
 * e envia; a loja acompanha no painel. Ver docs/PEDIDOS.md. Valores sempre em centavos (inteiros):
 * total, mínimo e troco não podem errar por arredondamento.
 */
import type { Registro } from './etiquetas/tipos';
import { somarDias, textoNaTela } from './etiquetas/valores';
import { numeroDe } from './avulsa';
import type { PropostaPublica } from './pedidos-painel';

// Entrega e pagamento ------------------------------------------------------------------------

export const MODALIDADES_ENTREGA = ['ENTREGA', 'AGENDADA', 'EXPRESSA', 'RETIRADA'] as const;
export type ModalidadeEntrega = (typeof MODALIDADES_ENTREGA)[number];

export const ROTULO_MODALIDADE: Record<ModalidadeEntrega, { titulo: string; ajuda: string }> = {
  ENTREGA: { titulo: 'Entrega', ajuda: 'No prazo normal da loja.' },
  AGENDADA: { titulo: 'Entrega agendada', ajuda: 'O cliente escolhe o dia e a faixa de horário. Vale também com a loja fechada.' },
  EXPRESSA: { titulo: 'Entrega expressa', ajuda: 'Só aparece com a loja aberta.' },
  RETIRADA: { titulo: 'Retirar no local', ajuda: 'Sem endereço do cliente: aparece o endereço da loja.' },
};

export interface ModalidadeConfig {
  ativa: boolean;
  precoCentavos: number;
}

export const FORMAS_PAGAMENTO = ['PIX', 'CARTAO', 'DINHEIRO'] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

export const ROTULO_PAGAMENTO: Record<FormaPagamento, string> = {
  PIX: 'Pix',
  CARTAO: 'Cartão na entrega',
  DINHEIRO: 'Dinheiro',
};

// Horário de funcionamento -------------------------------------------------------------------

/** HH:MM no fuso do sistema. */
export interface PeriodoHorario {
  inicio: string;
  fim: string;
}

/** Um item por dia da semana, de domingo (0) a sábado (6); até dois períodos por dia. Dia vazio = fechado. */
export type HorarioFuncionamento = PeriodoHorario[][];

export const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'] as const;
export const MAX_PERIODOS_POR_DIA = 2;

export const horarioVazio = (): HorarioFuncionamento => [[], [], [], [], [], [], []];

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutosDe = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function problemaNoHorario(h: unknown): string | null {
  if (!Array.isArray(h) || h.length !== 7) return 'Horário de funcionamento inválido.';
  for (const [d, periodos] of h.entries()) {
    if (!Array.isArray(periodos) || periodos.length > MAX_PERIODOS_POR_DIA) return `${DIAS_SEMANA[d]}: até ${MAX_PERIODOS_POR_DIA} períodos.`;
    let fimAnterior = -1;
    for (const p of periodos as PeriodoHorario[]) {
      if (!p || !HORA.test(p.inicio) || !HORA.test(p.fim)) return `${DIAS_SEMANA[d]}: use horas no formato 08:00.`;
      if (minutosDe(p.inicio) >= minutosDe(p.fim)) return `${DIAS_SEMANA[d]}: o fim precisa ser depois do início.`;
      if (minutosDe(p.inicio) < fimAnterior) return `${DIAS_SEMANA[d]}: os períodos não podem se sobrepor, e o primeiro vem antes.`;
      fimAnterior = minutosDe(p.fim);
    }
  }
  return null;
}

/** Aberta no dia da semana e na hora dados (já no fuso do sistema). O fim do período não conta como aberto. */
export function lojaAberta(h: HorarioFuncionamento, diaSemana: number, hora: string): boolean {
  const m = minutosDe(hora);
  return (h[diaSemana] ?? []).some((p) => m >= minutosDe(p.inicio) && m < minutosDe(p.fim));
}

/** A próxima abertura a partir de agora, em até uma semana. Nula se nunca abre. */
export function proximaAbertura(h: HorarioFuncionamento, diaSemana: number, hora: string): { diasAFrente: number; hora: string } | null {
  const agora = minutosDe(hora);
  for (let n = 0; n <= 7; n++) {
    const dia = (diaSemana + n) % 7;
    const p = (h[dia] ?? []).find((x) => n > 0 || minutosDe(x.inicio) > agora);
    if (p) return { diasAFrente: n, hora: p.inicio };
  }
  return null;
}

/** "hoje às 14h", "amanhã às 8h30", "segunda às 8h". */
export function textoProximaAbertura(h: HorarioFuncionamento, diaSemana: number, hora: string): string | null {
  const p = proximaAbertura(h, diaSemana, hora);
  if (!p) return null;
  const [hh, mm] = p.hora.split(':');
  const horaTexto = `${Number(hh)}h${mm === '00' ? '' : mm}`;
  const dia = p.diasAFrente === 0 ? 'hoje' : p.diasAFrente === 1 ? 'amanhã' : DIAS_SEMANA[(diaSemana + p.diasAFrente) % 7].toLowerCase();
  return `${dia} às ${horaTexto}`;
}

/** Fechada, só a agendada continua: o cliente marca para quando a loja estiver aberta. */
export function modalidadesPermitidas(modalidades: Record<ModalidadeEntrega, ModalidadeConfig>, aberta: boolean): ModalidadeEntrega[] {
  return MODALIDADES_ENTREGA.filter((m) => modalidades[m]?.ativa && (aberta || m === 'AGENDADA'));
}

// Configuração -------------------------------------------------------------------------------

export interface ColunasCatalogo {
  /** Identifica o produto no carrinho e no pedido. */
  colunaCodigo: string;
  colunaNome: string;
  colunaPreco: string;
  colunaPrecoDe: string | null;
  colunaUnidade: string | null;
  colunaCategoria: string | null;
  /** Com ela, só aparece produto com estoque, e a quantidade fica limitada a ele. */
  colunaEstoque: string | null;
  /** Para a foto do catálogo e para o código da folha de lançamento. Sem ela, vale o código. */
  colunaCodigoBarras: string | null;
}

export interface ConfigPedidos extends ColunasCatalogo {
  comFotos: boolean;
  /**
   * Nome e categoria vêm do catálogo, pelo código de barras, no lugar das colunas do ERP; produto
   * que o catálogo ainda não tem com nome e categoria não entra na loja. Preço e estoque seguem do ERP.
   */
  dadosDoCatalogo: boolean;
  /** Só os produtos contam (sem a entrega). Nulo: sem mínimo. */
  pedidoMinimoCentavos: number | null;
  modalidades: Record<ModalidadeEntrega, ModalidadeConfig>;
  /** Aparece no alto do catálogo, como "Pedidos até as 17h saem no mesmo dia". */
  mensagem: string;
  /** Para quem escolhe retirar. */
  enderecoRetirada: string;
  /** Só com a entrega agendada: até quantos dias à frente e o tamanho de cada faixa de horário. */
  agendamento: ConfigAgendamento;
  /** Térmica ESC/POS que recebe a folha de lançamento. Nula: a folha só aparece na tela. */
  impressoraFolhaId: string | null;
  /** Colunas a mais que o cliente vê ao abrir o produto, com o nome que ele lê. Só as escolhidas: o SQL pode ter custo. */
  camposDetalhe: CampoDetalhe[];
}

export interface CampoDetalhe {
  coluna: string;
  rotulo: string;
}

export const MAX_CAMPOS_DETALHE = 10;
const MAX_ROTULO_DETALHE = 40;
const MAX_VALOR_DETALHE = 300;

/** "data_validade" → "Data validade": o ponto de partida do nome, que a loja pode trocar. */
export const rotuloSugerido = (coluna: string) => {
  const t = coluna.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : coluna;
};

export interface ConfigAgendamento {
  dias: number;
  duracaoMinutos: number;
}

export const DURACOES_FAIXA = [30, 60, 120, 180, 240] as const;
export const AGENDAMENTO_PADRAO: ConfigAgendamento = { dias: 7, duracaoMinutos: 120 };

export const LIMITES_PEDIDOS = {
  mensagem: 300,
  enderecoRetirada: 300,
  /** R$ 100.000,00: acima disso é engano de digitação. */
  valorMaximoCentavos: 10_000_000,
  intervaloMinutos: [5, 1440],
  validadeMinutos: [30, 10080],
} as const;

/** O catálogo cabe na memória de um celular simples e é lido aos poucos. */
export const MAX_ITENS_CATALOGO = 5000;

export const CONFIG_PEDIDOS_PADRAO: ConfigPedidos = {
  colunaCodigo: '',
  colunaNome: '',
  colunaPreco: '',
  colunaPrecoDe: null,
  colunaUnidade: null,
  colunaCategoria: null,
  colunaEstoque: null,
  colunaCodigoBarras: null,
  comFotos: false,
  dadosDoCatalogo: false,
  pedidoMinimoCentavos: null,
  modalidades: {
    ENTREGA: { ativa: true, precoCentavos: 0 },
    AGENDADA: { ativa: false, precoCentavos: 0 },
    EXPRESSA: { ativa: false, precoCentavos: 0 },
    RETIRADA: { ativa: true, precoCentavos: 0 },
  },
  mensagem: '',
  enderecoRetirada: '',
  agendamento: AGENDAMENTO_PADRAO,
  impressoraFolhaId: null,
  camposDetalhe: [],
};

const valorValido = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= LIMITES_PEDIDOS.valorMaximoCentavos;

/** Devolve a mensagem de erro, se houver. As colunas são conferidas à parte, com as da consulta. */
export function problemaNaConfigPedidos(c: ConfigPedidos): string | null {
  if (!c.colunaCodigo?.trim()) return 'Escolha a coluna do código do produto.';
  if (!c.colunaNome?.trim()) return 'Escolha a coluna do nome do produto.';
  if (!c.colunaPreco?.trim()) return 'Escolha a coluna do preço.';
  if (c.comFotos && !c.colunaCodigoBarras?.trim()) return 'Escolha a coluna do código de barras, usada para achar as fotos.';
  if (c.dadosDoCatalogo && !c.colunaCodigoBarras?.trim()) return 'Escolha a coluna do código de barras, usada para achar o nome e a categoria no catálogo.';
  if (c.pedidoMinimoCentavos !== null && (!valorValido(c.pedidoMinimoCentavos) || c.pedidoMinimoCentavos === 0)) return 'Pedido mínimo inválido.';
  if ((c.mensagem ?? '').length > LIMITES_PEDIDOS.mensagem) return `A mensagem pode ter até ${LIMITES_PEDIDOS.mensagem} caracteres.`;
  if ((c.enderecoRetirada ?? '').length > LIMITES_PEDIDOS.enderecoRetirada) return `O endereço pode ter até ${LIMITES_PEDIDOS.enderecoRetirada} caracteres.`;
  if (!c.modalidades) return 'Escolha ao menos uma forma de entrega.';
  for (const m of MODALIDADES_ENTREGA) {
    const x = c.modalidades[m];
    if (!x || typeof x.ativa !== 'boolean' || !valorValido(x.precoCentavos)) return `${ROTULO_MODALIDADE[m].titulo}: preço inválido.`;
  }
  if (!MODALIDADES_ENTREGA.some((m) => c.modalidades[m].ativa)) return 'Escolha ao menos uma forma de entrega.';
  if (c.modalidades.RETIRADA.ativa && !c.enderecoRetirada?.trim()) return 'Informe o endereço para quem vai retirar no local.';
  const a = c.agendamento ?? AGENDAMENTO_PADRAO;
  if (!Number.isInteger(a.dias) || a.dias < 1 || a.dias > 30) return 'A entrega agendada pode ir de 1 a 30 dias à frente.';
  if (!(DURACOES_FAIXA as readonly number[]).includes(a.duracaoMinutos)) return 'Escolha o tamanho das faixas de horário.';
  const campos = c.camposDetalhe ?? [];
  if (!Array.isArray(campos) || campos.length > MAX_CAMPOS_DETALHE) return `O detalhe do produto mostra até ${MAX_CAMPOS_DETALHE} campos.`;
  for (const d of campos) {
    if (!d?.coluna?.trim()) return 'Campo do detalhe sem coluna.';
    if (!d.rotulo?.trim()) return `Dê um nome ao campo “${d.coluna}” do detalhe.`;
    if (d.rotulo.length > MAX_ROTULO_DETALHE) return `O nome do campo “${d.coluna}” pode ter até ${MAX_ROTULO_DETALHE} caracteres.`;
  }
  if (new Set(campos.map((d) => d.coluna.toLowerCase())).size !== campos.length) return 'Uma coluna aparece duas vezes no detalhe do produto.';
  return null;
}

export function problemaNosPrazosPedidos(intervaloMinutos: number, validadeMinutos: number): string | null {
  const [iMin, iMax] = LIMITES_PEDIDOS.intervaloMinutos;
  const [vMin, vMax] = LIMITES_PEDIDOS.validadeMinutos;
  if (!Number.isInteger(intervaloMinutos) || intervaloMinutos < iMin || intervaloMinutos > iMax) return `A atualização precisa ficar entre ${iMin} e ${iMax} minutos.`;
  if (!Number.isInteger(validadeMinutos) || validadeMinutos < vMin || validadeMinutos > vMax) return `A validade precisa ficar entre ${vMin} e ${vMax} minutos.`;
  if (validadeMinutos < intervaloMinutos * 2) return 'A validade precisa ser de pelo menos duas atualizações, para uma falha passageira não tirar o catálogo do ar.';
  return null;
}

/** Sugestão ao escolher a consulta: os nomes que o sistema já reconhece em outras telas. */
export function colunasSugeridasPedidos(colunas: string[]): ColunasCatalogo {
  const achar = (...regras: RegExp[]) => {
    for (const r of regras) {
      const c = colunas.find((x) => r.test(x));
      if (c) return c;
    }
    return null;
  };
  return {
    colunaCodigo: achar(/^(codigo|código|cod|cod_?produto|id_?produto|sku)$/i, /^cod/i) ?? '',
    colunaNome: achar(/^(descricao|descrição|nome|produto)$/i, /descri|nome|produto/i) ?? '',
    colunaPreco: achar(/^(preco|preço|preco_?(venda|por|oferta)|valor|venda)$/i, /^(pre[cç]o|prc|vlr|valor)(?!.*(custo|compra|de$))/i) ?? '',
    colunaPrecoDe: achar(/^pre[cç]o_?(de|antigo|normal|anterior)$/i),
    colunaUnidade: achar(/^(unidade|und|un|unid|embalagem)$/i),
    colunaCategoria: achar(/^(categoria|grupo|secao|seção|departamento|familia|família)$/i),
    colunaEstoque: achar(/^(estoque|saldo|qtd_?estoque|quantidade_?estoque|disponivel|disponível)$/i, /estoque|saldo/i),
    colunaCodigoBarras: achar(/ean|gtin|barra|codbar/i),
  };
}

// Valores ------------------------------------------------------------------------------------

/** Centavos de um valor da consulta ("4,99", "4.99", 4.99). Nulo se não for número. */
export function centavosDe(v: unknown): number | null {
  const n = numeroDe(v);
  return n === null ? null : Math.round(n * 100);
}

export function formatarCentavos(c: number): string {
  const negativo = c < 0;
  const abs = Math.abs(Math.round(c));
  const inteiro = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? '-' : ''}R$ ${inteiro},${String(abs % 100).padStart(2, '0')}`;
}

// Catálogo -----------------------------------------------------------------------------------

export interface ItemCatalogo {
  codigo: string;
  nome: string;
  precoCentavos: number;
  /** Só quando é maior que o preço atual. */
  precoDeCentavos?: number;
  unidade?: string;
  categoria?: string;
  /** Inteiro; ausente quando a consulta não traz estoque. */
  estoque?: number;
  codigoBarras?: string;
  /** O que a loja escolheu mostrar ao abrir o produto; vazio fica de fora. */
  detalhes?: { rotulo: string; valor: string }[];
  /** Endereço da foto guardada. */
  foto?: string;
}

export interface ResultadoCatalogo {
  itens: ItemCatalogo[];
  /** Sem código, nome ou preço válido. */
  descartados: number;
  /** Sem estoque. */
  semEstoque: number;
  /** Código repetido: fica o primeiro. */
  repetidos: number;
  /** Além do limite. */
  cortados: number;
}

function valorDaColuna(registro: Registro, coluna: string | null): unknown {
  if (!coluna) return undefined;
  const chave = Object.keys(registro).find((c) => c.toLowerCase() === coluna.toLowerCase());
  return chave === undefined ? undefined : registro[chave];
}

const textoDe = (v: unknown) => (v === null || v === undefined ? '' : textoNaTela(v).trim());

export function itensDoCatalogo(registros: Registro[], c: ColunasCatalogo & { camposDetalhe?: CampoDetalhe[] }): ResultadoCatalogo {
  const r: ResultadoCatalogo = { itens: [], descartados: 0, semEstoque: 0, repetidos: 0, cortados: 0 };
  const vistos = new Set<string>();
  for (const linha of registros) {
    const codigo = textoDe(valorDaColuna(linha, c.colunaCodigo));
    const nome = textoDe(valorDaColuna(linha, c.colunaNome));
    const preco = centavosDe(valorDaColuna(linha, c.colunaPreco));
    if (!codigo || !nome || preco === null || preco <= 0 || preco > LIMITES_PEDIDOS.valorMaximoCentavos) {
      r.descartados++;
      continue;
    }
    let estoque: number | undefined;
    if (c.colunaEstoque) {
      const n = numeroDe(valorDaColuna(linha, c.colunaEstoque));
      estoque = n === null ? 0 : Math.floor(n);
      if (estoque <= 0) {
        r.semEstoque++;
        continue;
      }
    }
    if (vistos.has(codigo)) {
      r.repetidos++;
      continue;
    }
    if (r.itens.length >= MAX_ITENS_CATALOGO) {
      r.cortados++;
      continue;
    }
    vistos.add(codigo);
    const item: ItemCatalogo = { codigo, nome, precoCentavos: preco };
    const de = centavosDe(valorDaColuna(linha, c.colunaPrecoDe));
    if (de !== null && de > preco && de <= LIMITES_PEDIDOS.valorMaximoCentavos) item.precoDeCentavos = de;
    const unidade = textoDe(valorDaColuna(linha, c.colunaUnidade));
    if (unidade) item.unidade = unidade.slice(0, 20);
    const categoria = textoDe(valorDaColuna(linha, c.colunaCategoria));
    if (categoria) item.categoria = categoria.slice(0, 60);
    if (estoque !== undefined) item.estoque = estoque;
    const barras = textoDe(valorDaColuna(linha, c.colunaCodigoBarras));
    if (barras) item.codigoBarras = barras;
    const detalhes = (c.camposDetalhe ?? []).flatMap((d) => {
      const valor = textoDe(valorDaColuna(linha, d.coluna)).slice(0, MAX_VALOR_DETALHE);
      return valor ? [{ rotulo: d.rotulo, valor }] : [];
    });
    if (detalhes.length) item.detalhes = detalhes;
    r.itens.push(item);
  }
  return r;
}

/**
 * Pedido recebido ou em separação ainda não foi lançado no ERP: o estoque da consulta não sabe dele.
 * Até sair para entrega (ou ficar pronto para retirar), a quantidade fica reservada no link.
 */
export const SITUACOES_QUE_RESERVAM = ['NOVO', 'EM_SEPARACAO'] as const;

export function reservasDosPedidos(pedidos: { itens: { codigo: string; quantidade: number }[] }[]): Map<string, number> {
  const r = new Map<string, number>();
  for (const p of pedidos) for (const i of p.itens ?? []) r.set(i.codigo, (r.get(i.codigo) ?? 0) + i.quantidade);
  return r;
}

/** O estoque que sobra para o link. Sem coluna de estoque, nada muda; o que zerou sai do catálogo. */
export function descontarReservas(itens: ItemCatalogo[], reservas: ReadonlyMap<string, number>): ItemCatalogo[] {
  if (reservas.size === 0) return itens;
  const r: ItemCatalogo[] = [];
  for (const i of itens) {
    const reservado = reservas.get(i.codigo);
    if (i.estoque === undefined || !reservado) r.push(i);
    else if (i.estoque - reservado > 0) r.push({ ...i, estoque: i.estoque - reservado });
  }
  return r;
}

/** Categorias na ordem alfabética, sem repetir. */
export function categoriasDoCatalogo(itens: ItemCatalogo[]): string[] {
  return [...new Set(itens.map((i) => i.categoria).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// Carrinho -----------------------------------------------------------------------------------

export interface ItemCarrinho {
  codigo: string;
  quantidade: number;
  /** O preço que o cliente viu: se mudou, o pedido não é gravado sem ele confirmar. */
  precoCentavos: number;
}

export interface ItemConferido {
  codigo: string;
  nome: string;
  quantidade: number;
  precoCentavos: number;
  unidade?: string;
  codigoBarras?: string;
}

export type MudancaCarrinho =
  | { codigo: string; nome: string; tipo: 'PRECO'; antes: number; depois: number }
  | { codigo: string; nome: string; tipo: 'ESTOQUE'; antes: number; depois: number }
  | { codigo: string; nome: string; tipo: 'SUMIU' };

export const MAX_ITENS_CARRINHO = 200;
/** Quantidade de um item, mesmo sem estoque informado. */
export const MAX_QUANTIDADE_ITEM = 999;

export const quantidadeValida = (q: unknown) => Number.isInteger(q) && (q as number) >= 1 && (q as number) <= MAX_QUANTIDADE_ITEM;

/**
 * Confere o carrinho com o catálogo atual: preço e estoque valem os de agora, e o que mudou volta para
 * o cliente confirmar. Quem chama só grava com `mudancas` vazio. O preço nunca vem do cliente.
 */
export function conferirCarrinho(carrinho: ItemCarrinho[], catalogo: ItemCatalogo[]): { itens: ItemConferido[]; mudancas: MudancaCarrinho[] } {
  const porCodigo = new Map(catalogo.map((i) => [i.codigo, i]));
  const itens: ItemConferido[] = [];
  const mudancas: MudancaCarrinho[] = [];
  const somados = new Map<string, ItemCarrinho>();
  for (const c of carrinho) {
    const antes = somados.get(c.codigo);
    somados.set(c.codigo, antes ? { ...c, quantidade: antes.quantidade + c.quantidade } : { ...c });
  }
  for (const c of somados.values()) {
    const p = porCodigo.get(c.codigo);
    if (!p) {
      mudancas.push({ codigo: c.codigo, nome: c.codigo, tipo: 'SUMIU' });
      continue;
    }
    let quantidade = c.quantidade;
    if (p.estoque !== undefined && quantidade > p.estoque) {
      mudancas.push({ codigo: p.codigo, nome: p.nome, tipo: 'ESTOQUE', antes: quantidade, depois: p.estoque });
      quantidade = p.estoque;
    }
    if (p.precoCentavos !== c.precoCentavos) mudancas.push({ codigo: p.codigo, nome: p.nome, tipo: 'PRECO', antes: c.precoCentavos, depois: p.precoCentavos });
    itens.push({ codigo: p.codigo, nome: p.nome, quantidade, precoCentavos: p.precoCentavos, ...(p.unidade ? { unidade: p.unidade } : {}), ...(p.codigoBarras ? { codigoBarras: p.codigoBarras } : {}) });
  }
  return { itens, mudancas };
}

export function textoDaMudanca(m: MudancaCarrinho): string {
  if (m.tipo === 'SUMIU') return `Um produto do carrinho (${m.nome}) não está mais disponível.`;
  if (m.tipo === 'ESTOQUE') return `${m.nome}: só ${m.depois === 1 ? 'resta 1' : `restam ${m.depois}`}.`;
  return `${m.nome}: o preço mudou de ${formatarCentavos(m.antes)} para ${formatarCentavos(m.depois)}.`;
}

export const subtotalDe = (itens: { quantidade: number; precoCentavos: number }[]) => itens.reduce((s, i) => s + i.quantidade * i.precoCentavos, 0);

export const unidadesDe = (itens: { quantidade: number }[]) => itens.reduce((s, i) => s + i.quantidade, 0);

/** Quanto falta para o mínimo, só pelos produtos. Zero quando já chegou ou não há mínimo. */
export function faltaParaMinimo(subtotalCentavos: number, minimoCentavos: number | null): number {
  return minimoCentavos ? Math.max(0, minimoCentavos - subtotalCentavos) : 0;
}

/** Troco em dinheiro. Nulo quando o valor não cobre o total. */
export function trocoPara(totalCentavos: number, pagoComCentavos: number): number | null {
  return pagoComCentavos >= totalCentavos ? pagoComCentavos - totalCentavos : null;
}

// Dados do cliente ---------------------------------------------------------------------------

/** Celular brasileiro: DDD válido + 9 + 8 dígitos. Aceita com ou sem +55, máscara e espaços. Devolve só os 11 dígitos. */
export function normalizarCelular(v: string): string | null {
  let d = (v ?? '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
  if (!/^[1-9][1-9]9\d{8}$/.test(d)) return null;
  return d;
}

export const formatarCelular = (d: string) => (d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d);

export function normalizarCep(v: string): string | null {
  const d = (v ?? '').replace(/\D/g, '');
  return /^\d{8}$/.test(d) && d !== '00000000' ? d : null;
}

export const formatarCep = (d: string) => (d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d);

/** O link fixo do catálogo da empresa. */
export const caminhoCatalogo = (codigo: string) => `/loja/${codigo}`;

// Situação do catálogo -----------------------------------------------------------------------

export type SituacaoCatalogo = 'DESLIGADO' | 'SEM_DADOS' | 'DADOS_VENCIDOS' | 'NO_AR';

export const ROTULO_SITUACAO_CATALOGO: Record<SituacaoCatalogo, string> = {
  DESLIGADO: 'Desligado',
  SEM_DADOS: 'Sem produtos',
  DADOS_VENCIDOS: 'Fora do ar: produtos desatualizados',
  NO_AR: 'No ar',
};

export const catalogoValidoAte = (dadosEm: Date, validadeMinutos: number) => new Date(dadosEm.getTime() + validadeMinutos * 60_000);

/** O link só mostra produtos com a cópia dentro da validade: preço velho não vai para o cliente. */
export function situacaoDoCatalogo(c: { ativo: boolean; dadosEm: Date | null; validadeMinutos: number; quantidadeItens: number }, agora: Date): SituacaoCatalogo {
  if (!c.ativo) return 'DESLIGADO';
  if (!c.dadosEm || c.quantidadeItens === 0) return 'SEM_DADOS';
  return catalogoValidoAte(c.dadosEm, c.validadeMinutos) > agora ? 'NO_AR' : 'DADOS_VENCIDOS';
}

/** O que a tela Configurar pedidos recebe. */
export interface ConfiguracaoPedidosResumo {
  /** Nulo até salvar a primeira vez. */
  codigoLink: string | null;
  /** Endereço da logomarca; nulo sem logomarca. */
  logo: string | null;
  ativo: boolean;
  consultaId: string | null;
  consultaNome: string | null;
  config: ConfigPedidos;
  intervaloMinutos: number;
  validadeMinutos: number;
  horario: HorarioFuncionamento;
  situacao: SituacaoCatalogo;
  quantidadeItens: number;
  dadosEm: string | null;
  erro: string | null;
  responsavelNome: string | null;
}

export interface SalvarConfiguracaoPedidos {
  ativo: boolean;
  consultaId: string;
  config: ConfigPedidos;
  intervaloMinutos: number;
  validadeMinutos: number;
  horario: HorarioFuncionamento;
}

export interface ConsultaParaPedidos {
  id: string;
  nome: string;
  colunas: string[];
  /** Pede valores digitados: não roda sozinha, então não serve para o catálogo. */
  pedeParametro: boolean;
}

/** A leitura de agora, para escolher as colunas e ver o resultado antes de ligar. */
export interface PreviaCatalogo extends Omit<ResultadoCatalogo, 'itens'> {
  colunas: string[];
  /** Os primeiros, só para conferir. */
  itens: ItemCatalogo[];
  total: number;
  banidos: number;
  /** Com `dadosDoCatalogo`: ficam de fora por não ter (ainda) nome e categoria no catálogo. Os que nunca foram procurados entram quando forem achados. */
  semCatalogo?: number;
}

// Entrega agendada ---------------------------------------------------------------------------

export interface FaixaAgendamento {
  /** AAAA-MM-DD no fuso do sistema. */
  data: string;
  inicio: string;
  fim: string;
}

/** Faixa que começa daqui a menos que isto não dá tempo de separar. */
export const ANTECEDENCIA_AGENDAMENTO_MINUTOS = 60;
const MENOR_FAIXA_MINUTOS = 30;

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const diaDaSemana = (data: string) => new Date(`${data}T12:00:00Z`).getUTCDay();

/**
 * As faixas que o cliente pode escolher: de hoje até `dias` à frente, dentro do horário de funcionamento,
 * cortadas no tamanho escolhido. Faixa pequena no fim de um período só entra com pelo menos 30 min.
 */
export function faixasDeAgendamento(h: HorarioFuncionamento, hoje: string, horaAgora: string, cfg: ConfigAgendamento): FaixaAgendamento[] {
  const faixas: FaixaAgendamento[] = [];
  const minimo = minutosDe(horaAgora) + ANTECEDENCIA_AGENDAMENTO_MINUTOS;
  for (let n = 0; n <= cfg.dias; n++) {
    const data = somarDias(hoje, n);
    for (const p of h[diaDaSemana(data)] ?? []) {
      const fim = minutosDe(p.fim);
      for (let ini = minutosDe(p.inicio); fim - ini >= MENOR_FAIXA_MINUTOS; ini += cfg.duracaoMinutos) {
        if (n === 0 && ini < minimo) continue;
        faixas.push({ data, inicio: hhmm(ini), fim: hhmm(Math.min(ini + cfg.duracaoMinutos, fim)) });
      }
    }
  }
  return faixas;
}

const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "Hoje", "Amanhã" ou "Sex, 13 nov". */
export function textoDataAgendamento(data: string, hoje: string): string {
  if (data === hoje) return 'Hoje';
  if (data === somarDias(hoje, 1)) return 'Amanhã';
  const [, m, d] = data.split('-').map(Number);
  return `${DIAS_SEMANA[diaDaSemana(data)].slice(0, 3)}, ${d} ${NOMES_MES[m - 1]}`;
}

export const textoFaixa = (f: FaixaAgendamento, hoje: string) => `${textoDataAgendamento(f.data, hoje)}, ${f.inicio} às ${f.fim}`;

// Pedido -------------------------------------------------------------------------------------

export const SITUACOES_PEDIDO = ['NOVO', 'EM_SEPARACAO', 'PRONTO', 'CONCLUIDO', 'CANCELADO'] as const;
export type SituacaoPedido = (typeof SITUACOES_PEDIDO)[number];

/** "Pronto" quer dizer coisas diferentes para quem retira e para quem recebe. */
export function rotuloSituacaoPedido(s: SituacaoPedido, modalidade: ModalidadeEntrega): string {
  switch (s) {
    case 'NOVO':
      return 'Recebido';
    case 'EM_SEPARACAO':
      return 'Em separação';
    case 'PRONTO':
      return modalidade === 'RETIRADA' ? 'Pronto para retirar' : 'Saiu para entrega';
    case 'CONCLUIDO':
      return 'Concluído';
    default:
      return 'Cancelado';
  }
}

export interface EnderecoPedido {
  cep: string;
  rua: string;
  /** Vazio com `semNumero`. */
  numero: string;
  semNumero: boolean;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  /** Ponto que o celular do cliente informou, se ele permitiu. O endereço digitado continua valendo. */
  localizacao?: LocalizacaoPedido | null;
}

/** Coordenadas do navegador (`navigator.geolocation`), com a precisão em metros. */
export interface LocalizacaoPedido {
  latitude: number;
  longitude: number;
  precisaoMetros: number;
}

/** Acima disso o ponto é aproximado (computador pela internet, celular sem GPS): o painel avisa. */
export const PRECISAO_BOA_METROS = 100;

/** Só números válidos, arredondados (6 casas ≈ 10 cm); qualquer outra coisa vira nulo. */
export function localizacaoLimpa(l: unknown): LocalizacaoPedido | null {
  if (!l || typeof l !== 'object') return null;
  const { latitude, longitude, precisaoMetros } = l as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const la = num(latitude);
  const lo = num(longitude);
  const pr = num(precisaoMetros);
  if (la === null || lo === null || pr === null || Math.abs(la) > 90 || Math.abs(lo) > 180 || pr < 0) return null;
  return { latitude: Math.round(la * 1e6) / 1e6, longitude: Math.round(lo * 1e6) / 1e6, precisaoMetros: Math.min(Math.round(pr), 1_000_000) };
}

/** Link do mapa: pelo ponto do cliente quando houver, senão pelo endereço digitado. */
export function linkMapa(e: EnderecoPedido): string {
  const l = e.localizacao;
  if (l) return `https://www.google.com/maps/search/?api=1&query=${l.latitude},${l.longitude}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(textoEndereco(e))}`;
}

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const;

export const LIMITES_DADOS_PEDIDO = { nome: 80, rua: 120, numero: 10, complemento: 80, bairro: 80, cidade: 80, observacao: 300 } as const;

export function problemaNoEndereco(e: EnderecoPedido | null | undefined): string | null {
  if (!e) return 'Informe o endereço de entrega.';
  if (!normalizarCep(e.cep)) return 'Informe um CEP válido.';
  if (!e.rua?.trim()) return 'Informe a rua.';
  if (!e.semNumero && !e.numero?.trim()) return 'Informe o número, ou marque “sem número”.';
  if (!e.bairro?.trim()) return 'Informe o bairro.';
  if (!e.cidade?.trim()) return 'Informe a cidade.';
  if (!(UFS as readonly string[]).includes(e.uf)) return 'Informe o estado.';
  const L = LIMITES_DADOS_PEDIDO;
  if (e.rua.length > L.rua || (e.numero ?? '').length > L.numero || (e.complemento ?? '').length > L.complemento || e.bairro.length > L.bairro || e.cidade.length > L.cidade) return 'Endereço comprido demais.';
  return null;
}

export const textoEndereco = (e: EnderecoPedido) =>
  `${e.rua}, ${e.semNumero ? 's/n' : e.numero}${e.complemento ? ` – ${e.complemento}` : ''} – ${e.bairro}, ${e.cidade}/${e.uf} – CEP ${formatarCep(e.cep)}`;

/** O que o cliente manda ao finalizar. Preço e total nunca vêm dele: o servidor confere com o catálogo. */
export interface NovoPedido {
  itens: ItemCarrinho[];
  nome: string;
  telefone: string;
  modalidade: ModalidadeEntrega;
  /** Só fora da retirada. */
  endereco: EnderecoPedido | null;
  /** Só na agendada. */
  agendamento: FaixaAgendamento | null;
  pagamento: FormaPagamento;
  /** Só em dinheiro; nulo = não precisa de troco. */
  trocoParaCentavos: number | null;
  observacao: string;
}

/** O que o servidor sabe na hora de conferir. */
export interface ContextoPedido {
  modalidades: Record<ModalidadeEntrega, ModalidadeConfig>;
  aberta: boolean;
  faixas: FaixaAgendamento[];
  pedidoMinimoCentavos: number | null;
}

export interface TotaisPedido {
  subtotalCentavos: number;
  taxaCentavos: number;
  /** Só a loja dá, numa alteração que o cliente aceitou. */
  descontoCentavos: number;
  totalCentavos: number;
  /** Nulo sem troco, ou quando o valor informado não cobre mais o total. */
  trocoCentavos: number | null;
}

export function totaisDoPedido(itens: { quantidade: number; precoCentavos: number }[], taxaCentavos: number, trocoParaCentavos: number | null, descontoCentavos = 0): TotaisPedido {
  const subtotalCentavos = subtotalDe(itens);
  const totalCentavos = Math.max(0, subtotalCentavos + taxaCentavos - descontoCentavos);
  return { subtotalCentavos, taxaCentavos, descontoCentavos, totalCentavos, trocoCentavos: trocoParaCentavos === null ? null : trocoPara(totalCentavos, trocoParaCentavos) };
}

/** Confere o pedido já com os itens do catálogo (`conferirCarrinho` sem mudanças). Devolve a mensagem para o cliente. */
export function problemaNoPedido(p: NovoPedido, itens: ItemConferido[], ctx: ContextoPedido): string | null {
  if (!Array.isArray(p.itens) || p.itens.length === 0 || itens.length === 0) return 'O carrinho está vazio.';
  if (p.itens.length > MAX_ITENS_CARRINHO) return `O pedido pode ter até ${MAX_ITENS_CARRINHO} produtos diferentes.`;
  if (!p.itens.every((i) => quantidadeValida(i.quantidade))) return 'Quantidade inválida.';
  const nome = p.nome?.trim() ?? '';
  if (nome.length < 2) return 'Informe o seu nome.';
  if (nome.length > LIMITES_DADOS_PEDIDO.nome) return 'Nome comprido demais.';
  if (!normalizarCelular(p.telefone)) return 'Informe um celular com DDD, como (11) 98765-4321.';
  if (!(MODALIDADES_ENTREGA as readonly string[]).includes(p.modalidade)) return 'Escolha como quer receber.';
  if (!modalidadesPermitidas(ctx.modalidades, ctx.aberta).includes(p.modalidade)) {
    return ctx.aberta ? 'Esta forma de entrega não está disponível.' : 'A loja está fechada agora: só a entrega agendada está disponível.';
  }
  if (p.modalidade !== 'RETIRADA') {
    const e = problemaNoEndereco(p.endereco);
    if (e) return e;
  }
  if (p.modalidade === 'AGENDADA') {
    const a = p.agendamento;
    if (!a || !ctx.faixas.some((f) => f.data === a.data && f.inicio === a.inicio && f.fim === a.fim)) return 'Escolha o dia e o horário da entrega.';
  }
  if (!(FORMAS_PAGAMENTO as readonly string[]).includes(p.pagamento)) return 'Escolha a forma de pagamento.';
  if ((p.observacao ?? '').length > LIMITES_DADOS_PEDIDO.observacao) return 'Observação comprida demais.';
  const falta = faltaParaMinimo(subtotalDe(itens), ctx.pedidoMinimoCentavos);
  if (falta > 0) return `Faltam ${formatarCentavos(falta)} para o pedido mínimo de ${formatarCentavos(ctx.pedidoMinimoCentavos!)}.`;
  if (p.pagamento === 'DINHEIRO' && p.trocoParaCentavos !== null && p.trocoParaCentavos !== undefined) {
    if (!Number.isInteger(p.trocoParaCentavos) || p.trocoParaCentavos > LIMITES_PEDIDOS.valorMaximoCentavos) return 'Valor do troco inválido.';
    const total = subtotalDe(itens) + ctx.modalidades[p.modalidade].precoCentavos;
    if (p.trocoParaCentavos < total) return `O troco precisa ser para um valor igual ou maior que o total, ${formatarCentavos(total)}.`;
  }
  return null;
}

// O que o cliente vê -------------------------------------------------------------------------

export interface CatalogoPublico {
  empresa: string;
  /** Endereço da logomarca da loja; nulo sem logomarca. */
  logo: string | null;
  mensagem: string;
  aberta: boolean;
  /** "hoje às 14h"; nulo quando aberta ou sem horário. */
  abreEm: string | null;
  /** Hoje no fuso do sistema, para escrever "Hoje" e "Amanhã" nas faixas. */
  hoje: string;
  modalidades: { modalidade: ModalidadeEntrega; precoCentavos: number }[];
  enderecoRetirada: string | null;
  faixas: FaixaAgendamento[];
  pedidoMinimoCentavos: number | null;
  itens: ItemCatalogo[];
  categorias: string[];
  dadosEm: string;
}

export interface PedidoPublico {
  empresa: string;
  logo: string | null;
  /** O link do catálogo, para repetir a compra; nulo com o catálogo desligado. */
  codigoLoja: string | null;
  numero: number;
  situacao: SituacaoPedido;
  criadoEm: string;
  nome: string;
  telefone: string;
  modalidade: ModalidadeEntrega;
  endereco: EnderecoPedido | null;
  enderecoRetirada: string | null;
  agendamento: FaixaAgendamento | null;
  pagamento: FormaPagamento;
  trocoParaCentavos: number | null;
  observacao: string;
  itens: ItemConferido[];
  totais: TotaisPedido;
  /** Uma alteração da loja esperando o cliente aceitar ou recusar. */
  proposta: PropostaPublica | null;
  motivoCancelamento: string | null;
}

/** Resposta de quem envia: o número e o código do acompanhamento, que só ele recebe. */
export interface PedidoCriado {
  numero: number;
  codigo: string;
}

/** Recusa porque algo mudou desde que o cliente viu: ele confirma e envia de novo. */
export interface RecusaPorMudanca {
  mudancas: MudancaCarrinho[];
  itens: ItemConferido[];
}

export const caminhoAcompanhamento = (codigo: string) => `/loja/pedido/${codigo}`;

/**
 * Repetir a compra: os produtos do pedido no carrinho, com o que vale agora. O que saiu do catálogo fica
 * de fora, a quantidade cabe no estoque e o preço é o de hoje; cada mudança vira um aviso.
 */
export function itensParaRepetir(pedido: { codigo: string; nome: string; quantidade: number; precoCentavos: number }[], catalogo: ItemCatalogo[]): { carrinho: Record<string, number>; avisos: string[] } {
  const porCodigo = new Map(catalogo.map((i) => [i.codigo, i]));
  const carrinho: Record<string, number> = {};
  const avisos: string[] = [];
  for (const i of pedido) {
    const agora = porCodigo.get(i.codigo);
    if (!agora) {
      avisos.push(`${i.nome}: não está disponível agora.`);
      continue;
    }
    const quantidade = Math.min(i.quantidade, agora.estoque ?? MAX_QUANTIDADE_ITEM, MAX_QUANTIDADE_ITEM);
    if (quantidade < i.quantidade) avisos.push(`${agora.nome}: só ${quantidade === 1 ? 'resta 1' : `restam ${quantidade}`}, em vez de ${i.quantidade}.`);
    if (agora.precoCentavos !== i.precoCentavos) avisos.push(`${agora.nome}: o preço agora é ${formatarCentavos(agora.precoCentavos)} (era ${formatarCentavos(i.precoCentavos)}).`);
    carrinho[i.codigo] = (carrinho[i.codigo] ?? 0) + quantidade;
  }
  return { carrinho, avisos };
}

export const caminhoLogoDaLoja = (codigo: string, versao: number) => `/api/loja/${codigo}/logo?v=${versao}`;
export const LOGO_LOJA_MAXIMO_BYTES = 1_000_000;
