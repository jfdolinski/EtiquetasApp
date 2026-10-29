import type { TipoBanco } from './agente';
import type { FinalidadeConsulta } from './consultas';

/**
 * Cadastro de ERPs (plataforma) e templates de consultas. Ao vincular a empresa a um ERP,
 * as consultas do template são copiadas para a empresa e podem ser ajustadas lá.
 */

/** Mapeamento de campos: coluna que a consulta devolve e de onde vem no ERP. */
export interface CampoEsperado {
  /** Nome da coluna devolvida (apelido no SELECT), ex.: `preco`. */
  campo: string;
  /** Origem no ERP, ex.: `PRODUTOS.PRECO_VENDA`. */
  origem?: string;
  descricao?: string;
}

export interface TemplateConsultaResumo {
  id: string;
  nome: string;
  descricao: string | null;
  finalidade: FinalidadeConsulta;
  sql: string;
  camposEsperados: CampoEsperado[];
  ordem: number;
  atualizadoEm: string;
}

export interface SistemaErpResumo {
  id: string;
  nome: string;
  fabricante: string | null;
  tipoBanco: TipoBanco;
  descricao: string | null;
  ativo: boolean;
  totalConsultas: number;
  totalEmpresas: number;
  atualizadoEm: string;
}

export interface SistemaErpDetalhe extends SistemaErpResumo {
  consultas: TemplateConsultaResumo[];
}

/**
 * Situação da cópia na empresa em relação ao template:
 * - `igual`: idêntica ao que foi copiado e o template não mudou;
 * - `ajustada`: a empresa alterou o SQL;
 * - `template_atualizado`: o template mudou depois da cópia (a empresa não alterou);
 * - `ambos`: a empresa alterou e o template também mudou.
 */
export type SituacaoCopia = 'igual' | 'ajustada' | 'template_atualizado' | 'ambos';

export interface ConsultaTemplateNaEmpresa {
  template: TemplateConsultaResumo;
  copia: { id: string; nome: string; situacao: SituacaoCopia; camposFaltando: string[] } | null;
}

/** Visão do ERP vinculado, para a empresa. */
export interface ErpDaEmpresa {
  sistema: Pick<SistemaErpResumo, 'id' | 'nome' | 'fabricante' | 'tipoBanco' | 'descricao'> | null;
  consultas: ConsultaTemplateNaEmpresa[];
}

export interface CopiarTemplateResposta {
  copiadas: { templateId: string; consultaId: string; nome: string }[];
  /** Ex.: campos que não puderam ser lidos (agente offline), nomes ajustados por conflito. */
  avisos: string[];
}

export function situacaoCopia(hashSqlAtual: string, hashNaCopia: string | null, hashTemplateAtual: string): SituacaoCopia {
  const ajustada = hashSqlAtual !== hashNaCopia;
  const templateMudou = hashTemplateAtual !== hashNaCopia;
  if (ajustada && templateMudou) return 'ambos';
  if (ajustada) return 'ajustada';
  if (templateMudou) return 'template_atualizado';
  return 'igual';
}

export const ROTULO_SITUACAO_COPIA: Record<SituacaoCopia, string> = {
  igual: 'Igual ao template',
  ajustada: 'Ajustada pela empresa',
  template_atualizado: 'Template atualizado',
  ambos: 'Ajustada e template atualizado',
};
