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
  { codigo: 'agente.ver', grupo: 'Agentes e bancos', descricao: 'Ver agentes locais e conexões de banco' },
  {
    codigo: 'agente.editar',
    grupo: 'Agentes e bancos',
    descricao: 'Cadastrar agentes, gerar códigos de ativação e editar conexões de banco',
  },
  { codigo: 'sql.ver', grupo: 'Consultas SQL', descricao: 'Ver consultas SQL' },
  { codigo: 'sql.editar', grupo: 'Consultas SQL', descricao: 'Editar e testar consultas SQL' },
  { codigo: 'etiqueta.modelo.ver', grupo: 'Etiquetas', descricao: 'Ver modelos de etiqueta' },
  { codigo: 'etiqueta.modelo.editar', grupo: 'Etiquetas', descricao: 'Criar e editar modelos de etiqueta' },
  { codigo: 'impressora.ver', grupo: 'Impressoras', descricao: 'Ver impressoras' },
  { codigo: 'impressora.editar', grupo: 'Impressoras', descricao: 'Cadastrar e editar impressoras' },
  { codigo: 'imprimir', grupo: 'Impressão', descricao: 'Imprimir etiquetas' },
  { codigo: 'agendamento.ver', grupo: 'Agendamentos', descricao: 'Ver agendamentos de modelos' },
  { codigo: 'agendamento.editar', grupo: 'Agendamentos', descricao: 'Criar, editar, executar e excluir agendamentos (inclusive com impressão automática)' },
  { codigo: 'auditoria.ver', grupo: 'Auditoria', descricao: 'Consultar o registro de auditoria da empresa' },
] as const;

export type CodigoPermissao = (typeof PERMISSOES)[number]['codigo'];

export const CODIGOS_PERMISSAO: readonly CodigoPermissao[] = PERMISSOES.map((p) => p.codigo);

export function ehCodigoPermissao(valor: string): valor is CodigoPermissao {
  return (CODIGOS_PERMISSAO as readonly string[]).includes(valor);
}
