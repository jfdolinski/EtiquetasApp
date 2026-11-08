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
  { codigo: 'tela.ver', grupo: 'Telas', descricao: 'Ver as telas e se estão online' },
  { codigo: 'tela.editar', grupo: 'Telas', descricao: 'Vincular e configurar telas, perfis de resolução e parâmetros' },
  { codigo: 'sql.ver', grupo: 'Consultas SQL', descricao: 'Ver consultas SQL' },
  { codigo: 'sql.editar', grupo: 'Consultas SQL', descricao: 'Editar e testar consultas SQL' },
  { codigo: 'etiqueta.modelo.ver', grupo: 'Etiquetas', descricao: 'Ver modelos de etiqueta' },
  { codigo: 'etiqueta.modelo.editar', grupo: 'Etiquetas', descricao: 'Criar e editar modelos de etiqueta' },
  { codigo: 'impressora.ver', grupo: 'Impressoras', descricao: 'Ver impressoras' },
  { codigo: 'impressora.editar', grupo: 'Impressoras', descricao: 'Cadastrar e editar impressoras' },
  { codigo: 'imprimir', grupo: 'Impressão', descricao: 'Imprimir etiquetas' },
  { codigo: 'agendamento.ver', grupo: 'Agendamentos', descricao: 'Ver agendamentos de modelos' },
  { codigo: 'agendamento.editar', grupo: 'Agendamentos', descricao: 'Criar, editar, executar e excluir agendamentos (inclusive com impressão automática)' },
  { codigo: 'produto_banido.ver', grupo: 'Produtos banidos', descricao: 'Ver os produtos banidos' },
  { codigo: 'produto_banido.editar', grupo: 'Produtos banidos', descricao: 'Banir e liberar produtos' },
  { codigo: 'auditoria.ver', grupo: 'Auditoria', descricao: 'Consultar o registro de auditoria da empresa' },
  { codigo: 'painel.ver', grupo: 'Painel', descricao: 'Ver o painel técnico e o uso por usuário na página Início' },
  { codigo: 'notificacao.ver', grupo: 'Notificações', descricao: 'Ver as notificações da empresa' },
  { codigo: 'notificacao.editar', grupo: 'Notificações', descricao: 'Escolher o que e como notificar' },
  { codigo: 'app.aprovar', grupo: 'Aplicativo', descricao: 'Aprovar e descartar a lista do dia pelo celular (também exige Imprimir etiquetas)' },
  { codigo: 'post.ver', grupo: 'Posts', descricao: 'Ver e baixar os posts para redes sociais' },
  { codigo: 'post.editar', grupo: 'Posts', descricao: 'Criar e editar posts, galeria de imagens e marca da empresa' },
  { codigo: 'post.edicao_livre', grupo: 'Posts', descricao: 'Mover e redimensionar os elementos da arte do post' },
] as const;

export type CodigoPermissao = (typeof PERMISSOES)[number]['codigo'];

export const CODIGOS_PERMISSAO: readonly CodigoPermissao[] = PERMISSOES.map((p) => p.codigo);

export function ehCodigoPermissao(valor: string): valor is CodigoPermissao {
  return (CODIGOS_PERMISSAO as readonly string[]).includes(valor);
}
