// Entregas, etapa 2: chamadas (docs/ENTREGAS.md). Regras puras, valores em centavos e metros.
// O app do entregador tem cópias conferidas em entregas-app.test.ts.

import { distanciaMetros, type Ponto, type TipoVeiculo } from './entregas';
import type { DistribuicaoResumo, OfertaDaChamada } from './entregas-direcionamento';
import type { EmergenciaChamada } from './entregas-rastreio';
import type { AdicionalAplicado, DestinoDoEntregador, ParadaExtraResumo } from './entregas-paradas';
import type { ChecklistsDaChamada, DevolucaoChamada, RegraEspera } from './entregas-servico';
import type { ModoAssinatura } from './entregas-comprovacao';

export const TIPOS_CHAMADA = ['ENTREGA', 'COLETA', 'DEVOLUCAO_MAQUINA'] as const;
export type TipoChamada = (typeof TIPOS_CHAMADA)[number];

export const ROTULO_TIPO_CHAMADA: Record<TipoChamada, string> = {
  ENTREGA: 'Entrega',
  COLETA: 'Coleta',
  DEVOLUCAO_MAQUINA: 'Devolução de máquina',
};

export const SITUACOES_CHAMADA = ['ABERTA', 'ACEITA', 'NA_COLETA', 'COLETADA', 'NO_DESTINO', 'CONCLUIDA', 'OCORRENCIA', 'CANCELADA'] as const;
export type SituacaoChamada = (typeof SITUACOES_CHAMADA)[number];

export const ROTULO_SITUACAO_CHAMADA: Record<SituacaoChamada, string> = {
  ABERTA: 'Aguardando entregador',
  ACEITA: 'A caminho da coleta',
  NA_COLETA: 'No local da coleta',
  COLETADA: 'A caminho do destino',
  NO_DESTINO: 'No destino',
  CONCLUIDA: 'Concluída',
  OCORRENCIA: 'Ocorrência',
  CANCELADA: 'Cancelada',
};

/** Com entregador e ainda não terminada: ocupa o entregador. */
export const SITUACOES_EM_ANDAMENTO: readonly SituacaoChamada[] = ['ACEITA', 'NA_COLETA', 'COLETADA', 'NO_DESTINO', 'OCORRENCIA'];
export const SITUACOES_FINAIS: readonly SituacaoChamada[] = ['CONCLUIDA', 'CANCELADA'];

/** O que o entregador faz em cada situação, nesta ordem. */
export const PROXIMA_ETAPA: Partial<Record<SituacaoChamada, { para: SituacaoChamada; rotulo: string }>> = {
  ACEITA: { para: 'NA_COLETA', rotulo: 'Cheguei na coleta' },
  NA_COLETA: { para: 'COLETADA', rotulo: 'Coletei' },
  COLETADA: { para: 'NO_DESTINO', rotulo: 'Cheguei no destino' },
  NO_DESTINO: { para: 'CONCLUIDA', rotulo: 'Entreguei' },
};

/** "Cheguei" só vale perto do ponto (a precisão do GPS conta até 100 m a mais). */
export const RAIO_CHEGADA_METROS = 150;
export const TENTATIVAS_CODIGO = 5;

export function chegouPerto(posicao: Ponto, alvo: Ponto, precisaoMetros: number | null): boolean {
  return distanciaMetros(posicao, alvo) <= RAIO_CHEGADA_METROS + Math.min(Math.max(precisaoMetros ?? 0, 0), 100);
}

export const MOTIVOS_OCORRENCIA = ['CLIENTE_AUSENTE', 'ENDERECO_NAO_ENCONTRADO', 'RECUSA_NO_RECEBIMENTO', 'MAQUINA_COM_DEFEITO', 'SERIE_DIFERENTE', 'OUTRO'] as const;
export type MotivoOcorrencia = (typeof MOTIVOS_OCORRENCIA)[number];

export const ROTULO_MOTIVO_OCORRENCIA: Record<MotivoOcorrencia, string> = {
  CLIENTE_AUSENTE: 'Cliente ausente',
  ENDERECO_NAO_ENCONTRADO: 'Endereço não encontrado',
  RECUSA_NO_RECEBIMENTO: 'Recusou o recebimento',
  MAQUINA_COM_DEFEITO: 'Máquina com defeito ou faltando item',
  SERIE_DIFERENTE: 'Número de série diferente',
  OUTRO: 'Outro motivo',
};

// Preço --------------------------------------------------------------------------------------

export interface PrecoTipo {
  baseCentavos: number;
  porKmCentavos: number;
  /** Km já pagos na base. */
  kmIncluso: number;
  /** Cada parada além do destino principal (tabela antiga sem o campo = 0). */
  porParadaCentavos?: number;
  /** Taxa de deslocamento se a empresa cancela depois que alguém aceitou (sem o campo = 0). */
  taxaCancelamentoCentavos?: number;
  /** Minutos no ponto sem cobrar espera (sem o campo = 10). */
  esperaToleranciaMinutos?: number;
  /** Cada 10 min além da tolerância (sem o campo = 0, espera não cobrada). */
  esperaPorBlocoCentavos?: number;
}

export type TabelaPrecos = Record<TipoChamada, PrecoTipo>;

export const TABELA_PRECOS_PADRAO: TabelaPrecos = {
  ENTREGA: { baseCentavos: 800, porKmCentavos: 150, kmIncluso: 3, porParadaCentavos: 300 },
  COLETA: { baseCentavos: 800, porKmCentavos: 150, kmIncluso: 3 },
  DEVOLUCAO_MAQUINA: { baseCentavos: 1200, porKmCentavos: 150, kmIncluso: 3 },
};

export function problemaNaTabelaPrecos(t: TabelaPrecos): string | null {
  for (const tipo of TIPOS_CHAMADA) {
    const p = t?.[tipo];
    const nome = ROTULO_TIPO_CHAMADA[tipo];
    if (!p) return `Informe os preços de ${nome}.`;
    if (!Number.isInteger(p.baseCentavos) || p.baseCentavos < 0 || p.baseCentavos > 100_000_00) return `Valor base inválido em ${nome}.`;
    if (!Number.isInteger(p.porKmCentavos) || p.porKmCentavos < 0 || p.porKmCentavos > 10_000_00) return `Valor por km inválido em ${nome}.`;
    if (p.taxaCancelamentoCentavos !== undefined && (!Number.isInteger(p.taxaCancelamentoCentavos) || p.taxaCancelamentoCentavos < 0 || p.taxaCancelamentoCentavos > 100_000)) return `Taxa de cancelamento inválida em ${nome}.`;
    if (p.porParadaCentavos !== undefined && (!Number.isInteger(p.porParadaCentavos) || p.porParadaCentavos < 0 || p.porParadaCentavos > 100_000)) return `Valor por parada inválido em ${nome}.`;
    if (p.esperaToleranciaMinutos !== undefined && (!Number.isInteger(p.esperaToleranciaMinutos) || p.esperaToleranciaMinutos < 0 || p.esperaToleranciaMinutos > 120)) return `Tolerância da espera de 0 a 120 min em ${nome}.`;
    if (p.esperaPorBlocoCentavos !== undefined && (!Number.isInteger(p.esperaPorBlocoCentavos) || p.esperaPorBlocoCentavos < 0 || p.esperaPorBlocoCentavos > 100_00)) return `Valor da espera inválido em ${nome}.`;
    if (typeof p.kmIncluso !== 'number' || !Number.isFinite(p.kmIncluso) || p.kmIncluso < 0 || p.kmIncluso > 500) return `Km incluso inválido em ${nome}.`;
  }
  return null;
}

/** Base + cada km além do incluso (proporcional, arredondado no fim). */
export function valorDaChamada(p: PrecoTipo, metros: number, paradasExtras = 0): number {
  const km = Math.max(0, metros) / 1000;
  return Math.round(p.baseCentavos + Math.max(0, km - p.kmIncluso) * p.porKmCentavos + Math.max(0, paradasExtras) * (p.porParadaCentavos ?? 0));
}

/** Sem servidor de rotas: a rua dá voltas, então a linha reta vale 1,4 vez. */
export const FATOR_ROTA_ESTIMADA = 1.4;
/** Velocidade média na cidade para estimar o tempo, em km/h. */
export const VELOCIDADE_MEDIA_KMH = 25;

export function rotaEstimada(a: Ponto, b: Ponto): { metros: number; segundos: number } {
  const metros = Math.round(distanciaMetros(a, b) * FATOR_ROTA_ESTIMADA);
  return { metros, segundos: Math.round(metros / ((VELOCIDADE_MEDIA_KMH * 1000) / 3600)) };
}

export const formatarKm = (metros: number) => `${(metros / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: metros < 10_000 ? 1 : 0 })} km`;

export const SEGUNDOS_PARA_ACEITAR_PADRAO = 45;
export const LIMITES_SEGUNDOS_PARA_ACEITAR = { minimo: 20, maximo: 300 };

/** Código que o destinatário informa ao entregador. */
export function gerarCodigoConfirmacao(aleatorio: () => number = Math.random): string {
  return String(Math.floor(aleatorio() * 10_000)).padStart(4, '0');
}

export function normalizarSerie(v: string): string {
  return (v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Contratos ----------------------------------------------------------------------------------

export interface ParadaChamada extends Ponto {
  endereco: string;
  contato: string;
  telefone: string;
  instrucoes: string;
}

/** Parada extra que entrega um pedido (do Flow ou do ERP): pedidos juntos numa chamada. */
export interface ParadaComPedido extends ParadaChamada {
  pedidoId?: string | null;
  pedidoErpId?: string | null;
}

export interface NovaChamada {
  tipo: TipoChamada;
  origem: ParadaChamada;
  destino: ParadaChamada;
  /** Maquininha: o número de série esperado (opcional). */
  serieEsperada: string | null;
  observacao: string;
  /** Vai direto para a distribuição automática; sem valor, vale a regra da empresa. */
  distribuir?: boolean;
  /** Chamada para entregar um Pedido do Flow. */
  pedidoId?: string | null;
  /** Pedido lido do ERP (Entregas > Pedidos do ERP) que esta chamada atende. */
  pedidoErpId?: string | null;
  /** Entregas além do destino, na ordem (só no tipo Entrega). */
  paradasExtras?: ParadaComPedido[];
}

export function problemaNaChamada(c: NovaChamada): string | null {
  if (!TIPOS_CHAMADA.includes(c.tipo)) return 'Escolha o tipo do serviço.';
  for (const [nome, p] of [['coleta', c.origem], ['destino', c.destino]] as const) {
    if (!p || (p.endereco ?? '').trim().length < 5) return `Informe o endereço de ${nome}.`;
    if (typeof p.lat !== 'number' || typeof p.lon !== 'number' || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || (p.lat === 0 && p.lon === 0)) return `Marque o ponto de ${nome} no mapa.`;
  }
  if (distanciaMetros(c.origem, c.destino) < 50) return 'Coleta e destino estão no mesmo lugar.';
  if (distanciaMetros(c.origem, c.destino) > 200_000) return 'Coleta e destino a mais de 200 km: confira os pontos.';
  if (c.serieEsperada && normalizarSerie(c.serieEsperada).length < 4) return 'Número de série muito curto.';
  return null;
}

export interface PreviaChamada {
  metros: number;
  segundos: number;
  estimada: boolean;
  /** Já com os adicionais. */
  valorCentavos: number;
  valorTabelaCentavos: number;
  adicionais: AdicionalAplicado[];
  /** O valor subiu para o mínimo da plataforma. */
  minimoAplicado?: boolean;
}

export interface EventoChamada {
  em: string;
  texto: string;
  /** Quem fez: "empresa", "entregador" ou "sistema". */
  por: 'empresa' | 'entregador' | 'sistema';
}

export interface OfertaResumo {
  id: string;
  chamadaId: string;
  tipo: TipoChamada;
  empresa: string;
  /** Antes do aceite, só a cidade/bairro: o endereço completo vem depois. */
  origemResumo: string;
  destinoResumo: string;
  origem: Ponto;
  destino: Ponto;
  metrosAteColeta: number | null;
  metros: number;
  estimada: boolean;
  valorCentavos: number;
  expiraEm: string;
  /** Quantas entregas (destinos) a chamada tem. */
  entregas?: number;
  /** Por que ele recebeu (distribuição automática). */
  motivo: string | null;
}

export interface ChamadaResumo {
  id: string;
  numero: number;
  tipo: TipoChamada;
  situacao: SituacaoChamada;
  origem: ParadaChamada;
  destino: ParadaChamada;
  metros: number;
  estimada: boolean;
  valorCentavos: number;
  serieEsperada: string | null;
  serieColetada: string | null;
  observacao: string;
  entregador: { id: string; nome: string; veiculo: TipoVeiculo; placa: string | null; celular: string | null } | null;
  /** Posição exata do entregador, só enquanto a chamada está em andamento. */
  posicaoEntregador: (Ponto & { em: string }) | null;
  /** A primeira das pendentes (no modo em grupo podem ser várias, em `ofertas`). */
  ofertaPendente: { entregadorNome: string; expiraEm: string } | null;
  ofertas: OfertaDaChamada[];
  distribuicao: DistribuicaoResumo;
  ocorrencia: { motivo: MotivoOcorrencia; texto: string; em: string; temFoto: boolean; serieLida?: string | null; situacaoAnterior?: SituacaoChamada } | null;
  /** Só para a empresa: o destinatário informa ao entregador. */
  codigoConfirmacao: string | null;
  historico: EventoChamada[];
  criadoEm: string;
  concluidaEm: string | null;
  pedido: { id: string; numero: number } | null;
  extraCentavos: number;
  extraMotivo: string;
  /** Data do pagamento, quando entrou num fechamento. */
  pagoEm: string | null;
  avaliacao: { nota: number; comentario: string; em: string } | null;
  contestacao: { mensagem: string; resposta: string | null; criadoEm: string } | null;
  /** Caminho público do acompanhamento (/rastreio/...), para mandar ao cliente. */
  linkRastreio: string | null;
  emergencia: EmergenciaChamada | null;
  paradasExtras: ParadaExtraResumo[];
  /** 0 = destino principal; 1… = paradas extras. */
  paradaAtual: number;
  adicionais: AdicionalAplicado[];
  /** Etapas com foto guardada (COLETA, ENTREGA, ENTREGA_1…, OCORRENCIA). */
  fotos: string[];
  /** Cancelada depois do aceite: o entregador recebe a taxa de deslocamento (o valor vira a taxa). */
  cancelamentoPago: boolean;
  /** Espera cobrada (já somada ao valor), em minutos além do normal e em centavos. */
  esperaMinutos: number;
  esperaCentavos: number;
  /** Entrega que não deu certo e voltou à origem (o trecho já está somado ao valor). */
  devolucao: DevolucaoChamada | null;
  /** Na devolução: a empresa informa ao entregador quando recebe de volta. */
  codigoDevolucao: string | null;
  checklists: ChecklistsDaChamada;
  /** Chamada aberta a partir de um pedido do ERP. */
  pedidoErp: string | null;
  /** Como o entregador comprova a entrega (copiado da configuração ao abrir). */
  assinatura: ModoAssinatura;
}

/** O que o app do entregador recebe da chamada dele. */
export interface ChamadaEntregador {
  id: string;
  numero: number;
  tipo: TipoChamada;
  situacao: SituacaoChamada;
  empresa: string;
  origem: ParadaChamada;
  destino: ParadaChamada;
  metros: number;
  estimada: boolean;
  valorCentavos: number;
  pedeSerie: boolean;
  serieColetada: string | null;
  observacao: string;
  ocorrencia: { motivo: MotivoOcorrencia; texto: string } | null;
  /** Quando o entregador pediu ajuda nesta chamada. */
  emergenciaEm: string | null;
  /** Todas as entregas, na ordem; `destino` é sempre a atual. */
  destinos?: DestinoDoEntregador[];
  paradaAtual?: number;
  pedeFotoColeta?: boolean;
  pedeFotoEntrega?: boolean;
  aceitaEm: string | null;
  concluidaEm: string | null;
  /** Maquininha: checklist e foto na coleta e na entrega. */
  pedeChecklist?: boolean;
  /** A entrega não deu certo: o destino agora é a origem, e o código vem da empresa. */
  devolvendo?: boolean;
  /** Quando chegou no ponto atual (a espera conta a partir daí). */
  chegouNoPontoEm?: string | null;
  espera?: RegraEspera;
  esperaCentavos?: number;
  /** Assinatura de quem recebe: junto ao código ou no lugar dele. */
  assinatura?: ModoAssinatura;
}

export interface GanhosEntregador {
  hojeCentavos: number;
  semanaCentavos: number;
  /** Concluídas que a empresa ainda não marcou como pagas (fechamento vem na etapa 4). */
  aReceberCentavos: number;
  chamadas: ChamadaEntregador[];
}

export interface ElegivelOferta {
  id: string;
  nome: string;
  veiculo: TipoVeiculo;
  metrosAteColeta: number;
  preferido: boolean;
  /** Pela regra da empresa: pontos (0 a 100) e posição entre os elegíveis. */
  pontos: number;
  posicao: number;
}

/** Endereço do Nominatim é longo: antes do aceite, o entregador vê só o fim (bairro, cidade). */
export function resumoDoEndereco(endereco: string): string {
  // Fora: o que tem número (porta, CEP), o país e as "Região ..." do Nominatim; cidade e estado iguais viram um.
  const partes = (endereco ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p && !/\d/.test(p) && p.toLowerCase() !== 'brasil' && !/^regi[aã]o /i.test(p))
    .filter((p, i, todas) => i === 0 || p.toLowerCase() !== todas[i - 1].toLowerCase());
  return (partes.length > 2 ? partes.slice(-2) : partes.slice(-1)).join(', ');
}

/** Link para abrir a navegação no app de mapas do celular. */
export function linkNavegacao(p: Ponto): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`;
}
