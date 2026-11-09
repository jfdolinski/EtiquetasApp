/**
 * Pedidos pelo link da empresa: o cliente final monta um carrinho com a cópia dos produtos da consulta
 * e envia; a loja acompanha no painel. Ver docs/PEDIDOS.md. Valores sempre em centavos (inteiros):
 * total, mínimo e troco não podem errar por arredondamento.
 */
import type { Registro } from './etiquetas/tipos';
import { textoNaTela } from './etiquetas/valores';
import { numeroDe } from './avulsa';

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
  /** Só os produtos contam (sem a entrega). Nulo: sem mínimo. */
  pedidoMinimoCentavos: number | null;
  modalidades: Record<ModalidadeEntrega, ModalidadeConfig>;
  /** Aparece no alto do catálogo, como "Pedidos até as 17h saem no mesmo dia". */
  mensagem: string;
  /** Para quem escolhe retirar. */
  enderecoRetirada: string;
}

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
  pedidoMinimoCentavos: null,
  modalidades: {
    ENTREGA: { ativa: true, precoCentavos: 0 },
    AGENDADA: { ativa: false, precoCentavos: 0 },
    EXPRESSA: { ativa: false, precoCentavos: 0 },
    RETIRADA: { ativa: true, precoCentavos: 0 },
  },
  mensagem: '',
  enderecoRetirada: '',
};

const valorValido = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= LIMITES_PEDIDOS.valorMaximoCentavos;

/** Devolve a mensagem de erro, se houver. As colunas são conferidas à parte, com as da consulta. */
export function problemaNaConfigPedidos(c: ConfigPedidos): string | null {
  if (!c.colunaCodigo?.trim()) return 'Escolha a coluna do código do produto.';
  if (!c.colunaNome?.trim()) return 'Escolha a coluna do nome do produto.';
  if (!c.colunaPreco?.trim()) return 'Escolha a coluna do preço.';
  if (c.comFotos && !c.colunaCodigoBarras?.trim()) return 'Escolha a coluna do código de barras, usada para achar as fotos.';
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

export function itensDoCatalogo(registros: Registro[], c: ColunasCatalogo): ResultadoCatalogo {
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
    r.itens.push(item);
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
}
