/**
 * Notificações: a empresa escolhe o que avisa (regras por evento), como avisa (balão do agente
 * no Windows, central do sistema) e quando (dias e horário). Regras nascem desligadas.
 */

export type NivelNotificacao = 'info' | 'aviso' | 'erro';

export const EVENTOS_NOTIFICACAO = [
  {
    codigo: 'sem_etiquetas',
    titulo: 'Sem gerar etiquetas',
    descricao: 'Ninguém gerou etiqueta nesta empresa há mais tempo que o limite (agendamentos contam).',
    unidade: 'horas',
    limitePadrao: 24,
    nivel: 'aviso',
    repetirPadrao: 240,
  },
  {
    codigo: 'lista_pendente',
    titulo: 'Lista do dia parada',
    descricao: 'A lista de hoje tem produtos esperando impressão, a partir desta quantidade.',
    unidade: 'produtos',
    limitePadrao: 1,
    nivel: 'aviso',
    repetirPadrao: 120,
  },
  {
    codigo: 'agente_offline',
    titulo: 'Agente fora do ar',
    descricao: 'Um agente ativado está sem conexão há mais tempo que o limite. O aviso chega aos outros agentes e à central.',
    unidade: 'minutos',
    limitePadrao: 15,
    nivel: 'erro',
    repetirPadrao: 120,
  },
  {
    codigo: 'tela_offline',
    titulo: 'Tela fora do ar',
    descricao: 'Uma tela vinculada está sem aviso há mais tempo que o limite, dentro do horário dela.',
    unidade: 'minutos',
    limitePadrao: 15,
    nivel: 'erro',
    repetirPadrao: 120,
  },
  {
    codigo: 'tela_aprovacao',
    titulo: 'Conteúdo esperando aprovação',
    descricao: 'Um conteúdo das telas foi enviado para aprovação e ninguém decidiu há mais tempo que o limite.',
    unidade: 'minutos',
    limitePadrao: 30,
    nivel: 'aviso',
    repetirPadrao: 240,
  },
  {
    codigo: 'impressao_erro',
    titulo: 'Impressão com erro',
    descricao: 'Um trabalho de impressão das últimas 24 horas terminou com erro e não foi reenviado.',
    unidade: null,
    limitePadrao: 0,
    nivel: 'erro',
    repetirPadrao: 0,
  },
  {
    codigo: 'fila_parada',
    titulo: 'Fila de impressão parada',
    descricao: 'Há trabalho esperando na fila há mais tempo que o limite.',
    unidade: 'minutos',
    limitePadrao: 10,
    nivel: 'aviso',
    repetirPadrao: 60,
  },
  {
    codigo: 'consulta_lenta',
    titulo: 'Consulta SQL lenta',
    descricao: 'Uma consulta demorou mais que o limite na última hora.',
    unidade: 'segundos',
    limitePadrao: 10,
    nivel: 'aviso',
    repetirPadrao: 0,
  },
  {
    codigo: 'consulta_erro',
    titulo: 'Consulta SQL com erro',
    descricao: 'Uma consulta falhou na última hora e não voltou a funcionar.',
    unidade: null,
    limitePadrao: 0,
    nivel: 'erro',
    repetirPadrao: 0,
  },
  {
    codigo: 'agendamento_falha',
    titulo: 'Agendamento com falha',
    descricao: 'A última execução de um agendamento ativo terminou com erro.',
    unidade: null,
    limitePadrao: 0,
    nivel: 'erro',
    repetirPadrao: 0,
  },
] as const satisfies readonly {
  codigo: string;
  titulo: string;
  descricao: string;
  unidade: string | null;
  limitePadrao: number;
  nivel: NivelNotificacao;
  repetirPadrao: number;
}[];

export type EventoNotificacao = (typeof EVENTOS_NOTIFICACAO)[number]['codigo'];

export const CODIGOS_EVENTO: readonly EventoNotificacao[] = EVENTOS_NOTIFICACAO.map((e) => e.codigo);

export interface RegraNotificacaoDados {
  evento: EventoNotificacao;
  ativo: boolean;
  /** Na unidade do evento; ignorado nos eventos sem unidade. */
  limite: number;
  /** Balão do Windows nos computadores com o agente. */
  canalAgente: boolean;
  /** Central de notificações do sistema (sino). */
  canalSistema: boolean;
  /** E-mail para quem pode ver as notificações (exige SMTP configurado). */
  canalEmail: boolean;
  /** Aviso no celular vinculado de quem pode ver as notificações. */
  canalCelular: boolean;
  /** Repete enquanto o problema continuar; 0 = avisa uma vez. */
  repetirMinutos: number;
  /** Agentes que recebem o balão; vazio = todos. */
  agenteIds: string[];
}

export interface JanelaNotificacao {
  /** "HH:MM"; início depois do fim atravessa a meia-noite; iguais = o dia todo. */
  horaInicio: string;
  horaFim: string;
  /** 0 = domingo. */
  diasSemana: number[];
}

export const JANELA_PADRAO: JanelaNotificacao = { horaInicio: '08:00', horaFim: '18:00', diasSemana: [1, 2, 3, 4, 5, 6] };

export interface ConfiguracaoNotificacoes {
  janela: JanelaNotificacao;
  regras: RegraNotificacaoDados[];
  /** O servidor consegue enviar e-mail e push? Sem isso os canais ficam indisponíveis na tela. */
  emailDisponivel?: boolean;
  pushDisponivel?: boolean;
}

export interface NotificacaoResumo {
  id: string;
  evento: string;
  titulo: string;
  mensagem: string;
  nivel: NivelNotificacao;
  vezes: number;
  canalAgente: boolean;
  canalSistema: boolean;
  /** Agentes que confirmaram o último envio. */
  entregues: number;
  criadoEm: string;
  ultimoEnvioEm: string;
  lidaEm: string | null;
  resolvidaEm: string | null;
}

export interface TesteNotificacaoResposta {
  /** Agentes da empresa ativados. */
  agentes: number;
  online: number;
  entregues: number;
  /** Online, mas numa versão que não conhece notificações. */
  desatualizados: number;
  /** Celulares que o Firebase aceitou avisar. */
  celulares: number;
  emailEnviado: boolean;
  /** O que está configurado no servidor para os canais opcionais. */
  emailDisponivel: boolean;
  pushDisponivel: boolean;
}

/** Regra salva por cima do padrão do evento: as que nunca foram salvas ficam desligadas. */
export function regrasComPadrao(salvas: readonly RegraNotificacaoDados[]): RegraNotificacaoDados[] {
  return EVENTOS_NOTIFICACAO.map((e) => {
    const salva = salvas.find((r) => r.evento === e.codigo);
    return salva ?? { evento: e.codigo, ativo: false, limite: e.limitePadrao, canalAgente: true, canalSistema: true, canalEmail: false, canalCelular: false, repetirMinutos: e.repetirPadrao, agenteIds: [] };
  });
}

export function horaValida(h: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(h);
}

function minutos(h: string): number {
  return Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
}

/**
 * Pode avisar agora? `dia` e `hora` no fuso da empresa. Na janela que atravessa a meia-noite,
 * a madrugada pertence ao dia em que a janela abriu.
 */
export function dentroDaJanela(janela: JanelaNotificacao, dia: number, hora: string): boolean {
  const agora = minutos(hora);
  const inicio = minutos(janela.horaInicio);
  const fim = minutos(janela.horaFim);
  if (inicio === fim) return janela.diasSemana.includes(dia);
  if (inicio < fim) return janela.diasSemana.includes(dia) && agora >= inicio && agora < fim;
  if (agora >= inicio) return janela.diasSemana.includes(dia);
  return agora < fim && janela.diasSemana.includes((dia + 6) % 7);
}

/** Dia da semana (0 = domingo) de uma data "AAAA-MM-DD". */
export function diaDaSemana(data: string): number {
  return new Date(`${data}T12:00:00Z`).getUTCDay();
}

/** Problema ainda aberto: já é hora de avisar de novo? */
export function deveRepetir(repetirMinutos: number, ultimoEnvio: Date, agora: Date): boolean {
  return repetirMinutos > 0 && agora.getTime() - ultimoEnvio.getTime() >= repetirMinutos * 60_000;
}

/** "3 horas", "2 dias e 4 h": tempo decorrido para cartões e mensagens. */
export function textoDuracao(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return 'menos de 1 minuto';
  if (min < 60) return min === 1 ? '1 minuto' : `${min} minutos`;
  const h = Math.floor(min / 60);
  if (h < 24) return h === 1 ? '1 hora' : `${h} horas`;
  const d = Math.floor(h / 24);
  const resto = h % 24;
  return (d === 1 ? '1 dia' : `${d} dias`) + (resto ? ` e ${resto} h` : '');
}
