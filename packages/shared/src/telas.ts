/**
 * Telas (TVs, painéis de LED, projetores e tablets): perfis de resolução por empresa, vínculo por QR,
 * situação dos equipamentos e os parâmetros do módulo. Regras puras, usadas pela API e pelas telas.
 */

export const TIPOS_EQUIPAMENTO = ['TV', 'LED', 'PROJETOR', 'TABLET', 'OUTRO'] as const;
export type TipoEquipamento = (typeof TIPOS_EQUIPAMENTO)[number];

export const ROTULO_EQUIPAMENTO: Record<TipoEquipamento, string> = {
  TV: 'Televisão',
  LED: 'Painel de LED',
  PROJETOR: 'Projetor',
  TABLET: 'Tablet',
  OUTRO: 'Outro',
};

export const NIVEIS_ANIMACAO = ['AUTOMATICO', 'COMPLETO', 'LEVE', 'ESTATICO'] as const;
export type NivelAnimacao = (typeof NIVEIS_ANIMACAO)[number];

export const ROTULO_NIVEL_ANIMACAO: Record<NivelAnimacao, string> = {
  AUTOMATICO: 'Automático, conforme o aparelho aguenta',
  COMPLETO: 'Completo',
  LEVE: 'Leve',
  ESTATICO: 'Só troca de cenas',
};

/** Pontos de partida do cadastro: o usuário pode digitar qualquer medida, como a de um painel de LED. */
export const MODELOS_RESOLUCAO: readonly { nome: string; tipo: TipoEquipamento; largura: number; altura: number }[] = [
  { nome: 'TV Full HD', tipo: 'TV', largura: 1920, altura: 1080 },
  { nome: 'TV 4K', tipo: 'TV', largura: 3840, altura: 2160 },
  { nome: 'TV HD', tipo: 'TV', largura: 1366, altura: 768 },
  { nome: 'TV na vertical', tipo: 'TV', largura: 1080, altura: 1920 },
  { nome: 'Projetor WXGA', tipo: 'PROJETOR', largura: 1280, altura: 800 },
  { nome: 'Projetor Full HD', tipo: 'PROJETOR', largura: 1920, altura: 1080 },
  { nome: 'Tablet', tipo: 'TABLET', largura: 1280, altura: 800 },
  { nome: 'Faixa de LED', tipo: 'LED', largura: 960, altura: 320 },
];

export const RESOLUCAO_MINIMA = 32;
export const RESOLUCAO_MAXIMA = 16384;

export function resolucaoValida(largura: number, altura: number): boolean {
  const ok = (n: number) => Number.isInteger(n) && n >= RESOLUCAO_MINIMA && n <= RESOLUCAO_MAXIMA;
  return ok(largura) && ok(altura);
}

export type FamiliaFormato = 'VERTICAL' | 'QUASE_QUADRADO' | 'HORIZONTAL' | 'FAIXA';

export const ROTULO_FAMILIA: Record<FamiliaFormato, string> = {
  VERTICAL: 'Vertical',
  QUASE_QUADRADO: '4:3 ou 16:10',
  HORIZONTAL: 'Horizontal',
  FAIXA: 'Faixa larga',
};

/** O layout depende do formato, não da resolução: 1920×1080 e 3840×2160 usam o mesmo. */
export function familiaDoFormato(largura: number, altura: number): FamiliaFormato {
  const r = largura / altura;
  if (r < 1) return 'VERTICAL';
  if (r < 1.7) return 'QUASE_QUADRADO';
  if (r <= 2.4) return 'HORIZONTAL';
  return 'FAIXA';
}

// Parâmetros ---------------------------------------------------------------------------------

export interface ParametrosTelas {
  /** Conteúdo só vai ao ar depois de aprovado. */
  aprovacaoObrigatoria: boolean;
  /** Quem criou o conteúdo pode aprová-lo. */
  criadorPodeAprovar: boolean;
  /** O administrador geral pode aprovar o conteúdo da empresa. */
  administradorGeralAprova: boolean;
  imagemTamanhoMaximoMb: number;
  videoTamanhoMaximoMb: number;
  /** Maior altura de vídeo aceita, em pixels. */
  videoAlturaMaxima: number;
  /** Publicidade da plataforma nas telas desta empresa. */
  anunciosLigados: boolean;
  /** A própria empresa pode desligar a publicidade. */
  empresaPodeRecusarAnuncios: boolean;
  /** Parte do tempo das telas reservada à publicidade. */
  fatiaAnunciosPct: number;
  /** Sem aviso há mais que isso, a tela deixa de estar online. */
  minutosOnline: number;
  /** Sem aviso há mais que isso, a tela está offline. */
  minutosOffline: number;
}

export const PARAMETROS_TELAS_PADRAO: ParametrosTelas = {
  aprovacaoObrigatoria: false,
  criadorPodeAprovar: true,
  administradorGeralAprova: false,
  imagemTamanhoMaximoMb: 10,
  videoTamanhoMaximoMb: 200,
  videoAlturaMaxima: 1080,
  anunciosLigados: true,
  empresaPodeRecusarAnuncios: false,
  fatiaAnunciosPct: 10,
  minutosOnline: 2,
  minutosOffline: 5,
};

export type ChaveParametroTela = keyof ParametrosTelas;

/** Faixas dos parâmetros numéricos. */
export const LIMITES_PARAMETROS_TELAS: Partial<Record<ChaveParametroTela, readonly [number, number]>> = {
  imagemTamanhoMaximoMb: [1, 10],
  videoTamanhoMaximoMb: [1, 2048],
  videoAlturaMaxima: [240, 4320],
  fatiaAnunciosPct: [0, 50],
  minutosOnline: [1, 60],
  minutosOffline: [2, 1440],
};

/** O que a empresa decide sozinha. O resto é do administrador geral, que pode sobrescrever por empresa. */
export const PARAMETROS_DA_EMPRESA: readonly ChaveParametroTela[] = ['aprovacaoObrigatoria', 'criadorPodeAprovar'];

export const ROTULO_PARAMETRO_TELA: Record<ChaveParametroTela, { titulo: string; ajuda: string; unidade?: string; emVigor: boolean }> = {
  aprovacaoObrigatoria: { titulo: 'Aprovação obrigatória', ajuda: 'O conteúdo só vai ao ar depois de aprovado. Enquanto a tela de aprovação não chega, ligar isto impede publicar.', emVigor: true },
  criadorPodeAprovar: { titulo: 'Quem criou pode aprovar', ajuda: 'Desligado, a aprovação precisa de uma segunda pessoa.', emVigor: false },
  administradorGeralAprova: { titulo: 'Administrador geral aprova', ajuda: 'O administrador geral também pode aprovar o conteúdo da empresa.', emVigor: false },
  imagemTamanhoMaximoMb: { titulo: 'Tamanho máximo de imagem', ajuda: 'Maior arquivo de imagem aceito nas telas. Até 10 MB.', unidade: 'MB', emVigor: true },
  videoTamanhoMaximoMb: { titulo: 'Tamanho máximo de vídeo', ajuda: 'Maior arquivo de vídeo aceito.', unidade: 'MB', emVigor: false },
  videoAlturaMaxima: { titulo: 'Altura máxima de vídeo', ajuda: 'Por exemplo, 1080 para Full HD.', unidade: 'pixels', emVigor: false },
  anunciosLigados: { titulo: 'Publicidade nas telas', ajuda: 'Exibe os anúncios vendidos pela plataforma.', emVigor: false },
  empresaPodeRecusarAnuncios: { titulo: 'Empresa pode recusar publicidade', ajuda: 'Deixa a própria empresa desligar os anúncios.', emVigor: false },
  fatiaAnunciosPct: { titulo: 'Tempo máximo de publicidade', ajuda: 'Parte do tempo da tela reservada aos anúncios.', unidade: '%', emVigor: false },
  minutosOnline: { titulo: 'Online até', ajuda: 'Tempo sem aviso em que a tela ainda conta como online.', unidade: 'minutos', emVigor: true },
  minutosOffline: { titulo: 'Offline depois de', ajuda: 'Tempo sem aviso a partir do qual a tela conta como offline.', unidade: 'minutos', emVigor: true },
};

/** Valor global e sobrescrita da empresa sobre o padrão. O que não for reconhecido é ignorado. */
export function parametrosVigentes(global: unknown, daEmpresa: unknown): ParametrosTelas {
  return { ...PARAMETROS_TELAS_PADRAO, ...somenteConhecidos(global), ...somenteConhecidos(daEmpresa) };
}

function somenteConhecidos(valores: unknown): Partial<ParametrosTelas> {
  if (!valores || typeof valores !== 'object') return {};
  const novo: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valores)) {
    if (k in PARAMETROS_TELAS_PADRAO && typeof v === typeof PARAMETROS_TELAS_PADRAO[k as ChaveParametroTela]) novo[k] = v;
  }
  return novo as Partial<ParametrosTelas>;
}

/** Confere o que foi enviado: `null` em um campo apaga a sobrescrita. Devolve a mensagem de erro, se houver. */
export function problemaNosParametros(valores: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(valores)) {
    if (!(k in PARAMETROS_TELAS_PADRAO)) return `Parâmetro desconhecido: ${k}.`;
    if (v === null) continue;
    const chave = k as ChaveParametroTela;
    const rotulo = ROTULO_PARAMETRO_TELA[chave];
    if (typeof v !== typeof PARAMETROS_TELAS_PADRAO[chave]) return `Valor inválido em “${rotulo.titulo}”.`;
    const limites = LIMITES_PARAMETROS_TELAS[chave];
    if (limites && (!Number.isInteger(v) || (v as number) < limites[0] || (v as number) > limites[1])) {
      return `“${rotulo.titulo}” precisa ficar entre ${limites[0]} e ${limites[1]}.`;
    }
  }
  return null;
}

/** Junta a alteração ao que estava guardado, tirando o que veio como `null`. */
export function aplicarParametros(atuais: unknown, alteracao: Record<string, unknown>): Partial<ParametrosTelas> {
  const novo: Record<string, unknown> = { ...somenteConhecidos(atuais) };
  for (const [k, v] of Object.entries(alteracao)) {
    if (v === null) delete novo[k];
    else novo[k] = v;
  }
  return novo as Partial<ParametrosTelas>;
}

/** Offline não pode vir antes de online, depois de somados global e empresa. */
export function problemaNosPrazos(p: ParametrosTelas): string | null {
  return p.minutosOffline <= p.minutosOnline ? 'O prazo de offline precisa ser maior que o de online.' : null;
}

// Vínculo ------------------------------------------------------------------------------------

/** O caminho aberto pelo QR da tela, lido no aplicativo ou na câmera do celular. */
export const CAMINHO_VINCULAR_TELA = '/telas/vincular';

export function linkDoVinculoDaTela(origem: string, codigo: string): string {
  return `${origem}${CAMINHO_VINCULAR_TELA}#codigo=${codigo}`;
}

/** Aceita o link do QR ou o código digitado, com ou sem o traço. */
export function codigoDoVinculoDaTela(texto: string): string | null {
  const m = /[#?&]codigo=([A-Za-z0-9-]+)/.exec(texto);
  const bruto = (m ? m[1] : texto).replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z0-9]{8}$/.test(bruto) ? bruto : null;
}

export const codigoParaLer = (codigo: string) => `${codigo.slice(0, 4)}-${codigo.slice(4)}`;

// Situação -----------------------------------------------------------------------------------

export type SituacaoTela = 'ONLINE' | 'INSTAVEL' | 'OFFLINE' | 'FORA_DO_HORARIO' | 'AGUARDANDO_VINCULO';

export const ROTULO_SITUACAO_TELA: Record<SituacaoTela, string> = {
  ONLINE: 'Online',
  INSTAVEL: 'Instável',
  OFFLINE: 'Offline',
  FORA_DO_HORARIO: 'Fora do horário',
  AGUARDANDO_VINCULO: 'Sem equipamento',
};

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export const horarioValido = (h: string) => HORA.test(h);

/** Sem horário definido, a tela conta o dia inteiro. O fim pode passar da meia-noite (18:00 às 02:00). */
export function dentroDoHorarioDaTela(inicio: string | null, fim: string | null, agora: string): boolean {
  if (!inicio || !fim || inicio === fim) return true;
  return inicio < fim ? agora >= inicio && agora < fim : agora >= inicio || agora < fim;
}

export interface DadosSituacaoTela {
  vinculada: boolean;
  ultimoContatoEm: string | Date | null;
  horarioInicio: string | null;
  horarioFim: string | null;
}

/** Online quer dizer que o player está rodando, não que a imagem está na tela: a TV pode estar desligada ou em outra entrada. */
export function situacaoDaTela(t: DadosSituacaoTela, agora: Date, horaLocal: string, p: Pick<ParametrosTelas, 'minutosOnline' | 'minutosOffline'>): SituacaoTela {
  if (!t.vinculada) return 'AGUARDANDO_VINCULO';
  const passou = t.ultimoContatoEm ? agora.getTime() - new Date(t.ultimoContatoEm).getTime() : Infinity;
  if (passou <= p.minutosOnline * 60_000) return 'ONLINE';
  if (!dentroDoHorarioDaTela(t.horarioInicio, t.horarioFim, horaLocal)) return 'FORA_DO_HORARIO';
  return passou < p.minutosOffline * 60_000 ? 'INSTAVEL' : 'OFFLINE';
}

export interface ResolucaoDetectada {
  largura: number | null;
  altura: number | null;
}

/** A TV 4K costuma informar 1920×1080 ao navegador: mesmo formato não é problema, só formato diferente é. */
export function resolucaoConfere(perfil: { largura: number; altura: number }, detectada: ResolucaoDetectada): boolean {
  if (!detectada.largura || !detectada.altura) return true;
  return Math.abs(perfil.largura / perfil.altura - detectada.largura / detectada.altura) < 0.03;
}

// Contratos ----------------------------------------------------------------------------------

export interface PerfilTelaResumo {
  id: string;
  nome: string;
  tipo: TipoEquipamento;
  largura: number;
  altura: number;
  margemPct: number;
  nivelAnimacao: NivelAnimacao;
  telas: number;
}

export interface TelaResumo {
  id: string;
  nome: string;
  local: string | null;
  perfil: { id: string; nome: string; tipo: TipoEquipamento; largura: number; altura: number };
  situacao: SituacaoTela;
  ultimoContatoEm: string | null;
  larguraDetectada: number | null;
  alturaDetectada: number | null;
  escalaDetectada: number | null;
  navegador: string | null;
  versaoPlayer: string | null;
  /** A página está em segundo plano no aparelho. */
  emSegundoPlano: boolean;
  horarioInicio: string | null;
  horarioFim: string | null;
  resolucaoConfere: boolean;
  quedas30Dias: number;
}

export interface QuedaTelaResumo {
  inicio: string;
  fim: string;
}

export interface PedidoTelaCriado {
  codigo: string;
  segredo: string;
  expiraEm: string;
}

export type SituacaoPedidoTela = { situacao: 'AGUARDANDO' } | { situacao: 'VENCIDO' } | { situacao: 'VINCULADA'; token: string };

export interface PedidoTelaLido {
  largura: number;
  altura: number;
  escala: number | null;
  navegador: string | null;
  expiraEm: string;
  /** Perfil da empresa com essa mesma resolução. */
  perfilSugeridoId: string | null;
}

export type ComandoTela = 'IDENTIFICAR' | 'RECARREGAR';

export interface RespostaAvisoTela {
  tela: { nome: string; local: string | null };
  perfil: { largura: number; altura: number; tipo: TipoEquipamento; margemPct: number; nivelAnimacao: NivelAnimacao };
  comando: ComandoTela | null;
  /** Mudou: a tela busca a programação de novo. */
  versaoProgramacao: string;
  /** Hora do servidor: o relógio da TV pode estar errado. */
  agora: string;
}

export interface ParametrosTelasResposta {
  vigentes: ParametrosTelas;
  /** Valores do administrador geral; só vem para ele. */
  global: Partial<ParametrosTelas> | null;
  daEmpresa: Partial<ParametrosTelas>;
  /** O que este usuário pode mudar na empresa. */
  editaveis: ChaveParametroTela[];
}

export const INTERVALO_AVISO_TELA_S = 30;
export const INTERVALO_PEDIDO_TELA_S = 3;
export const VERSAO_PLAYER_TELA = '2';
