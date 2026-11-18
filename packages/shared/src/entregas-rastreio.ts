// Entregas, etapa 5: link de acompanhamento do destinatário, emergência e comprovante.
// Regras puras; a página pública é /rastreio/<codigo> (como /loja/pedido/<codigo>).

import { distanciaMetros, type ConfigMapa, type Ponto, type TipoVeiculo } from './entregas';
import type { ParadaChamada, SituacaoChamada, TipoChamada } from './entregas-chamadas';

export const caminhoRastreio = (codigo: string) => `/rastreio/${codigo}`;

/** Depois de concluída ou cancelada, a página ainda mostra o resultado por esse tempo, e então some. */
export const HORAS_RASTREIO_DEPOIS_DE_TERMINAR = 48;

/**
 * Onde está o cliente que acompanha: na entrega, o destino; na coleta e na devolução da máquina,
 * a origem (o entregador vai buscar com ele e leva para a empresa).
 */
export function pontoDoCliente(tipo: TipoChamada, origem: ParadaChamada, destino: ParadaChamada): ParadaChamada {
  return tipo === 'ENTREGA' ? destino : origem;
}

/** A posição do entregador aparece só no trecho até o cliente. */
export function mostraPosicaoAoCliente(tipo: TipoChamada, situacao: SituacaoChamada): boolean {
  return tipo === 'ENTREGA' ? situacao === 'COLETADA' : situacao === 'ACEITA';
}

/** O código só serve na entrega: o destinatário passa ao entregador. */
export function mostraCodigoAoCliente(tipo: TipoChamada, situacao: SituacaoChamada): boolean {
  return tipo === 'ENTREGA' && situacao !== 'CONCLUIDA' && situacao !== 'CANCELADA';
}

/** Velocidade média na cidade, em km/h, para a previsão (a rota real costuma ser 1,4 vez a linha reta). */
export const VELOCIDADE_POR_VEICULO_KMH: Record<TipoVeiculo, number> = { MOTO: 25, CARRO: 20, BICICLETA: 13, A_PE: 4.5 };
const FATOR_ROTA = 1.4;

export function previsaoMinutos(de: Ponto, ate: Ponto, veiculo: TipoVeiculo): number {
  const km = (distanciaMetros(de, ate) * FATOR_ROTA) / 1000;
  return Math.max(1, Math.round((km / VELOCIDADE_POR_VEICULO_KMH[veiculo]) * 60));
}

/** Frase da situação para quem recebe (não para a empresa). */
export function textoParaCliente(tipo: TipoChamada, situacao: SituacaoChamada): string {
  const entrega = tipo === 'ENTREGA';
  switch (situacao) {
    case 'ABERTA':
      return 'Procurando um entregador';
    case 'ACEITA':
      return entrega ? 'O entregador está indo buscar o seu pedido' : 'O entregador está a caminho';
    case 'NA_COLETA':
      return entrega ? 'O entregador está retirando o seu pedido' : 'O entregador chegou';
    case 'COLETADA':
      return entrega ? 'Saiu para entrega' : 'Coletado, a caminho da empresa';
    case 'NO_DESTINO':
      return entrega ? 'O entregador chegou' : 'Entregue na empresa, aguardando conferência';
    case 'CONCLUIDA':
      return entrega ? 'Entregue' : 'Concluído';
    case 'OCORRENCIA':
      return 'Houve um imprevisto; a empresa vai entrar em contato';
    default:
      return 'Cancelado';
  }
}

/** A entrega não deu certo e a empresa pediu a volta à origem. */
export const TEXTO_DEVOLVIDO_AO_CLIENTE = 'Não foi possível entregar; o pedido voltou para a empresa';

export interface RastreioPublico {
  numero: number;
  tipo: TipoChamada;
  situacao: SituacaoChamada;
  texto: string;
  empresa: string;
  /** Primeiro nome, veículo e placa, depois que alguém aceitou. */
  entregador: { nome: string; veiculo: TipoVeiculo; placa: string | null; temFoto: boolean } | null;
  pontoCliente: Ponto;
  /** Só no trecho até o cliente. */
  posicao: (Ponto & { em: string }) | null;
  previsaoMinutos: number | null;
  /** Só na entrega, até concluir: o destinatário informa ao entregador. */
  codigoConfirmacao: string | null;
  concluidaEm: string | null;
  atualizadoEm: string;
  mapa: ConfigMapa;
  /** Com várias paradas: qual é a deste link. */
  parada: { ordem: number; total: number } | null;
}

/** O que o acompanhamento do pedido mostra da entrega dele. */
export interface EntregaDoPedidoPublica {
  caminho: string;
  texto: string;
  entregadorNome: string | null;
}

// Emergência ---------------------------------------------------------------------------------

export interface EmergenciaChamada {
  em: string;
  posicao: Ponto | null;
  texto: string;
  /** A empresa marcou como ciente. */
  vistaEm: string | null;
  vistaPor: string | null;
}

export const LIMITE_TEXTO_EMERGENCIA = 300;
