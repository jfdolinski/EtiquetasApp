// Entregas, etapa 13: várias coletas na mesma chamada, escala de turnos, avaliação da empresa pelo
// entregador, valor declarado e avaria/extravio com desconto acertado no fechamento. Regras puras;
// valores em centavos. O app do entregador tem cópias conferidas em entregas-app.test.ts.

import { distanciaMetros } from './entregas';
import type { ParadaChamada } from './entregas-chamadas';

// Várias coletas -----------------------------------------------------------------------------

/** Além da coleta principal (a origem), até 4 lugares para pegar antes de entregar (só na Entrega). */
export const MAX_COLETAS_EXTRAS = 4;

/** Uma coleta além da primeira, como fica guardada na chamada. */
export interface ColetaExtra {
  parada: ParadaChamada;
  coletadaEm: string | null;
  volumes: number | null;
}

/** Todas as coletas, na ordem, para o app do entregador (0 = a origem). */
export interface ColetaDoEntregador {
  ordem: number;
  parada: ParadaChamada;
  coletada: boolean;
}

export function problemaNasColetas(tipo: string, coletas: ParadaChamada[] | null | undefined): string | null {
  const lista = coletas ?? [];
  if (!lista.length) return null;
  if (tipo !== 'ENTREGA') return 'Várias coletas só na entrega.';
  if (lista.length > MAX_COLETAS_EXTRAS) return `No máximo ${MAX_COLETAS_EXTRAS} coletas além da primeira.`;
  for (const [i, p] of lista.entries()) {
    if (!p || (p.endereco ?? '').trim().length < 5) return `Informe o endereço da coleta ${i + 2}.`;
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || (p.lat === 0 && p.lon === 0) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return `Marque a coleta ${i + 2} no mapa.`;
  }
  return null;
}

/** Depois de coletar: se falta outra coleta, a chamada volta a "a caminho da coleta" com a próxima. */
export function aposColetar(coletaAtual: number, totalDeColetas: number): { ultima: boolean; proxima: number } {
  const ultima = coletaAtual >= totalDeColetas - 1;
  return { ultima, proxima: ultima ? coletaAtual : coletaAtual + 1 };
}

/** O ponto da coleta da vez: 0 = a origem; 1… = as extras. */
export function coletaDaVez(origem: ParadaChamada, extras: ColetaExtra[], coletaAtual: number): ParadaChamada {
  return coletaAtual > 0 && extras[coletaAtual - 1] ? extras[coletaAtual - 1].parada : origem;
}

export function coletasDoEntregador(origem: ParadaChamada, extras: ColetaExtra[], coletaAtual: number, jaColetou: boolean): ColetaDoEntregador[] {
  return [
    { ordem: 0, parada: origem, coletada: jaColetou || coletaAtual > 0 },
    ...extras.map((c, i) => ({ ordem: i + 1, parada: c.parada, coletada: jaColetou || !!c.coletadaEm })),
  ];
}

// Escala de turnos ---------------------------------------------------------------------------

export const MAX_HORAS_TURNO = 12;
export const MIN_MINUTOS_TURNO = 60;
export const MAX_DIAS_TURNO_A_FRENTE = 30;
export const MAX_VAGAS_TURNO = 50;
export const LIMITE_VALOR_TURNO_CENTAVOS = 100_000;
/** O entregador sai do turno até esse tempo antes do início; depois, só a empresa tira. */
export const HORAS_PARA_SAIR_DO_TURNO = 2;
/** Turnos de empresas com a base até essa distância aparecem para o entregador. */
export const RAIO_TURNOS_KM = 40;

export interface NovoTurno {
  /** ISO */
  inicio: string;
  fim: string;
  vagas: number;
  /** Pago a cada entregador presente, além das chamadas (0 = só a prioridade). */
  valorCentavos: number;
  observacao: string;
}

export function problemaNoTurno(t: NovoTurno, agora: Date): string | null {
  const inicio = Date.parse(t.inicio);
  const fim = Date.parse(t.fim);
  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return 'Informe o início e o fim do turno.';
  if (inicio < agora.getTime() - 60_000) return 'O turno não pode começar no passado.';
  if (inicio > agora.getTime() + MAX_DIAS_TURNO_A_FRENTE * 86_400_000) return `Abra turnos até ${MAX_DIAS_TURNO_A_FRENTE} dias à frente.`;
  if (fim - inicio < MIN_MINUTOS_TURNO * 60_000) return 'O turno precisa de pelo menos 1 hora.';
  if (fim - inicio > MAX_HORAS_TURNO * 3_600_000) return `O turno vai até ${MAX_HORAS_TURNO} horas.`;
  if (!Number.isInteger(t.vagas) || t.vagas < 1 || t.vagas > MAX_VAGAS_TURNO) return `As vagas vão de 1 a ${MAX_VAGAS_TURNO}.`;
  if (!Number.isInteger(t.valorCentavos) || t.valorCentavos < 0 || t.valorCentavos > LIMITE_VALOR_TURNO_CENTAVOS) return 'O valor do turno vai de R$ 0,00 a R$ 1.000,00.';
  if ((t.observacao ?? '').length > 300) return 'A observação vai até 300 letras.';
  return null;
}

export const turnoVigente = (t: { inicio: Date | string; fim: Date | string; canceladoEm?: Date | string | null }, agora: Date) =>
  !t.canceladoEm && new Date(t.inicio).getTime() <= agora.getTime() && agora.getTime() < new Date(t.fim).getTime();

export function podeSairDoTurno(inicio: Date | string, agora: Date): boolean {
  return new Date(inicio).getTime() - agora.getTime() >= HORAS_PARA_SAIR_DO_TURNO * 3_600_000;
}

/** Presença só se marca depois que o turno termina. */
export const podeMarcarPresenca = (fim: Date | string, agora: Date) => new Date(fim).getTime() <= agora.getTime();

/** A base da empresa está perto? Empresa sem base aparece para todos. */
export function turnoPerto(base: { lat: number; lon: number } | null, posicao: { lat: number; lon: number } | null): { perto: boolean; metros: number | null } {
  if (!base || !posicao) return { perto: true, metros: null };
  const metros = Math.round(distanciaMetros(base, posicao));
  return { perto: metros <= RAIO_TURNOS_KM * 1000, metros };
}

export const SITUACOES_INSCRICAO = ['INSCRITO', 'SAIU', 'PRESENTE', 'FALTOU'] as const;
export type SituacaoInscricao = (typeof SITUACOES_INSCRICAO)[number];
export const ROTULO_INSCRICAO: Record<SituacaoInscricao, string> = { INSCRITO: 'Inscrito', SAIU: 'Saiu do turno', PRESENTE: 'Presente', FALTOU: 'Faltou' };
/** Ocupam vaga. */
export const INSCRICOES_ATIVAS: readonly SituacaoInscricao[] = ['INSCRITO', 'PRESENTE', 'FALTOU'];

export interface InscritoTurno {
  id: string;
  entregadorId: string;
  nome: string;
  situacao: SituacaoInscricao;
  /** Chamadas desta empresa concluídas durante o turno (ajuda a marcar a presença). */
  chamadas: number;
  pago: boolean;
}

export interface TurnoResumo {
  id: string;
  inicio: string;
  fim: string;
  vagas: number;
  valorCentavos: number;
  observacao: string;
  canceladoEm: string | null;
  inscritos: InscritoTurno[];
}

export interface TurnoParaEntregador {
  id: string;
  empresa: string;
  inicio: string;
  fim: string;
  vagas: number;
  livres: number;
  valorCentavos: number;
  observacao: string;
  /** Da posição dele até a base da empresa; nula sem uma das duas. */
  metros: number | null;
  minha: SituacaoInscricao | null;
  podeSair: boolean;
}

// Avaliação da empresa -----------------------------------------------------------------------

/** O entregador avalia a empresa até esse tempo depois de terminar. */
export const DIAS_PARA_AVALIAR_EMPRESA = 7;
/** Com menos avaliações, a média não aparece (uma nota só diz pouco e identifica quem deu). */
export const MINIMO_AVALIACOES_EMPRESA = 3;

export function podeAvaliarEmpresa(concluidaEm: Date | string | null, agora: Date): boolean {
  if (!concluidaEm) return false;
  const passou = agora.getTime() - new Date(concluidaEm).getTime();
  return passou >= 0 && passou <= DIAS_PARA_AVALIAR_EMPRESA * 86_400_000;
}

/** Média com uma casa, ou nula com poucas avaliações. */
export function mediaDaEmpresa(soma: number, quantidade: number): number | null {
  if (quantidade < MINIMO_AVALIACOES_EMPRESA) return null;
  return Math.round((soma / quantidade) * 10) / 10;
}

export interface ReputacaoEmpresa {
  media: number | null;
  avaliacoes: number;
  /** Sem o nome de quem avaliou. */
  comentarios: { nota: number; comentario: string; em: string }[];
}

export interface EmpresaAvaliada {
  empresaId: string;
  nome: string;
  media: number | null;
  avaliacoes: number;
  /** Notas 1 e 2 nos 90 dias. */
  ruins: number;
}

// Valor declarado e avaria -------------------------------------------------------------------

export const LIMITE_VALOR_DECLARADO_CENTAVOS = 5_000_000;
export const DIAS_PARA_REGISTRAR_AVARIA = 30;
export const MAX_FOTOS_AVARIA = 3;

export function problemaNoValorDeclarado(v: number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (!Number.isInteger(v) || v < 0 || v > LIMITE_VALOR_DECLARADO_CENTAVOS) return 'O valor declarado vai até R$ 50.000,00.';
  return null;
}

export const TIPOS_AVARIA = ['AVARIA', 'EXTRAVIO'] as const;
export type TipoAvaria = (typeof TIPOS_AVARIA)[number];
export const ROTULO_TIPO_AVARIA: Record<TipoAvaria, string> = { AVARIA: 'Avaria (chegou danificado)', EXTRAVIO: 'Extravio (não chegou)' };

export const RESPONSAVEIS_AVARIA = ['ENTREGADOR', 'EMPRESA', 'CLIENTE', 'TERCEIROS'] as const;
export type ResponsavelAvaria = (typeof RESPONSAVEIS_AVARIA)[number];
export const ROTULO_RESPONSAVEL_AVARIA: Record<ResponsavelAvaria, string> = { ENTREGADOR: 'Entregador', EMPRESA: 'Empresa (embalagem, separação)', CLIENTE: 'Cliente', TERCEIROS: 'Terceiros (acidente, roubo)' };

/**
 * SEM_DESCONTO: só fica registrada. AGUARDANDO: a empresa propôs descontar do entregador, que ainda
 * não respondeu. ACEITA: o desconto entra no próximo pagamento. CONTESTADA: o entregador não
 * concordou e nada é descontado (o acerto é fora do Flow). RETIRADA: a empresa desistiu.
 */
export const SITUACOES_AVARIA = ['SEM_DESCONTO', 'AGUARDANDO', 'ACEITA', 'CONTESTADA', 'RETIRADA'] as const;
export type SituacaoAvaria = (typeof SITUACOES_AVARIA)[number];
export const ROTULO_SITUACAO_AVARIA: Record<SituacaoAvaria, string> = {
  SEM_DESCONTO: 'Registrada, sem desconto',
  AGUARDANDO: 'Aguardando o entregador',
  ACEITA: 'Desconto aceito',
  CONTESTADA: 'Contestada pelo entregador',
  RETIRADA: 'Retirada pela empresa',
};

export interface NovaAvaria {
  tipo: TipoAvaria;
  descricao: string;
  prejuizoCentavos: number;
  responsavel: ResponsavelAvaria;
  /** Só quando o responsável é o entregador. */
  descontoCentavos: number;
  /** data URL das fotos (1 a 3). */
  fotos: string[];
}

export function problemaNaAvaria(a: NovaAvaria, valorDeclaradoCentavos: number | null): string | null {
  if (!TIPOS_AVARIA.includes(a.tipo)) return 'Escolha se foi avaria ou extravio.';
  if (!RESPONSAVEIS_AVARIA.includes(a.responsavel)) return 'Escolha o responsável.';
  if ((a.descricao ?? '').trim().length < 5) return 'Descreva o que aconteceu.';
  if ((a.descricao ?? '').length > 500) return 'A descrição vai até 500 letras.';
  if (!Number.isInteger(a.prejuizoCentavos) || a.prejuizoCentavos < 0 || a.prejuizoCentavos > LIMITE_VALOR_DECLARADO_CENTAVOS) return 'O prejuízo vai até R$ 50.000,00.';
  if (!Number.isInteger(a.descontoCentavos) || a.descontoCentavos < 0) return 'Desconto inválido.';
  if (a.descontoCentavos > 0 && a.responsavel !== 'ENTREGADOR') return 'Só dá para descontar do entregador quando ele é o responsável.';
  if (a.descontoCentavos > a.prejuizoCentavos) return 'O desconto não pode passar do prejuízo.';
  if (valorDeclaradoCentavos !== null && a.descontoCentavos > valorDeclaradoCentavos) return 'O desconto não pode passar do valor declarado na chamada.';
  if (!Array.isArray(a.fotos) || a.fotos.length < 1) return 'Mande ao menos uma foto.';
  if (a.fotos.length > MAX_FOTOS_AVARIA) return `No máximo ${MAX_FOTOS_AVARIA} fotos.`;
  return null;
}

export function podeRegistrarAvaria(c: { coletadaEm: Date | string | null; concluidaEm: Date | string | null; entregadorId: string | null }, agora: Date): boolean {
  if (!c.entregadorId || !c.coletadaEm) return false;
  if (!c.concluidaEm) return true;
  return agora.getTime() - new Date(c.concluidaEm).getTime() <= DIAS_PARA_REGISTRAR_AVARIA * 86_400_000;
}

export interface AvariaResumo {
  id: string;
  chamadaId: string;
  numero: number;
  empresa: string;
  entregadorNome: string;
  tipo: TipoAvaria;
  descricao: string;
  prejuizoCentavos: number;
  responsavel: ResponsavelAvaria;
  descontoCentavos: number;
  valorDeclaradoCentavos: number | null;
  situacao: SituacaoAvaria;
  resposta: string | null;
  fotos: number;
  criadoEm: string;
  respondidaEm: string | null;
  /** O desconto já saiu num pagamento (não dá mais para retirar). */
  pago: boolean;
}

// Lançamentos do fechamento ------------------------------------------------------------------

/** Além das chamadas: o valor do turno e o bônus de meta (crédito) e o desconto de avaria aceito (débito). */
export const TIPOS_LANCAMENTO = ['TURNO', 'DESCONTO', 'BONUS'] as const;
export type TipoLancamento = (typeof TIPOS_LANCAMENTO)[number];

export interface LancamentoEntrega {
  id: string;
  tipo: TipoLancamento;
  descricao: string;
  /** Positivo = a receber; negativo = desconto. */
  valorCentavos: number;
  criadoEm: string;
  empresa?: string;
  fechamentoId: string | null;
  pagoEm: string | null;
}

export const somaDosLancamentos = (l: Pick<LancamentoEntrega, 'valorCentavos'>[]) => l.reduce((s, x) => s + x.valorCentavos, 0);

/** Pagamento com desconto maior que o resto não fecha: o entregador nunca fica devendo no Flow. */
export function problemaNoTotalDoPagamento(chamadasCentavos: number, lancamentosCentavos: number, itens: number): string | null {
  if (!itens) return 'Escolha ao menos uma chamada ou lançamento.';
  if (chamadasCentavos + lancamentosCentavos < 0) return 'O desconto passa do valor a pagar: espere mais chamadas ou retire o desconto.';
  return null;
}
