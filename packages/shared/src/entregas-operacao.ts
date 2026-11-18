// Entregas, etapa 8: desistência do entregador, taxa de deslocamento no cancelamento, fotos
// obrigatórias, máquinas com cada entregador, rastro da chamada e a ordem das paradas.

import { distanciaMetros, type Ponto, type TipoVeiculo } from './entregas';
import type { SituacaoChamada, TipoChamada } from './entregas-chamadas';

/** O entregador pode desistir antes de pegar a mercadoria; depois disso, só por ocorrência. */
export const SITUACOES_PODE_DESISTIR: readonly SituacaoChamada[] = ['ACEITA', 'NA_COLETA'];
export const podeDesistir = (s: SituacaoChamada) => SITUACOES_PODE_DESISTIR.includes(s);

/** Situações em que a mercadoria (ou a máquina) está com o entregador. */
export const SITUACOES_EM_CUSTODIA: readonly SituacaoChamada[] = ['COLETADA', 'NO_DESTINO', 'OCORRENCIA'];

export interface FotosObrigatorias {
  coleta: boolean;
  entrega: boolean;
}

/** Nome da foto de cada etapa; com várias paradas, a entrega de cada uma tem a sua. */
export function etapaDaFoto(etapa: 'COLETA' | 'ENTREGA', ordem = 0): string {
  return etapa === 'ENTREGA' && ordem > 0 ? `ENTREGA_${ordem}` : etapa;
}

export function rotuloDaFoto(etapa: string): string {
  if (etapa === 'COLETA') return 'Foto da coleta';
  if (etapa === 'OCORRENCIA') return 'Foto da ocorrência';
  if (etapa === 'ENTREGA') return 'Foto da entrega';
  const m = /^ENTREGA_(\d+)$/.exec(etapa);
  return m ? `Foto da entrega na parada ${Number(m[1]) + 1}` : etapa;
}

/** Cancelar depois que alguém aceitou paga a taxa de deslocamento da tabela, se houver. */
export function taxaDoCancelamento(situacao: SituacaoChamada, temEntregador: boolean, taxaCentavos: number | undefined): number {
  if (!temEntregador || situacao === 'ABERTA' || situacao === 'CONCLUIDA' || situacao === 'CANCELADA') return 0;
  return Math.max(0, taxaCentavos ?? 0);
}

// Máquinas com o entregador ---------------------------------------------------------------

export interface MaquinaEmCustodia {
  chamadaId: string;
  numero: number;
  tipo: TipoChamada;
  situacao: SituacaoChamada;
  serie: string;
  coletadaEm: string | null;
  entregador: { id: string; nome: string; veiculo: TipoVeiculo; celular: string };
  /** Minutos desde a última posição; nulo se nunca mandou. */
  semSinalMinutos: number | null;
}

// Rastro ----------------------------------------------------------------------------------

export interface PontoRastro extends Ponto {
  em: string;
}

/** Rastro guardado por esse tempo; depois fica só o resumo (distância e tempos da chamada). */
export const DIAS_RASTRO = 30;

/** Ponto novo só se andou um pouco ou passou tempo: parado na porta não enche o banco. */
export function vaiProRastro(ultimo: { lat: number; lon: number; em: Date } | null, novo: Ponto, agora: Date): boolean {
  if (!ultimo) return true;
  return distanciaMetros(ultimo, novo) >= 25 || agora.getTime() - ultimo.em.getTime() >= 120_000;
}

// Ordem das paradas -------------------------------------------------------------------------

export function comprimentoDoPercurso(origem: Ponto, pontos: Ponto[]): number {
  let total = 0;
  let atual = origem;
  for (const p of pontos) {
    total += distanciaMetros(atual, p);
    atual = p;
  }
  return total;
}

/**
 * Ordem mais curta (em linha reta) a partir da coleta, sem voltar: vizinho mais próximo e depois
 * trocas de trechos (2-opt) até não melhorar. Devolve os índices na nova ordem. `fixarPrimeiro`
 * mantém o índice 0 no começo (o destino de um Pedido, por exemplo).
 */
export function ordemMaisCurta(origem: Ponto, pontos: Ponto[], fixarPrimeiro = false): number[] {
  const n = pontos.length;
  if (n <= 1) return pontos.map((_, i) => i);
  const restantes = new Set(pontos.map((_, i) => i));
  const ordem: number[] = [];
  let atual = origem;
  if (fixarPrimeiro) {
    ordem.push(0);
    restantes.delete(0);
    atual = pontos[0];
  }
  while (restantes.size) {
    let melhor = -1;
    let menor = Infinity;
    for (const i of restantes) {
      const d = distanciaMetros(atual, pontos[i]);
      if (d < menor) {
        menor = d;
        melhor = i;
      }
    }
    ordem.push(melhor);
    restantes.delete(melhor);
    atual = pontos[melhor];
  }
  const custo = (o: number[]) => comprimentoDoPercurso(origem, o.map((i) => pontos[i]));
  let melhorou = true;
  let melhorCusto = custo(ordem);
  for (let voltas = 0; melhorou && voltas < 50; voltas++) {
    melhorou = false;
    for (let i = fixarPrimeiro ? 1 : 0; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const nova = [...ordem.slice(0, i), ...ordem.slice(i, k + 1).reverse(), ...ordem.slice(k + 1)];
        const c = custo(nova);
        if (c + 1e-6 < melhorCusto) {
          ordem.splice(0, n, ...nova);
          melhorCusto = c;
          melhorou = true;
        }
      }
    }
  }
  return ordem;
}

// Senha esquecida do entregador --------------------------------------------------------------

export const caminhoRedefinirSenhaEntregador = (token: string) => `/entregador/redefinir-senha#token=${token}`;
