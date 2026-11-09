/**
 * Conteúdo das telas: uma consulta vira cópia dos dados, que um modelo animado mostra em cenas.
 * A TV nunca fala com o banco do cliente: lê a cópia, que tem prazo de validade, para não mostrar preço velho.
 */
import { dataIsoDe, textoNaTela } from './etiquetas/valores';
import type { Registro } from './etiquetas/tipos';
import { dentroDoHorarioDaTela, familiaDoFormato, horarioValido, type FamiliaFormato, type NivelAnimacao, type ParametrosTelas, type TipoEquipamento } from './telas';
import { formatarPrecoPost } from './posts';

export const MODELOS_CONTEUDO_TELA = ['GRADE_OFERTAS', 'DESTAQUE', 'LISTA_PRECOS', 'IMAGENS'] as const;
export type ModeloConteudoTela = (typeof MODELOS_CONTEUDO_TELA)[number];

export const ROTULO_MODELO_CONTEUDO: Record<ModeloConteudoTela, { titulo: string; ajuda: string }> = {
  GRADE_OFERTAS: { titulo: 'Grade de ofertas', ajuda: 'Vários produtos por cena, em cartões.' },
  DESTAQUE: { titulo: 'Produto em destaque', ajuda: 'Um produto por vez, com o preço bem grande.' },
  LISTA_PRECOS: { titulo: 'Lista de preços', ajuda: 'Uma tabela de nomes e preços, boa para muitos itens.' },
  IMAGENS: { titulo: 'Imagens', ajuda: 'Banners e avisos enviados por você, um por cena.' },
};

/** Só os modelos de produtos dependem de consulta e de cópia dos dados. */
export const modeloUsaConsulta = (m: ModeloConteudoTela) => m !== 'IMAGENS';

export const AJUSTES_IMAGEM_TELA = ['CONTER', 'COBRIR'] as const;
export type AjusteImagemTela = (typeof AJUSTES_IMAGEM_TELA)[number];

export const ROTULO_AJUSTE_IMAGEM: Record<AjusteImagemTela, string> = {
  CONTER: 'Mostrar a imagem inteira (pode sobrar fundo)',
  COBRIR: 'Preencher a tela (pode cortar as bordas)',
};

export interface ImagemNoConteudo {
  imagemId: string;
  segundos: number;
}

export interface ConfigConteudoTela {
  /** Aparece no alto da cena; vazio, a cena usa o espaço para os produtos. */
  titulo: string;
  /** Texto fixo no rodapé, como "Ofertas válidas enquanto durarem os estoques". */
  rodape: string;
  colunaNome: string;
  colunaPreco: string;
  /** Preço anterior. Só aparece riscado quando é maior que o preço atual. */
  colunaPrecoDe: string | null;
  /** Uma informação a mais, como a unidade ou a validade da oferta. */
  colunaDetalhe: string | null;
  segundosPorCena: number;
  corFundo: string;
  corDestaque: string;
  /** Só no modelo de imagens: o que passa, e em que ordem. */
  imagens?: ImagemNoConteudo[];
  ajuste?: AjusteImagemTela;
  /** Mostra a foto do catálogo de cada produto, achada pelo código de barras. */
  comFotos?: boolean;
  colunaCodigo?: string | null;
  /** Só nos modelos de produtos. Imagens da galeria das telas: um banner já traz a arte que quiser. */
  logoImagemId?: string | null;
  fundoImagemId?: string | null;
  /** Quanto a cor de fundo cobre a imagem, em %: é o que mantém nome e preço legíveis. */
  fundoVeu?: number;
}

export const VEUS_FUNDO_TELA = [60, 75, 90] as const;
export const VEU_FUNDO_PADRAO = 75;

export const ROTULO_VEU_FUNDO: Record<(typeof VEUS_FUNDO_TELA)[number], string> = {
  60: 'Imagem mais visível',
  75: 'Equilibrado',
  90: 'Texto em primeiro lugar',
};

export const LIMITES_CONTEUDO_TELA = {
  segundosPorCena: [3, 120],
  intervaloMinutos: [1, 1440],
  validadeMinutos: [5, 10080],
  titulo: 80,
  rodape: 160,
} as const;

/** Até aqui cabe na memória de uma TV barata, e ninguém lê mais que isso em cenas. */
export const MAX_ITENS_CONTEUDO = 200;
export const MAX_IMAGENS_POR_CONTEUDO = 30;
export const MAX_IMAGENS_TELA_POR_EMPRESA = 300;
export const LIMITE_LINHAS_CONTEUDO = 1000;

export const INTERVALO_PADRAO_MINUTOS = 15;
export const VALIDADE_PADRAO_MINUTOS = 120;

export const CONFIG_CONTEUDO_PADRAO: ConfigConteudoTela = {
  titulo: 'Ofertas',
  rodape: '',
  colunaNome: '',
  colunaPreco: '',
  colunaPrecoDe: null,
  colunaDetalhe: null,
  segundosPorCena: 8,
  corFundo: '#0f172a',
  corDestaque: '#facc15',
};

const COR = /^#[0-9a-fA-F]{6}$/;

/** Devolve a mensagem de erro, se houver. As colunas são conferidas à parte, com as da consulta. */
export function problemaNaConfigConteudo(c: ConfigConteudoTela): string | null {
  if (!c.colunaNome.trim()) return 'Escolha a coluna do nome do produto.';
  if (!c.colunaPreco.trim()) return 'Escolha a coluna do preço.';
  if (c.titulo.length > LIMITES_CONTEUDO_TELA.titulo) return `O título pode ter até ${LIMITES_CONTEUDO_TELA.titulo} caracteres.`;
  if (c.rodape.length > LIMITES_CONTEUDO_TELA.rodape) return `O rodapé pode ter até ${LIMITES_CONTEUDO_TELA.rodape} caracteres.`;
  const [min, max] = LIMITES_CONTEUDO_TELA.segundosPorCena;
  if (!Number.isInteger(c.segundosPorCena) || c.segundosPorCena < min || c.segundosPorCena > max) return `O tempo de cada cena precisa ficar entre ${min} e ${max} segundos.`;
  if (!COR.test(c.corFundo) || !COR.test(c.corDestaque)) return 'Cor inválida.';
  if (c.comFotos && !c.colunaCodigo?.trim()) return 'Escolha a coluna do código de barras, usada para achar as fotos.';
  if (c.fundoVeu !== undefined && c.fundoVeu !== null && !(VEUS_FUNDO_TELA as readonly number[]).includes(c.fundoVeu)) return 'Escolha como a imagem de fundo aparece.';
  return null;
}

/** Imagens da galeria de que este conteúdo depende. Olha o modelo: trocar de modelo pode deixar sobra na configuração. */
export function imagensUsadasPeloConteudo(modelo: ModeloConteudoTela, c: Pick<ConfigConteudoTela, 'imagens' | 'logoImagemId' | 'fundoImagemId'>): string[] {
  const ids = modeloUsaConsulta(modelo) ? [c.logoImagemId, c.fundoImagemId] : (c.imagens ?? []).map((i) => i.imagemId);
  return [...new Set(ids.filter((id): id is string => !!id))];
}

/** O título tem a mesma regra: painel pequeno e faixa guardam o espaço para o produto. */
export const formatoMostraLogo = (largura: number, altura: number) => Math.min(largura, altura) >= 200 && familiaDoFormato(largura, altura) !== 'FAIXA';
/** Em painel pequeno, a imagem vira borrão atrás do preço. */
export const formatoMostraFundo = (largura: number, altura: number) => Math.min(largura, altura) >= 200;

/** Só a TV e a pré-visualização usam: as duas montam igual. */
export function aparenciaDoPrograma(modelo: ModeloConteudoTela, c: Pick<ConfigConteudoTela, 'logoImagemId' | 'fundoImagemId' | 'fundoVeu'>): Pick<ProgramaTela, 'logo' | 'fundo'> {
  if (!modeloUsaConsulta(modelo)) return {};
  return {
    ...(c.logoImagemId ? { logo: caminhoImagemTela(c.logoImagemId) } : {}),
    ...(c.fundoImagemId ? { fundo: { url: caminhoImagemTela(c.fundoImagemId), veu: c.fundoVeu ?? VEU_FUNDO_PADRAO } } : {}),
  };
}

/** Devolve a mensagem de erro, se houver. Que as imagens são da empresa, a API confere. */
export function problemaNasImagensDoConteudo(c: Pick<ConfigConteudoTela, 'imagens' | 'ajuste' | 'corFundo'>): string | null {
  const imagens = c.imagens ?? [];
  if (imagens.length === 0) return 'Escolha ao menos uma imagem.';
  if (imagens.length > MAX_IMAGENS_POR_CONTEUDO) return `Um conteúdo pode ter até ${MAX_IMAGENS_POR_CONTEUDO} imagens.`;
  const [min, max] = LIMITES_CONTEUDO_TELA.segundosPorCena;
  for (const i of imagens) {
    if (typeof i?.imagemId !== 'string' || !i.imagemId) return 'Imagem inválida.';
    if (!Number.isInteger(i.segundos) || i.segundos < min || i.segundos > max) return `O tempo de cada imagem precisa ficar entre ${min} e ${max} segundos.`;
  }
  if (c.ajuste && !AJUSTES_IMAGEM_TELA.includes(c.ajuste)) return 'Ajuste de imagem desconhecido.';
  if (!COR.test(c.corFundo)) return 'Cor inválida.';
  return null;
}

/** Validade curta demais tiraria o conteúdo do ar entre duas atualizações normais. */
export function problemaNosPrazosConteudo(intervaloMinutos: number, validadeMinutos: number): string | null {
  const [iMin, iMax] = LIMITES_CONTEUDO_TELA.intervaloMinutos;
  const [vMin, vMax] = LIMITES_CONTEUDO_TELA.validadeMinutos;
  if (!Number.isInteger(intervaloMinutos) || intervaloMinutos < iMin || intervaloMinutos > iMax) return `A atualização precisa ficar entre ${iMin} e ${iMax} minutos.`;
  if (!Number.isInteger(validadeMinutos) || validadeMinutos < vMin || validadeMinutos > vMax) return `A validade precisa ficar entre ${vMin} e ${vMax} minutos.`;
  if (validadeMinutos < intervaloMinutos * 2) return 'A validade precisa ser de pelo menos duas atualizações, para uma falha passageira não tirar o conteúdo do ar.';
  return null;
}

// Dados --------------------------------------------------------------------------------------

export interface ItemConteudoTela {
  nome: string;
  preco: string;
  precoDe?: string;
  detalhe?: string;
  /** Código de barras da linha, só para achar a foto: não vai para a TV. */
  codigo?: string;
  /** Endereço da foto guardada. */
  foto?: string;
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function valorDaColuna(registro: Registro, coluna: string | null): unknown {
  if (!coluna) return undefined;
  const chave = Object.keys(registro).find((c) => c.toLowerCase() === coluna.toLowerCase());
  return chave === undefined ? undefined : registro[chave];
}

function numeroDoPreco(texto: string): number | null {
  const t = texto.replace(/^R\$\s*/i, '').replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return t !== '' && Number.isFinite(n) ? n : null;
}

/** Preço zerado, vazio ou que não é número não vai para a tela: seria um produto "de graça" na vitrine. */
function precoValido(bruto: unknown): string | null {
  const preco = formatarPrecoPost(bruto);
  const numero = numeroDoPreco(preco);
  return numero !== null && numero > 0 ? preco : null;
}

export interface ResultadoItens {
  itens: ItemConteudoTela[];
  /** Linhas deixadas de fora por falta de nome ou de preço. */
  descartados: number;
  /** Havia mais linhas do que cabem. */
  cortados: number;
}

export function itensDoConteudo(registros: Registro[], c: Pick<ConfigConteudoTela, 'colunaNome' | 'colunaPreco' | 'colunaPrecoDe' | 'colunaDetalhe' | 'comFotos' | 'colunaCodigo'>): ResultadoItens {
  const itens: ItemConteudoTela[] = [];
  let descartados = 0;
  let cortados = 0;
  for (const r of registros) {
    const nome = textoNaTela(valorDaColuna(r, c.colunaNome)).trim();
    const preco = precoValido(valorDaColuna(r, c.colunaPreco));
    if (!nome || !preco) {
      descartados++;
      continue;
    }
    if (itens.length >= MAX_ITENS_CONTEUDO) {
      cortados++;
      continue;
    }
    const item: ItemConteudoTela = { nome, preco };
    const de = precoValido(valorDaColuna(r, c.colunaPrecoDe));
    if (de && numeroDoPreco(de)! > numeroDoPreco(preco)!) item.precoDe = de;
    const detalhe = valorDaColuna(r, c.colunaDetalhe);
    if (detalhe !== null && detalhe !== undefined && detalhe !== '') {
      const texto = dataIsoDe(detalhe) ? textoNaTela(detalhe) : String(detalhe).trim();
      if (texto) item.detalhe = texto;
    }
    if (c.comFotos) {
      const codigo = valorDaColuna(r, c.colunaCodigo ?? null);
      if (codigo !== null && codigo !== undefined && codigo !== '') item.codigo = String(codigo).trim();
    }
    itens.push(item);
  }
  return { itens, descartados, cortados };
}

/** Sugestão ao escolher a consulta: os nomes que o sistema já reconhece em outras telas. */
export function colunasSugeridas(colunas: string[]): Pick<ConfigConteudoTela, 'colunaNome' | 'colunaPreco' | 'colunaPrecoDe' | 'colunaCodigo'> {
  const achar = (...regras: RegExp[]) => {
    for (const r of regras) {
      const c = colunas.find((x) => r.test(x));
      if (c) return c;
    }
    return null;
  };
  return {
    colunaNome: achar(/^(descricao|descrição|nome|produto)$/i, /descri|nome|produto/i) ?? '',
    colunaPreco: achar(/^(preco|preço|preco_?(venda|por|oferta)|valor|venda)$/i, /^(pre[cç]o|prc|vlr|valor)(?!.*(custo|compra|de$))/i) ?? '',
    colunaPrecoDe: achar(/^pre[cç]o_?(de|antigo|normal|anterior)$/i),
    colunaCodigo: achar(/ean|gtin|barra|codbar/i),
  };
}

// Cenas --------------------------------------------------------------------------------------

export interface GradeDaCena {
  colunas: number;
  linhas: number;
}

const GRADES: Record<Exclude<ModeloConteudoTela, 'IMAGENS'>, Record<FamiliaFormato, GradeDaCena>> = {
  DESTAQUE: {
    HORIZONTAL: { colunas: 1, linhas: 1 },
    QUASE_QUADRADO: { colunas: 1, linhas: 1 },
    VERTICAL: { colunas: 1, linhas: 1 },
    FAIXA: { colunas: 1, linhas: 1 },
  },
  GRADE_OFERTAS: {
    HORIZONTAL: { colunas: 3, linhas: 2 },
    QUASE_QUADRADO: { colunas: 3, linhas: 2 },
    VERTICAL: { colunas: 2, linhas: 3 },
    FAIXA: { colunas: 3, linhas: 1 },
  },
  LISTA_PRECOS: {
    // Uma coluna só: em duas, o preço anterior espreme o nome do produto até sumir.
    HORIZONTAL: { colunas: 1, linhas: 7 },
    QUASE_QUADRADO: { colunas: 1, linhas: 8 },
    VERTICAL: { colunas: 1, linhas: 12 },
    FAIXA: { colunas: 1, linhas: 2 },
  },
};

export function gradeDaCena(modelo: ModeloConteudoTela, largura: number, altura: number): GradeDaCena {
  if (modelo === 'IMAGENS') return { colunas: 1, linhas: 1 };
  const grade = GRADES[modelo][familiaDoFormato(largura, altura)];
  // Painel pequeno não mostra muita coisa de longe: um item por vez, ou no máximo dois se for bem largo.
  if (Math.min(largura, altura) < 200) return { colunas: largura < 500 ? 1 : Math.min(grade.colunas, 2), linhas: 1 };
  return grade;
}

/** Cena com poucos produtos usa o espaço todo: dois produtos ficam grandes, em vez de num canto da grade. */
export function gradeParaItens(modelo: ModeloConteudoTela, grade: GradeDaCena, quantidade: number): GradeDaCena {
  if (modelo !== 'GRADE_OFERTAS' || quantidade >= grade.colunas * grade.linhas || quantidade < 1) return grade;
  if (grade.linhas === 1) return { colunas: Math.min(quantidade, grade.colunas), linhas: 1 };
  if (grade.colunas >= grade.linhas) {
    // Horizontal: uma fileira enquanto couber, depois duas.
    if (quantidade <= grade.colunas) return { colunas: quantidade, linhas: 1 };
    return { colunas: Math.ceil(quantidade / 2), linhas: 2 };
  }
  // Vertical: empilhados enquanto couber, depois em duas colunas.
  if (quantidade <= grade.linhas) return { colunas: 1, linhas: quantidade };
  return { colunas: 2, linhas: Math.ceil(quantidade / 2) };
}

export function cenasDosItens<T>(itens: T[], grade: GradeDaCena): T[][] {
  const porCena = Math.max(1, grade.colunas * grade.linhas);
  const cenas: T[][] = [];
  for (let i = 0; i < itens.length; i += porCena) cenas.push(itens.slice(i, i + porCena));
  return cenas;
}

/** Sem medir o aparelho: abaixo disso, a animação completa fica aos trancos. */
const QUADROS_PARA_COMPLETO = 40;

export type NivelEfetivo = Exclude<NivelAnimacao, 'AUTOMATICO'>;

export function nivelEfetivo(nivel: NivelAnimacao, quadrosPorSegundo: number | null, tipo?: TipoEquipamento): NivelEfetivo {
  if (nivel !== 'AUTOMATICO') return nivel;
  // Painel de LED costuma ser ligado a um computador simples, e movimento demais incomoda de perto.
  if (tipo === 'LED') return 'LEVE';
  if (quadrosPorSegundo === null) return 'LEVE';
  return quadrosPorSegundo >= QUADROS_PARA_COMPLETO ? 'COMPLETO' : 'LEVE';
}

/** Preto ou branco, o que for mais legível sobre a cor. */
export function corDoTextoSobre(cor: string): '#ffffff' | '#0f172a' {
  return luminanciaDe(rgbDe(cor)) > 0.4 ? '#0f172a' : '#ffffff';
}

const rgbDe = (cor: string) => [1, 3, 5].map((i) => parseInt(cor.slice(i, i + 2), 16));

function luminanciaDe(rgb: number[]): number {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Abaixo disto, até letra grande fica difícil de ler (WCAG, texto grande). */
export const CONTRASTE_MINIMO_SOBRE_FUNDO = 3;

/** O contraste do texto no pior ponto de uma imagem qualquer, toda branca ou toda preta, sob o véu. */
export function contrasteSobreImagem(corFundo: string, veu: number): number {
  const texto = luminanciaDe(rgbDe(corDoTextoSobre(corFundo)));
  const fundo = rgbDe(corFundo);
  return Math.min(
    ...[0, 255].map((imagem) => {
      const mistura = luminanciaDe(fundo.map((c) => (c * veu + imagem * (100 - veu)) / 100));
      return (Math.max(texto, mistura) + 0.05) / (Math.min(texto, mistura) + 0.05);
    }),
  );
}

// Vigência -----------------------------------------------------------------------------------

export interface VigenciaConteudo {
  horarioInicio: string | null;
  horarioFim: string | null;
  dataInicio: string | null;
  dataFim: string | null;
}

export function problemaNaVigencia(v: VigenciaConteudo): string | null {
  if (!!v.horarioInicio !== !!v.horarioFim) return 'Informe o início e o fim do horário.';
  if (v.horarioInicio && (!horarioValido(v.horarioInicio) || !horarioValido(v.horarioFim!))) return 'Use o horário no formato HH:MM.';
  if (v.horarioInicio && v.horarioInicio === v.horarioFim) return 'O início e o fim do horário precisam ser diferentes.';
  for (const d of [v.dataInicio, v.dataFim]) {
    if (d && !DATA_ISO.test(d)) return 'Data inválida.';
  }
  if (v.dataInicio && v.dataFim && v.dataInicio > v.dataFim) return 'A data de início precisa vir antes do fim.';
  return null;
}

/** `hoje` em AAAA-MM-DD e `hora` em HH:MM, no fuso do sistema. */
export function conteudoVigente(v: VigenciaConteudo, hoje: string, hora: string): boolean {
  if (v.dataInicio && hoje < v.dataInicio) return false;
  if (v.dataFim && hoje > v.dataFim) return false;
  return dentroDoHorarioDaTela(v.horarioInicio, v.horarioFim, hora);
}

/** Validade zero: imagem não tem preço que fique velho. */
const SEM_VALIDADE = new Date('9999-12-31T00:00:00.000Z');

/** Até quando estes dados podem ficar na tela. */
export function dadosValidosAte(dadosEm: Date | string, validadeMinutos: number): Date {
  if (validadeMinutos === 0) return SEM_VALIDADE;
  return new Date(new Date(dadosEm).getTime() + validadeMinutos * 60_000);
}

// Contratos ----------------------------------------------------------------------------------

export type SituacaoConteudoTela = 'RASCUNHO' | 'NO_AR' | 'AGENDADO' | 'SEM_DADOS' | 'DADOS_VENCIDOS';

export const ROTULO_SITUACAO_CONTEUDO: Record<SituacaoConteudoTela, string> = {
  RASCUNHO: 'Rascunho',
  NO_AR: 'No ar',
  AGENDADO: 'Fora do horário',
  SEM_DADOS: 'Sem dados',
  DADOS_VENCIDOS: 'Dados vencidos',
};

export function situacaoDoConteudo(c: VigenciaConteudo & { publicado: boolean; quantidadeItens: number; dadosEm: Date | string | null; validadeMinutos: number }, agora: Date, hoje: string, hora: string): SituacaoConteudoTela {
  if (!c.publicado) return 'RASCUNHO';
  if (!c.dadosEm || c.quantidadeItens === 0) return 'SEM_DADOS';
  if (dadosValidosAte(c.dadosEm, c.validadeMinutos) <= agora) return 'DADOS_VENCIDOS';
  return conteudoVigente(c, hoje, hora) ? 'NO_AR' : 'AGENDADO';
}

export interface ConteudoTelaResumo extends VigenciaConteudo {
  id: string;
  nome: string;
  modelo: ModeloConteudoTela;
  config: ConfigConteudoTela;
  consultaId: string | null;
  consultaNome: string | null;
  intervaloMinutos: number;
  validadeMinutos: number;
  publicado: boolean;
  situacao: SituacaoConteudoTela;
  telaIds: string[];
  quantidadeItens: number;
  dadosEm: string | null;
  /** Por que a última atualização falhou. Os dados anteriores seguem até vencer. */
  erro: string | null;
  responsavelNome: string | null;
  aprovacao: AprovacaoConteudoTela | null;
}

// Aprovação ----------------------------------------------------------------------------------

export type SituacaoAprovacao = 'PENDENTE' | 'RECUSADO' | 'APROVADO';

/** O conteúdo como vai ficar. Só vale ao aprovar: até lá, o que está no ar não muda. */
export interface PropostaConteudoTela extends VigenciaConteudo {
  nome: string;
  modelo: ModeloConteudoTela;
  consultaId: string | null;
  config: ConfigConteudoTela;
  intervaloMinutos: number;
  validadeMinutos: number;
  telaIds: string[];
}

/** O que fica guardado no banco, além da situação e da data do pedido. */
export interface DadosAprovacaoConteudo {
  proposta: PropostaConteudoTela | null;
  pedidaPorId: string | null;
  pedidaPorNome: string | null;
  decididaPorNome: string | null;
  decididaEm: string | null;
  motivo: string | null;
}

export interface AprovacaoConteudoTela extends DadosAprovacaoConteudo {
  situacao: SituacaoAprovacao;
  /** A data do pedido. Quem decide devolve: se o conteúdo foi reenviado nesse meio-tempo, a decisão é recusada. */
  versao: string;
}

export interface ConteudoParaAprovar extends ConteudoTelaResumo {
  /** Por que esta pessoa não pode aprovar este pedido. Recusar segue a mesma regra. */
  impedimento: string | null;
}

export const LIMITE_MOTIVO_RECUSA = 500;

/** Devolve o motivo de não poder decidir, se houver. A permissão `tela.aprovar` é conferida antes. */
export function impedimentoParaAprovar(parametros: Pick<ParametrosTelas, 'criadorPodeAprovar' | 'administradorGeralAprova'>, usuario: { id: string; superAdmin: boolean }, pedidaPorId: string | null): string | null {
  if (usuario.superAdmin && !parametros.administradorGeralAprova) return 'O administrador geral não aprova o conteúdo desta empresa. Para permitir, ligue “Administrador geral aprova” nos parâmetros.';
  if (!parametros.criadorPodeAprovar && pedidaPorId === usuario.id) return 'Esta empresa exige uma segunda pessoa: quem enviou para aprovação não pode decidir.';
  return null;
}

/** O que muda em relação ao que está no ar. Os preços não entram: vêm da consulta, sem passar por aprovação. */
export function diferencasDaProposta(atual: PropostaConteudoTela, proposta: PropostaConteudoTela): string[] {
  const a = atual.config;
  const p = proposta.config;
  const igual = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  const comparar: [string, unknown, unknown][] = [
    ['Nome', atual.nome, proposta.nome],
    ['Modelo', atual.modelo, proposta.modelo],
    ['Consulta', atual.consultaId, proposta.consultaId],
    ['Título', a.titulo, p.titulo],
    ['Rodapé', a.rodape, p.rodape],
    ['Colunas', [a.colunaNome, a.colunaPreco, a.colunaPrecoDe, a.colunaDetalhe], [p.colunaNome, p.colunaPreco, p.colunaPrecoDe, p.colunaDetalhe]],
    ['Tempo de cada cena', a.segundosPorCena, p.segundosPorCena],
    ['Cores', [a.corFundo, a.corDestaque], [p.corFundo, p.corDestaque]],
    ['Imagens', a.imagens ?? [], p.imagens ?? []],
    ['Encaixe das imagens', a.ajuste, p.ajuste],
    ['Fotos dos produtos', [!!a.comFotos, a.comFotos ? a.colunaCodigo : null], [!!p.comFotos, p.comFotos ? p.colunaCodigo : null]],
    ['Logomarca', a.logoImagemId, p.logoImagemId],
    ['Imagem de fundo', [a.fundoImagemId, a.fundoImagemId ? (a.fundoVeu ?? VEU_FUNDO_PADRAO) : null], [p.fundoImagemId, p.fundoImagemId ? (p.fundoVeu ?? VEU_FUNDO_PADRAO) : null]],
    ['Atualização e validade', [atual.intervaloMinutos, atual.validadeMinutos], [proposta.intervaloMinutos, proposta.validadeMinutos]],
    ['Quando passar', [atual.horarioInicio, atual.horarioFim, atual.dataInicio, atual.dataFim], [proposta.horarioInicio, proposta.horarioFim, proposta.dataInicio, proposta.dataFim]],
    ['Telas', [...atual.telaIds].sort(), [...proposta.telaIds].sort()],
  ];
  return comparar.filter(([, x, y]) => !igual(x, y)).map(([rotulo]) => rotulo);
}

export interface ImagemTelaResumo {
  id: string;
  nome: string;
  largura: number | null;
  altura: number | null;
  bytes: number;
  /** Conteúdos que usam: enquanto houver, não pode excluir. */
  usos: number;
  criadoEm: string;
}

/** Pública de propósito: `<img>` não manda token, a TV não tem login e o endereço leva um id impossível de adivinhar. */
export const caminhoImagemTela = (id: string) => `/api/tv/imagens/${id}`;
/** Pública pelo mesmo motivo. O id muda quando a foto muda: o arquivo fica em cache para sempre. */
export const caminhoFotoProdutoTela = (id: string) => `/api/tv/fotos/${id}`;

/** A imagem horizontal em tela vertical sobra ou corta: vale avisar quem está montando. */
export function imagemCombinaComTela(imagem: { largura: number | null; altura: number | null }, tela: { largura: number; altura: number }): boolean {
  if (!imagem.largura || !imagem.altura) return true;
  const proporcaoDaTela = tela.largura / tela.altura;
  return Math.abs(imagem.largura / imagem.altura - proporcaoDaTela) / proporcaoDaTela < 0.05;
}

export interface ConsultaParaConteudo {
  id: string;
  nome: string;
  colunas: string[];
  /** Pede valores digitados: não roda sozinha. */
  pedeParametro: boolean;
}

export interface PreviaConteudoResposta extends ResultadoItens {
  colunas: string[];
  /** Produtos banidos deixados de fora. */
  banidos: number;
  /** Só com fotos ligadas. */
  fotos?: ResumoFotosConteudo;
}

export interface ResumoFotosConteudo {
  com: number;
  sem: number;
  /** Ainda procurando no catálogo: chegam depois, sem fazer nada. */
  pendentes: number;
  /** O catálogo diz que é medicamento: a propaganda tem regras próprias. */
  medicamentos: number;
  /** Por que o catálogo não respondeu. */
  aviso: string | null;
}

/** O que a TV exibe. O `validoAte` faz a própria TV tirar o preço velho, mesmo sem internet. */
export interface ProgramaTela {
  id: string;
  nome: string;
  modelo: ModeloConteudoTela;
  config: Pick<ConfigConteudoTela, 'titulo' | 'rodape' | 'segundosPorCena' | 'corFundo' | 'corDestaque' | 'ajuste'>;
  itens: ItemConteudoTela[];
  /** Só no modelo de imagens. */
  imagens?: { url: string; segundos: number }[];
  logo?: string;
  fundo?: { url: string; veu: number };
  dadosEm: string;
  validoAte: string;
}

export interface ProgramacaoTela {
  versao: string;
  programas: ProgramaTela[];
  agora: string;
  /** Fuso do sistema: o da TV pode estar errado. */
  fuso: string;
}

/** Programas que ainda podem ficar na tela, conforme o relógio do servidor. */
export function programasValidos(programas: ProgramaTela[], agora: Date): ProgramaTela[] {
  return programas.filter((p) => new Date(p.validoAte) > agora && (p.itens.length > 0 || (p.imagens?.length ?? 0) > 0));
}

export const horaDosDados = (dadosEm: string, fuso?: string) => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(fuso ? { timeZone: fuso } : {}) }).format(new Date(dadosEm));
