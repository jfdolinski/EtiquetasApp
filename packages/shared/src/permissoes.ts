/**
 * Catálogo de permissões do tenant. É a fonte da verdade: a API sincroniza esta lista
 * com a tabela `permissoes` ao iniciar. Ações de plataforma (gerenciar empresas) não
 * entram aqui; são exclusivas do super-admin.
 */
export const PERMISSOES = [
  { codigo: 'empresa.ver', grupo: 'Empresa', descricao: 'Ver dados da empresa' },
  { codigo: 'usuario.ver', grupo: 'Usuários', descricao: 'Listar usuários' },
  { codigo: 'usuario.editar', grupo: 'Usuários', descricao: 'Criar e editar usuários' },
  { codigo: 'perfil.ver', grupo: 'Perfis', descricao: 'Listar perfis e permissões' },
  { codigo: 'perfil.editar', grupo: 'Perfis', descricao: 'Criar, editar e excluir perfis' },
  { codigo: 'parametros.editar', grupo: 'Parâmetros', descricao: 'Editar parâmetros da empresa' },
  { codigo: 'sql.ver', grupo: 'Consultas SQL', descricao: 'Ver consultas SQL' },
  { codigo: 'sql.editar', grupo: 'Consultas SQL', descricao: 'Editar e testar consultas SQL' },
  { codigo: 'etiqueta.modelo.ver', grupo: 'Etiquetas', descricao: 'Ver modelos de etiqueta' },
  { codigo: 'etiqueta.modelo.editar', grupo: 'Etiquetas', descricao: 'Criar e editar modelos de etiqueta' },
  { codigo: 'impressora.ver', grupo: 'Impressoras', descricao: 'Ver impressoras' },
  { codigo: 'impressora.editar', grupo: 'Impressoras', descricao: 'Cadastrar e editar impressoras' },
  { codigo: 'imprimir', grupo: 'Impressão', descricao: 'Imprimir etiquetas' },
] as const;

export type CodigoPermissao = (typeof PERMISSOES)[number]['codigo'];

export const CODIGOS_PERMISSAO: readonly CodigoPermissao[] = PERMISSOES.map((p) => p.codigo);

export function ehCodigoPermissao(valor: string): valor is CodigoPermissao {
  return (CODIGOS_PERMISSAO as readonly string[]).includes(valor);
}
