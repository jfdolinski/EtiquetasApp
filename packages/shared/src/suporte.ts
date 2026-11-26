/**
 * Suporte da plataforma (Entregas, etapa 14): a empresa (pelo site) e o entregador (pelo app) abrem
 * chamados para o super-admin, com conversa e situação.
 */

export const CATEGORIAS_SUPORTE = ['APP', 'PAGAMENTO', 'CONTA', 'ENTREGA', 'OUTRO'] as const;
export type CategoriaSuporte = (typeof CATEGORIAS_SUPORTE)[number];

export const ROTULO_CATEGORIA_SUPORTE: Record<CategoriaSuporte, string> = {
  APP: 'Problema no app ou no site',
  PAGAMENTO: 'Pagamento ou diárias',
  CONTA: 'Cadastro e conta',
  ENTREGA: 'Uma chamada ou entrega',
  OUTRO: 'Outro assunto',
};

export const SITUACOES_SUPORTE = ['ABERTO', 'RESPONDIDO', 'RESOLVIDO'] as const;
export type SituacaoSuporte = (typeof SITUACOES_SUPORTE)[number];

/** Do lado de quem abriu. */
export const ROTULO_SITUACAO_SUPORTE: Record<SituacaoSuporte, string> = {
  ABERTO: 'Esperando o suporte',
  RESPONDIDO: 'Respondido',
  RESOLVIDO: 'Resolvido',
};

export type OrigemSuporte = 'EMPRESA' | 'ENTREGADOR';

export const LIMITE_ASSUNTO_SUPORTE = 120;
export const LIMITE_TEXTO_SUPORTE = 2000;
/** Abertos ao mesmo tempo por quem pede (empresa ou entregador). */
export const MAX_CHAMADOS_ABERTOS = 5;

export function problemaNaMensagemDeSuporte(texto: string): string | null {
  const t = (texto ?? '').trim();
  if (t.length < 5) return 'Escreva a mensagem (ao menos 5 letras).';
  if (t.length > LIMITE_TEXTO_SUPORTE) return `A mensagem vai até ${LIMITE_TEXTO_SUPORTE} letras.`;
  return null;
}

export function problemaNoChamado(c: { categoria: string; assunto: string; texto: string }): string | null {
  if (!(CATEGORIAS_SUPORTE as readonly string[]).includes(c.categoria)) return 'Escolha o assunto.';
  const a = (c.assunto ?? '').trim();
  if (a.length < 5 || a.length > LIMITE_ASSUNTO_SUPORTE) return `Resuma o problema no título (de 5 a ${LIMITE_ASSUNTO_SUPORTE} letras).`;
  return problemaNaMensagemDeSuporte(c.texto);
}

/** Responder reabre; o suporte responder marca como respondido. Resolvido só pelo botão. */
export function situacaoDepoisDaMensagem(deSuporte: boolean): SituacaoSuporte {
  return deSuporte ? 'RESPONDIDO' : 'ABERTO';
}

export interface ChamadoSuporteResumo {
  id: string;
  numero: number;
  origem: OrigemSuporte;
  /** Quem abriu: nome do usuário ou do entregador. */
  autor: string;
  empresa: string | null;
  categoria: CategoriaSuporte;
  assunto: string;
  situacao: SituacaoSuporte;
  criadoEm: string;
  atualizadoEm: string;
  /** Mensagens do outro lado ainda não vistas. */
  naoLidas: number;
}

export interface MensagemSuporte {
  id: string;
  deSuporte: boolean;
  autor: string;
  texto: string;
  temImagem: boolean;
  criadoEm: string;
}

export interface ChamadoSuporteDetalhe extends ChamadoSuporteResumo {
  mensagens: MensagemSuporte[];
  /** Só para o super-admin: como falar com quem abriu. */
  contato?: { email: string | null; telefone: string | null };
}
