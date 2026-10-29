import type { LayoutEtiqueta } from './etiquetas/tipos';

/** Registro de auditoria como exibido na tela. */
export interface LogAuditoriaResumo {
  id: string;
  criadoEm: string;
  acao: string;
  entidade: string;
  entidadeId: string | null;
  detalhes: unknown;
  usuario: { id: string; nome: string; email: string } | null;
  /** Só na visão da plataforma (super-admin). */
  empresa: { id: string; nome: string } | null;
}

export interface PaginaAuditoria {
  itens: LogAuditoriaResumo[];
  /** Cursor para a próxima página (null = fim). */
  proximo: string | null;
}

/** Grupos de ação para o filtro (prefixo da ação). */
export const GRUPOS_ACAO: { prefixo: string; rotulo: string }[] = [
  { prefixo: 'auth.', rotulo: 'Acesso' },
  { prefixo: 'usuario.', rotulo: 'Usuários' },
  { prefixo: 'perfil.', rotulo: 'Perfis' },
  { prefixo: 'empresa.', rotulo: 'Empresa' },
  { prefixo: 'agente.', rotulo: 'Agentes' },
  { prefixo: 'conexao.', rotulo: 'Bancos de dados' },
  { prefixo: 'consulta.', rotulo: 'Consultas SQL' },
  { prefixo: 'modelo.', rotulo: 'Modelos de etiqueta' },
  { prefixo: 'impressora.', rotulo: 'Impressoras' },
  { prefixo: 'impressao.', rotulo: 'Impressão' },
  { prefixo: 'lista.', rotulo: 'Lista do dia' },
  { prefixo: 'assinatura.', rotulo: 'Assinatura' },
  { prefixo: 'cobranca.', rotulo: 'Cobrança' },
  { prefixo: 'erp.', rotulo: 'Sistemas ERP' },
];

/** Arquivo de exportação de modelo (portável entre empresas). */
export interface ModeloExportado {
  formato: 'etiquetas.modelo';
  versao: 1;
  exportadoEm: string;
  nome: string;
  descricao: string | null;
  layout: LayoutEtiqueta;
  /** Consulta de origem: usada para tentar vincular a consulta equivalente no destino. */
  consulta: { nome: string; templateConsultaId: string | null } | null;
}

export interface CopiaModeloResultado {
  empresaId: string;
  empresaNome: string;
  modeloId: string | null;
  nome: string | null;
  /** Ex.: consulta não encontrada no destino, nome ajustado. */
  avisos: string[];
  erro: string | null;
}
