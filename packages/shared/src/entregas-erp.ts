// Entregas, etapa 10: pedidos do ERP. Uma consulta SQL (sem {param.*}) traz os pedidos a entregar; o
// relógio lê de tempos em tempos e cada pedido novo vira uma chamada, uma só por pedido (chave
// empresa + número do pedido). Regras puras; a API está em src/entregas/pedidos-erp.ts.

import { coordenadaValida, type Ponto } from './entregas';
import { TIPOS_CHAMADA, type ParadaChamada, type SituacaoChamada, type TipoChamada } from './entregas-chamadas';

export interface ConfigPedidosErp {
  consultaId: string | null;
  ativo: boolean;
  /** De quanto em quanto tempo a consulta roda. */
  intervaloMinutos: number;
  /** Pedido novo já abre a chamada, na distribuição automática; desligado, espera a empresa clicar. */
  chamarAutomatico: boolean;
  /** Ao ligar, os pedidos que já estão na consulta também são chamados (senão ficam como ignorados). */
  importarExistentes: boolean;
}

export const CONFIG_PEDIDOS_ERP_PADRAO: ConfigPedidosErp = { consultaId: null, ativo: false, intervaloMinutos: 2, chamarAutomatico: true, importarExistentes: false };

export const LIMITES_INTERVALO_PEDIDOS_ERP = { minimo: 1, maximo: 60 };
/** Linhas lidas por vez: a consulta deve trazer só o que falta entregar. */
export const LIMITE_LINHAS_PEDIDOS_ERP = 500;
/** Chamadas abertas por leitura: um erro no SQL não vira uma avalanche de chamadas. */
export const MAX_CHAMADAS_POR_LEITURA = 20;
/** Pedidos importados ficam na lista por esse tempo. */
export const DIAS_PEDIDOS_ERP = 30;

export function problemaNaConfigPedidosErp(c: ConfigPedidosErp): string | null {
  if (!Number.isInteger(c.intervaloMinutos) || c.intervaloMinutos < LIMITES_INTERVALO_PEDIDOS_ERP.minimo || c.intervaloMinutos > LIMITES_INTERVALO_PEDIDOS_ERP.maximo)
    return `O intervalo vai de ${LIMITES_INTERVALO_PEDIDOS_ERP.minimo} a ${LIMITES_INTERVALO_PEDIDOS_ERP.maximo} minutos.`;
  if (c.ativo && !c.consultaId) return 'Escolha a consulta dos pedidos.';
  return null;
}

// Colunas ------------------------------------------------------------------------------------

/** Nomes aceitos para cada informação (sem diferença de maiúsculas; use o alias no SQL). */
export const COLUNAS_PEDIDO_ERP = {
  pedido: ['pedido', 'numero_pedido', 'num_pedido', 'nr_pedido', 'id_pedido', 'numero', 'codigo'],
  cliente: ['cliente', 'nome_cliente', 'destinatario', 'nome', 'contato'],
  telefone: ['telefone', 'fone', 'celular', 'whatsapp'],
  endereco: ['endereco', 'endereco_completo', 'endereco_entrega'],
  rua: ['rua', 'logradouro'],
  numero: ['numero_endereco', 'num', 'nro'],
  complemento: ['complemento'],
  bairro: ['bairro'],
  cidade: ['cidade', 'municipio'],
  uf: ['uf', 'estado'],
  cep: ['cep'],
  lat: ['lat', 'latitude'],
  lon: ['lon', 'lng', 'longitude'],
  observacao: ['observacao', 'obs', 'instrucoes'],
  serie: ['serie', 'numero_serie'],
  tipo: ['tipo', 'tipo_servico'],
} as const;

export type CampoPedidoErp = keyof typeof COLUNAS_PEDIDO_ERP;
export type MapaColunasErp = Record<CampoPedidoErp, string | null>;

export const ROTULO_CAMPO_PEDIDO_ERP: Record<CampoPedidoErp, string> = {
  pedido: 'Número do pedido',
  cliente: 'Cliente',
  telefone: 'Telefone',
  endereco: 'Endereço completo',
  rua: 'Rua',
  numero: 'Número',
  complemento: 'Complemento',
  bairro: 'Bairro',
  cidade: 'Cidade',
  uf: 'UF',
  cep: 'CEP',
  lat: 'Latitude',
  lon: 'Longitude',
  observacao: 'Observação',
  serie: 'Série da máquina',
  tipo: 'Tipo (entrega, coleta, devolução)',
};

/** Cada informação pega a primeira coluna com um dos nomes aceitos (uma coluna não serve a duas). */
export function mapaDeColunas(colunas: readonly string[]): MapaColunasErp {
  const usadas = new Set<string>();
  const mapa = {} as MapaColunasErp;
  for (const campo of Object.keys(COLUNAS_PEDIDO_ERP) as CampoPedidoErp[]) {
    let achada: string | null = null;
    for (const nome of COLUNAS_PEDIDO_ERP[campo]) {
      achada = colunas.find((c) => c.toLowerCase() === nome && !usadas.has(c)) ?? null;
      if (achada) break;
    }
    if (achada) usadas.add(achada);
    mapa[campo] = achada;
  }
  return mapa;
}

export function problemaNasColunasErp(m: MapaColunasErp): string | null {
  if (!m.pedido) return 'A consulta precisa da coluna do número do pedido (use: coluna AS pedido).';
  const temEndereco = !!m.endereco || (!!m.rua && !!m.cidade);
  if (!temEndereco && !(m.lat && m.lon)) return 'A consulta precisa do endereço (coluna AS endereco, ou rua e cidade) ou do ponto (lat e lon).';
  return null;
}

// Linhas -------------------------------------------------------------------------------------

export interface PedidoErp {
  codigo: string;
  tipo: TipoChamada;
  cliente: string;
  telefone: string;
  endereco: string;
  ponto: Ponto | null;
  observacao: string;
  serie: string | null;
}

const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

function numero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = texto(v).replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

export function tipoDoTexto(v: unknown): TipoChamada {
  const t = texto(v)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();
  if ((TIPOS_CHAMADA as readonly string[]).includes(t)) return t as TipoChamada;
  if (t.includes('DEVOL')) return 'DEVOLUCAO_MAQUINA';
  if (t.includes('COLET')) return 'COLETA';
  return 'ENTREGA';
}

/** Endereço numa linha só, a partir da coluna completa ou das partes. */
export function enderecoDaLinha(r: Record<string, unknown>, m: MapaColunasErp): string {
  if (m.endereco && texto(r[m.endereco])) return texto(r[m.endereco]);
  const v = (c: string | null) => (c ? texto(r[c]) : '');
  const rua = [v(m.rua), v(m.numero)].filter(Boolean).join(', ');
  const ruaComp = [rua, v(m.complemento)].filter(Boolean).join(' - ');
  const cidade = [v(m.cidade), v(m.uf)].filter(Boolean).join(' - ');
  return [ruaComp, v(m.bairro), cidade, v(m.cep)].filter(Boolean).join(', ');
}

/** Linha sem número de pedido é ignorada. */
export function pedidoDaLinha(r: Record<string, unknown>, m: MapaColunasErp): PedidoErp | null {
  const codigo = m.pedido ? texto(r[m.pedido]).slice(0, 60) : '';
  if (!codigo) return null;
  const lat = m.lat ? numero(r[m.lat]) : null;
  const lon = m.lon ? numero(r[m.lon]) : null;
  const ponto = lat !== null && lon !== null && coordenadaValida({ lat, lon }) ? { lat, lon } : null;
  const serie = m.serie ? texto(r[m.serie]).slice(0, 60) : '';
  return {
    codigo,
    tipo: m.tipo ? tipoDoTexto(r[m.tipo]) : 'ENTREGA',
    cliente: (m.cliente ? texto(r[m.cliente]) : '').slice(0, 80),
    telefone: (m.telefone ? texto(r[m.telefone]) : '').replace(/\D/g, '').slice(0, 20),
    endereco: enderecoDaLinha(r, m).slice(0, 300),
    ponto,
    observacao: (m.observacao ? texto(r[m.observacao]) : '').slice(0, 300),
    serie: serie || null,
  };
}

/** Número repetido na consulta: vale a primeira linha. */
export function pedidosDasLinhas(linhas: Record<string, unknown>[], m: MapaColunasErp): PedidoErp[] {
  const vistos = new Set<string>();
  const saida: PedidoErp[] = [];
  for (const r of linhas) {
    const p = pedidoDaLinha(r, m);
    if (!p || vistos.has(p.codigo)) continue;
    vistos.add(p.codigo);
    saida.push(p);
  }
  return saida;
}

// Telas --------------------------------------------------------------------------------------

/** CHAMADA: chamada aberta; PENDENTE: espera a empresa (sem ponto, erro ou chamada manual); IGNORADO: a empresa dispensou. */
export type SituacaoPedidoErp = 'CHAMADA' | 'PENDENTE' | 'IGNORADO';

export const ROTULO_SITUACAO_PEDIDO_ERP: Record<SituacaoPedidoErp, string> = { CHAMADA: 'Chamada aberta', PENDENTE: 'Esperando a empresa', IGNORADO: 'Ignorado' };

export interface PedidoErpResumo {
  id: string;
  codigo: string;
  tipo: TipoChamada;
  cliente: string;
  telefone: string;
  endereco: string;
  ponto: Ponto | null;
  observacao: string;
  serie: string | null;
  situacao: SituacaoPedidoErp;
  mensagem: string | null;
  chamada: { id: string; numero: number; situacao: SituacaoChamada } | null;
  criadoEm: string;
}

/** Para abrir a chamada à mão: o lado do cliente sem ponto vem com lat e lon 0; sem base da empresa, nulo. */
export interface RascunhoPedidoErp {
  pedidoErpId: string;
  codigo: string;
  tipo: TipoChamada;
  origem: ParadaChamada | null;
  destino: ParadaChamada | null;
  serieEsperada: string | null;
  observacao: string;
}

export interface PainelPedidosErp {
  config: ConfigPedidosErp;
  consultaNome: string | null;
  responsavelNome: string | null;
  colunas: MapaColunasErp | null;
  lidoEm: string | null;
  proximaLeituraEm: string | null;
  erro: string | null;
  pedidos: PedidoErpResumo[];
}

/** Para a tela: cada informação com os nomes de coluna aceitos. */
export const CAMPOS_DO_PEDIDO_ERP: { campo: CampoPedidoErp; nomes: string[] }[] = (Object.keys(COLUNAS_PEDIDO_ERP) as CampoPedidoErp[]).map((campo) => ({ campo, nomes: [...COLUNAS_PEDIDO_ERP[campo]] }));
