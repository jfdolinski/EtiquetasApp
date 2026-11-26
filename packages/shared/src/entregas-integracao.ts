import type { SituacaoChamada, TipoChamada } from './entregas-chamadas';

/**
 * Entregas, etapa 14: API para o sistema da própria empresa abrir chamadas, ver a situação e
 * receber avisos (webhook). Manual em docs/API-ENTREGAS.md.
 */

export const PREFIXO_CHAVE_API = 'flw_';
export const PREFIXO_SEGREDO_WEBHOOK = 'whsec_';
export const MAX_CHAVES_API = 10;
/** Tentativas de cada aviso: logo, 1 min, 5 min, 30 min, 2 h e 6 h depois. */
export const ESPERAS_WEBHOOK_MS = [0, 60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];
export const MAX_TENTATIVAS_WEBHOOK = ESPERAS_WEBHOOK_MS.length;

/** Espera antes da próxima tentativa, ou null quando acabaram. */
export function esperaDoWebhook(tentativasFeitas: number): number | null {
  return tentativasFeitas < MAX_TENTATIVAS_WEBHOOK ? ESPERAS_WEBHOOK_MS[tentativasFeitas] : null;
}

/** IPv4 e IPv6 de rede interna, local ou reservada: o aviso nunca vai para eles. */
export function ipPrivado(ip: string): boolean {
  const v = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapeado) return ipPrivado(mapeado[1]);
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (!v.includes(':')) return false;
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}

/** Endereço do webhook: só HTTPS, sem usuário e senha, sem rede interna escrita no endereço. */
export function problemaNoWebhook(url: string | null | undefined): string | null {
  const texto = (url ?? '').trim();
  if (!texto) return null;
  if (texto.length > 500) return 'O endereço do aviso vai até 500 letras.';
  let u: URL;
  try {
    u = new URL(texto);
  } catch {
    return 'Endereço do aviso inválido.';
  }
  if (u.protocol !== 'https:') return 'O endereço do aviso precisa começar com https://.';
  if (u.username || u.password) return 'Não ponha usuário e senha no endereço do aviso.';
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || ipPrivado(host)) return 'O endereço do aviso precisa ser público na internet.';
  return null;
}

export interface ChaveApiResumo {
  id: string;
  nome: string;
  /** Começo da chave, para reconhecer (a chave inteira só aparece ao criar). */
  prefixo: string;
  webhookUrl: string | null;
  criadoEm: string;
  criadoPor: string | null;
  ultimoUsoEm: string | null;
  revogadaEm: string | null;
  /** Avisos dos últimos 7 dias. */
  avisos: { enviados: number; falharam: number; esperando: number };
}

export interface ChaveApiCriada {
  chave: ChaveApiResumo;
  token: string;
  /** Para conferir a assinatura dos avisos; só aparece agora. */
  segredoWebhook: string;
}

export interface EnvioWebhookResumo {
  id: string;
  evento: string;
  numero: number | null;
  situacao: string | null;
  criadoEm: string;
  tentativas: number;
  enviadoEm: string | null;
  falhouEm: string | null;
  ultimoStatus: number | null;
  ultimoErro: string | null;
}

/** Endereço de cada ponto pela API: sem lat/lon, o Flow procura pelo endereço. */
export interface ParadaIntegracao {
  endereco: string;
  lat?: number | null;
  lon?: number | null;
  contato?: string;
  telefone?: string;
  instrucoes?: string;
}

export interface NovaChamadaIntegracao {
  /** O número do pedido no seu sistema: a mesma referência nunca abre duas chamadas. */
  referencia?: string | null;
  tipo?: TipoChamada;
  /** Sem origem, sai do ponto de partida da empresa. */
  origem?: ParadaIntegracao | null;
  destino: ParadaIntegracao;
  paradas?: ParadaIntegracao[];
  observacao?: string;
  valorDeclaradoCentavos?: number | null;
  agendadaPara?: string | null;
  /** Sem valor, vale a regra da empresa (Direcionamento). */
  distribuir?: boolean;
}

export const LIMITE_REFERENCIA = 60;

export function referenciaLimpa(r: string | null | undefined): string | null {
  const t = (r ?? '').trim();
  return t ? t.slice(0, LIMITE_REFERENCIA) : null;
}

export interface ChamadaIntegracao {
  id: string;
  numero: number;
  referencia: string | null;
  tipo: TipoChamada;
  situacao: SituacaoChamada;
  /** A frase que o cliente vê no acompanhamento. */
  situacaoTexto: string;
  valorCentavos: number;
  /** 0 = destino principal; 1… = paradas. */
  paradaAtual: number;
  paradas: number;
  entregador: { nome: string; veiculo: string; placa: string | null } | null;
  /** O código que o cliente informa ao receber (null quando a empresa usa só a assinatura). */
  codigoConfirmacao: string | null;
  rastreio: string | null;
  criadaEm: string;
  coletadaEm: string | null;
  concluidaEm: string | null;
}

export type EventoWebhook = 'chamada.situacao' | 'teste';

export interface CorpoWebhook {
  evento: EventoWebhook;
  id: string;
  enviadoEm: string;
  chamada: ChamadaIntegracao | null;
}
