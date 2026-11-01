/** Dashboard técnico da página Início. */

export const PERIODOS_PAINEL = [1, 7, 30] as const;

export interface PainelEmpresa {
  dias: number;
  geradoEm: string;
  uso: {
    /** Última etiqueta gerada (qualquer origem, sem as canceladas). */
    ultimaEm: string | null;
    ultimoModelo: string | null;
    ultimoAutor: string | null;
    /** Última gerada por uma pessoa (lista do dia ou avulsa): agendamento não conta. */
    ultimaManualEm: string | null;
  };
  impressao: {
    etiquetasConcluidas: number;
    trabalhosConcluidos: number;
    etiquetasHoje: number;
    /** Agora na fila, sem depender do período. */
    trabalhosPendentes: number;
    etiquetasPendentes: number;
    trabalhosComErro: number;
    trabalhosCancelados: number;
    porOrigem: { origem: string; etiquetas: number }[];
    /** Um por dia do período, inclusive os zerados, no fuso da plataforma. */
    porDia: { dia: string; etiquetas: number }[];
    porModelo: { nome: string; etiquetas: number }[];
    porImpressora: { nome: string; etiquetas: number; erros: number }[];
  };
  agentes: {
    online: number;
    offline: number;
    aguardandoAtivacao: number;
    lista: { id: string; nome: string; online: boolean; versao: string | null; hostname: string | null; ultimoContatoEm: string | null }[];
  };
  consultas: {
    cadastradas: number;
    execucoes: number;
    falhas: number;
    mediaMs: number | null;
    p95Ms: number | null;
    maximoMs: number | null;
    maisLentas: { nome: string; execucoes: number; mediaMs: number; maximoMs: number; falhas: number }[];
    ultimaFalha: { nome: string; erro: string; em: string } | null;
  };
  cadastros: {
    modelos: { ativos: number; inativos: number; naLista: number; semImpressora: number; semConsulta: number };
    conexoes: { ativas: number; inativas: number; porTipo: { tipo: string; quantidade: number }[] };
    impressoras: { ativas: number; inativas: number; semUso: number };
    agendamentos: { automaticos: number; manuais: number; inativos: number; comFalha: number };
    banidos: number;
  };
  listaHoje: { pendentes: number; naFila: number; impressos: number; descartados: number };
  notificacoesAbertas: number;
  /** Para cobrar quem não usa: todos os usuários ativos, de quem está há mais tempo sem imprimir. */
  usuarios: { id: string; nome: string; etiquetas: number; trabalhos: number; ultimaImpressaoEm: string | null; ultimoLoginEm: string | null }[];
}

/** Visão do super-admin: uma linha por empresa, de quem está há mais tempo sem gerar. */
export interface PainelPlataformaLinha {
  id: string;
  nome: string;
  statusAssinatura: string;
  agentesOnline: number;
  agentesTotal: number;
  etiquetas: number;
  trabalhosComErro: number;
  ultimaEtiquetaEm: string | null;
  ultimoLoginEm: string | null;
}
