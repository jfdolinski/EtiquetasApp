import { FONTES } from './etiquetas/design';
import type { FormatoCampo, Registro } from './etiquetas/tipos';
import { dataIsoDe, formatarCampo, textoNaTela } from './etiquetas/valores';
import { chaveDoRegistro, descricaoDoRegistro } from './impressao';

/**
 * Posts para redes sociais. Os dados do produto vêm do ERP, as imagens do catálogo ou da galeria
 * da empresa. O post guarda conteúdo e escolhas de aparência: a arte é montada por `montarPost`,
 * em cada tamanho, e a edição livre fica em `ajustes` (posição, por tamanho) e `design` (estilo).
 */
export type FormatoPost = 'QUADRADO' | 'RETRATO' | 'STORIES';
export type ModeloPost = 'PRODUTO' | 'OFERTA' | 'AVISO';
export type VariacaoPost = 'CLASSICO' | 'FOTO_GRANDE' | 'LADO_A_LADO';

export const FORMATOS_POST: Record<FormatoPost, { rotulo: string; largura: number; altura: number }> = {
  QUADRADO: { rotulo: 'Quadrado', largura: 1080, altura: 1080 },
  RETRATO: { rotulo: 'Retrato', largura: 1080, altura: 1350 },
  STORIES: { rotulo: 'Stories e status', largura: 1080, altura: 1920 },
};

export const MODELOS_POST: Record<ModeloPost, { rotulo: string; minProdutos: number; maxProdutos: number }> = {
  PRODUTO: { rotulo: 'Um produto', minProdutos: 1, maxProdutos: 1 },
  OFERTA: { rotulo: 'Oferta com vários produtos', minProdutos: 2, maxProdutos: 4 },
  AVISO: { rotulo: 'Aviso, sem produto', minProdutos: 0, maxProdutos: 0 },
};

export const VARIACOES_POST: Record<VariacaoPost, string> = {
  CLASSICO: 'Clássico',
  FOTO_GRANDE: 'Foto em destaque',
  LADO_A_LADO: 'Lado a lado',
};

export const PALETAS_POST: readonly { nome: string; principal: string; destaque: string }[] = [
  { nome: 'Azul e amarelo', principal: '#1d4ed8', destaque: '#facc15' },
  { nome: 'Vermelho oferta', principal: '#b91c1c', destaque: '#fde047' },
  { nome: 'Verde saúde', principal: '#0f766e', destaque: '#fbbf24' },
  { nome: 'Laranja vibrante', principal: '#ea580c', destaque: '#ffffff' },
  { nome: 'Roxo elegante', principal: '#6d28d9', destaque: '#f9a8d4' },
  { nome: 'Rosa beleza', principal: '#db2777', destaque: '#fef08a' },
  { nome: 'Preto premium', principal: '#111827', destaque: '#f59e0b' },
  { nome: 'Claro e limpo', principal: '#f8fafc', destaque: '#dc2626' },
];

export type ImagemPost = { origem: 'CATALOGO'; url: string; ia: boolean } | { origem: 'GALERIA'; id: string };

/** O que da arte pode vir de um campo da consulta, como nas etiquetas. */
export type CampoProdutoPost = 'descricao' | 'preco' | 'precoDe' | 'unidade' | 'detalhe' | 'selo' | 'codigo';

export const CAMPOS_PRODUTO_POST: Record<CampoProdutoPost, string> = {
  descricao: 'Nome do produto',
  preco: 'Preço',
  precoDe: 'Preço anterior',
  unidade: 'Unidade',
  detalhe: 'Detalhe',
  selo: 'Selo',
  codigo: 'Código de barras',
};

export interface VinculoCampo {
  /** Coluna da consulta. */
  campo: string;
  formato?: FormatoCampo;
}

export type VinculosPost = Partial<Record<CampoProdutoPost, VinculoCampo>>;

export interface ProdutoPost {
  codigo: string;
  descricao: string;
  /** Texto pronto: "R$ 4,99". Vem do ERP e pode ser corrigido no post. */
  preco: string;
  /** Preço anterior, riscado na arte. */
  precoDe?: string;
  /** "/kg", "cada", "o par". */
  unidade?: string;
  /** Detalhe abaixo do nome: "Leve 3, pague 2". */
  detalhe?: string;
  /** Texto do selo: "-20%", "Novo". */
  selo?: string;
  imagem: ImagemPost | null;
  /** O catálogo diz que é medicamento: a tela avisa das regras de propaganda. */
  medicamento?: boolean;
  /** Linha da consulta de onde veio: é dela que os campos relacionados tiram o valor. */
  registro?: Registro;
}

export interface ConteudoPost {
  titulo: string;
  subtitulo?: string;
  texto: string;
  rodape: string;
  produtos: ProdutoPost[];
  imagem: ImagemPost | null;
  variacao?: VariacaoPost;
  /** Botão desenhado na arte: "Compre agora". */
  chamada?: string;
  /** "Válido até 31/12". */
  validade?: string;
  telefone?: string;
  whatsapp?: string;
  instagram?: string;
  site?: string;
  endereco?: string;
  /** Vão no fim da legenda sugerida. */
  hashtags?: string;
  /** Consulta usada na busca de produtos deste post. */
  consultaId?: string;
  /** Relacionamento: de qual campo da consulta vem cada informação do produto. */
  vinculos?: VinculosPost;
}

/** O que vale em um tamanho de post: mover no quadrado não bagunça os stories. */
export interface AjusteElemento {
  x?: number;
  y?: number;
  largura?: number;
  altura?: number;
  rotacao?: number;
  oculto?: boolean;
  travado?: boolean;
}

export type AjustesPost = Partial<Record<FormatoPost, Record<string, AjusteElemento>>>;

/** Aparência do elemento, igual em todos os tamanhos. */
export interface EstiloElemento {
  fonte?: string;
  tamanho?: number;
  negrito?: boolean;
  italico?: boolean;
  sublinhado?: boolean;
  tachado?: boolean;
  /** Cor do texto ou preenchimento da forma. */
  cor?: string;
  alinhamento?: 'left' | 'center' | 'right';
  alinhamentoVertical?: 'top' | 'middle' | 'bottom';
  espacamentoLetras?: number;
  alturaLinha?: number;
  caixa?: 'normal' | 'maiusculas' | 'minusculas';
  /** Com "R$" e centavos menores que o valor (só no preço). */
  centavosPequenos?: boolean;
  contornoCor?: string;
  contornoEspessura?: number;
  fundoTexto?: string;
  sombraCor?: string;
  sombraBlur?: number;
  sombraX?: number;
  sombraY?: number;
  opacidade?: number;
  raio?: number;
  /** Segunda cor do degradê da forma. */
  cor2?: string;
  angulo?: number;
  bordaCor?: string;
  bordaEspessura?: number;
  ajusteImagem?: 'conter' | 'cobrir';
  espelhar?: boolean;
  brilho?: number;
  contraste?: number;
  saturacao?: number;
  pontas?: number;
  raioInterno?: number;
}

export type TipoExtra = 'texto' | 'imagem' | 'retangulo' | 'elipse' | 'estrela' | 'linha' | 'qr';

/** Elemento acrescentado à mão. `yRel` é a fração da altura: entra no mesmo lugar em todos os tamanhos. */
export interface ExtraPost {
  id: string;
  tipo: TipoExtra;
  x: number;
  yRel: number;
  largura: number;
  altura: number;
  texto?: string;
  imagem?: ImagemPost | null;
  /** Texto ou QR vindo de um campo da consulta, em vez de `texto`. `produto` é o índice no post. */
  vinculo?: VinculoCampo & { produto?: number };
}

export interface FundoPost {
  tipo: 'cor' | 'degrade' | 'imagem';
  cor?: string;
  cor2?: string;
  angulo?: number;
  imagem?: ImagemPost | null;
  /** Véu escuro sobre a imagem, de 0 a 1, para o texto aparecer. */
  veu?: number;
}

export interface DesignPost {
  fundo?: FundoPost;
  /** Cores deste post, no lugar das da marca. */
  corPrincipal?: string;
  corDestaque?: string;
  /** Fonte de todos os textos sem fonte própria. */
  fontePadrao?: string;
  estilos?: Record<string, EstiloElemento>;
  extras?: ExtraPost[];
  /** Ordem das camadas por tamanho, do fundo para a frente. */
  ordem?: Partial<Record<FormatoPost, string[]>>;
}

export interface DadosPost {
  titulo: string;
  modelo: ModeloPost;
  formato: FormatoPost;
  conteudo: ConteudoPost;
  legenda: string;
  ajustes: AjustesPost;
  design?: DesignPost;
}

/**
 * Template padrão da empresa: aparência e relacionamentos de um post, sem os produtos.
 * Todo post novo nasce dele; o que se muda depois vale só para aquele post.
 */
export interface TemplatePost {
  modelo: ModeloPost;
  variacao?: VariacaoPost;
  design: DesignPost;
  ajustes: AjustesPost;
  vinculos?: VinculosPost;
  consultaId?: string;
  rodape?: string;
  hashtags?: string;
  telefone?: string;
  whatsapp?: string;
  instagram?: string;
  site?: string;
  endereco?: string;
}

export interface PostResumo {
  id: string;
  titulo: string;
  modelo: ModeloPost;
  formato: FormatoPost;
  atualizadoEm: string;
  autor: string | null;
}

export interface PostCompleto extends DadosPost {
  id: string;
  atualizadoEm: string;
}

export interface MarcaPost {
  nome: string;
  corPrincipal: string;
  corDestaque: string;
  logoId: string | null;
}

export interface SituacaoMarcaPost extends MarcaPost {
  temChaveCatalogo: boolean;
  catalogoConfigurado: boolean;
  template: TemplatePost | null;
}

export interface ImagemGaleria {
  id: string;
  nome: string;
  criadoEm: string;
}

export interface ImagemCatalogo {
  url: string;
  ia: boolean;
}

export interface ProdutoCatalogo {
  encontrado: boolean;
  nome: string | null;
  /** Categoria do produto no catálogo (`category`). */
  categoria: string | null;
  medicamento: boolean;
  imagens: ImagemCatalogo[];
  /** O catálogo não respondeu ou recusou: dá para seguir com imagem própria. */
  aviso: string | null;
}

export interface ConsultaPost {
  id: string;
  nome: string;
  /** Campos lidos da consulta, para o relacionamento. */
  colunas: string[];
}

export interface BuscaProdutosPost {
  produtos: ProdutoPost[];
  banidos: number;
  /** A consulta tem linhas demais e o banco não aceitou o filtro: pode faltar produto. */
  incompleta?: boolean;
}

export const RODAPE_PADRAO = 'Imagens ilustrativas. Ofertas válidas enquanto durarem os estoques.';

export function conteudoVazio(): ConteudoPost {
  return { titulo: '', texto: '', rodape: RODAPE_PADRAO, produtos: [], imagem: null };
}

/** "4.99", "4,99", "1.234,50" ou 4.99 viram "R$ 4,99". O que não for número fica como veio. */
export function formatarPrecoPost(v: unknown): string {
  if (v === null || v === undefined) return '';
  const bruto = String(v).trim();
  const t = bruto.replace(/^R\$\s*/i, '');
  let numero: number;
  if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(t) || /^\d+,\d{1,2}$/.test(t)) numero = Number(t.replace(/\./g, '').replace(',', '.'));
  else if (/^\d+(\.\d+)?$/.test(t)) numero = Number(t);
  else return bruto;
  const [inteiro, centavos] = numero.toFixed(2).split('.');
  return `R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${centavos}`;
}

/** Separa "R$ 1.234,50" em moeda, valor e centavos, para desenhar em tamanhos diferentes. */
export function partesDoPreco(preco: string): { moeda: string; valor: string; centavos: string } | null {
  const m = /^(R\$)\s*([\d.]+)(,\d{1,2})?$/.exec(preco.trim());
  return m ? { moeda: m[1], valor: m[2], centavos: m[3] ?? '' } : null;
}

const COLUNAS_PRECO = ['preco', 'preco_venda', 'precovenda', 'valor_venda', 'vlr_venda', 'valor', 'preco_unitario'];

export function precoDoRegistro(registro: Registro): string {
  const chaves = Object.keys(registro);
  const preenchida = (c: string) => registro[c] !== null && registro[c] !== undefined && registro[c] !== '';
  for (const n of COLUNAS_PRECO) {
    const k = chaves.find((c) => c.toLowerCase() === n);
    if (k && preenchida(k)) return formatarPrecoPost(registro[k]);
  }
  const k = chaves.find((c) => /^(pre[cç]o|prc|vlr|valor)/i.test(c) && !/custo|compra/i.test(c) && preenchida(c));
  return k ? formatarPrecoPost(registro[k]) : '';
}

/** Linha da consulta do ERP vira produto do post. O código de barras tem preferência: é a chave do catálogo. */
export function produtoDoRegistro(registro: Registro, vinculos?: VinculosPost): ProdutoPost {
  const barras = Object.keys(registro).find((c) => /ean|gtin|barra|codbar/i.test(c) && registro[c]);
  const produto: ProdutoPost = {
    codigo: barras ? String(registro[barras]).trim() : chaveDoRegistro(registro),
    descricao: descricaoDoRegistro(registro),
    preco: precoDoRegistro(registro),
    imagem: null,
    // Linha enorme não vai junto: o post continua funcionando, só sem trocar de campo depois.
    ...(JSON.stringify(registro).length <= MAX_REGISTRO ? { registro } : {}),
  };
  return vinculos ? aplicarVinculos(produto, vinculos, registro) : produto;
}

const MAX_REGISTRO = 8000;

/** Valor do campo na linha da consulta, sem diferenciar maiúsculas; `null` se a linha não tem a coluna. */
export function valorDoVinculo(registro: Registro | undefined, vinculo: VinculoCampo, ehPreco = false): string | null {
  if (!registro) return null;
  const chave = Object.keys(registro).find((c) => c.toLowerCase() === vinculo.campo.toLowerCase());
  if (chave === undefined) return null;
  const bruto = registro[chave];
  if (ehPreco && !vinculo.formato) return formatarPrecoPost(bruto);
  return vinculo.formato || !dataIsoDe(bruto) ? formatarCampo(bruto, vinculo.formato) : textoNaTela(bruto);
}

/** Preenche o produto com os campos relacionados. O que não tem relacionamento fica como está. */
export function aplicarVinculos(produto: ProdutoPost, vinculos: VinculosPost, registro: Registro | undefined = produto.registro): ProdutoPost {
  const novo = { ...produto };
  for (const k of Object.keys(vinculos) as CampoProdutoPost[]) {
    const valor = valorDoVinculo(registro, vinculos[k]!, k === 'preco' || k === 'precoDe');
    if (valor === null) continue;
    if (k === 'descricao' || k === 'preco' || k === 'codigo') novo[k] = valor;
    else novo[k] = valor || undefined;
  }
  // Outro código é outro produto no catálogo: a foto escolhida por ele deixa de valer.
  if (novo.codigo !== produto.codigo && novo.imagem?.origem === 'CATALOGO') novo.imagem = null;
  return novo;
}

/** Elemento da arte que mostra um campo do produto, com o índice do produto. */
export function campoDoElemento(id: string): { campo: CampoProdutoPost; produto: number } | null {
  for (const [re, campo] of [
    [/^nome-(\d+)$/, 'descricao'],
    [/^preco-de-(\d+)$/, 'precoDe'],
    [/^preco-(\d+)$/, 'preco'],
    [/^unidade-(\d+)$/, 'unidade'],
    [/^detalhe-(\d+)$/, 'detalhe'],
    [/^selo-(\d+)$/, 'selo'],
  ] as const) {
    const m = re.exec(id);
    if (m) return { campo, produto: Number(m[1]) };
  }
  return null;
}

/** Colunas disponíveis para relacionar: as lidas da consulta e as das linhas que já estão no post. */
export function colunasParaVincular(deConsulta: readonly string[], produtos: readonly ProdutoPost[]): string[] {
  return [...new Set([...deConsulta, ...produtos.flatMap((p) => Object.keys(p.registro ?? {}))])];
}

/** O que o post atual vira ao ser salvo como template padrão: tudo menos os produtos. */
export function templateDoPost(d: DadosPost): TemplatePost {
  const c = d.conteudo;
  const t: TemplatePost = { modelo: d.modelo, variacao: c.variacao, design: d.design ?? {}, ajustes: d.ajustes, vinculos: c.vinculos, consultaId: c.consultaId, rodape: c.rodape, hashtags: c.hashtags, telefone: c.telefone, whatsapp: c.whatsapp, instagram: c.instagram, site: c.site, endereco: c.endereco };
  return Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined)) as unknown as TemplatePost;
}

/** Post novo a partir do template. As posições só valem no mesmo modelo: os elementos são outros. */
export function aplicarTemplate(d: DadosPost, t: TemplatePost): DadosPost {
  const { modelo, variacao, design, ajustes, vinculos, consultaId, ...textos } = t;
  const mesmoModelo = modelo === d.modelo;
  const conteudo: ConteudoPost = { ...d.conteudo, ...textos, ...(variacao ? { variacao } : {}), ...(consultaId ? { consultaId } : {}), ...(vinculos ? { vinculos } : {}) };
  if (vinculos) conteudo.produtos = conteudo.produtos.map((p) => aplicarVinculos(p, vinculos));
  return { ...d, conteudo, design, ajustes: mesmoModelo ? ajustes : {} };
}

export function chaveImagemPost(imagem: ImagemPost): string {
  return imagem.origem === 'GALERIA' ? `GALERIA:${imagem.id}` : `CATALOGO:${imagem.url}`;
}

export function caminhoImagemPost(imagem: ImagemPost): string {
  return imagem.origem === 'GALERIA' ? `/posts/imagens/${imagem.id}/arquivo` : `/posts/catalogo-imagem?url=${encodeURIComponent(imagem.url)}`;
}

/** Texto preto ou branco, o que for mais legível sobre a cor. */
export function corSobre(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const canal = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luz = 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
  return luz > 0.4 ? '#0f172a' : '#ffffff';
}

interface BaseElemento extends EstiloElemento {
  id: string;
  x: number;
  y: number;
  largura: number;
  altura: number;
  rotacao?: number;
  oculto?: boolean;
  travado?: boolean;
  /** Fundo: não é selecionado nem arrastado. */
  fixo?: boolean;
}
export interface RetanguloPost extends BaseElemento {
  tipo: 'retangulo';
}
export interface ElipsePost extends BaseElemento {
  tipo: 'elipse';
}
export interface EstrelaPost extends BaseElemento {
  tipo: 'estrela';
}
export interface LinhaPost extends BaseElemento {
  tipo: 'linha';
}
export interface FotoPost extends BaseElemento {
  tipo: 'imagem';
  imagem: ImagemPost;
}
export interface QrPost extends BaseElemento {
  tipo: 'qr';
  texto: string;
}
export interface TextoPost extends BaseElemento {
  tipo: 'texto';
  texto: string;
  /** Desenha com "R$" e centavos menores. */
  preco?: boolean;
}
export type ElementoPost = RetanguloPost | ElipsePost | EstrelaPost | LinhaPost | FotoPost | QrPost | TextoPost;

const MARGEM = 60;
const CARTAO = '#ffffff';
const TEXTO_CARTAO = '#0f172a';

/** Cores em vigor: as do post, senão as da marca. */
export function coresDoPost(design: DesignPost | undefined, marca: Pick<MarcaPost, 'corPrincipal' | 'corDestaque'>) {
  return { principal: design?.corPrincipal ?? marca.corPrincipal, destaque: design?.corDestaque ?? marca.corDestaque };
}

/** A arte do post, em pixels do tamanho escolhido. Nos stories, topo e base ficam livres: o Instagram cobre essas faixas. */
export function montarPost(dados: Pick<DadosPost, 'modelo' | 'formato' | 'conteudo' | 'ajustes' | 'design'>, marca: MarcaPost): ElementoPost[] {
  const { largura: w, altura: h } = FORMATOS_POST[dados.formato];
  const { conteudo: c, design } = dados;
  const variacao = c.variacao ?? 'CLASSICO';
  const seguro = dados.formato === 'STORIES' ? 230 : 50;
  const util = w - 2 * MARGEM;
  const { principal, destaque } = coresDoPost(design, marca);
  const fundo = design?.fundo;
  const fundoImagem = fundo?.tipo === 'imagem' && fundo.imagem ? fundo.imagem : null;
  const sobre = fundoImagem ? '#ffffff' : corSobre(fundo?.tipo === 'cor' || fundo?.tipo === 'degrade' ? (fundo.cor ?? principal) : principal);
  const elementos: ElementoPost[] = [];

  const retangulo = (id: string, x: number, y: number, largura: number, altura: number, cor: string, raio: number) => elementos.push({ id, tipo: 'retangulo', x, y, largura, altura, cor, raio });
  const texto = (id: string, t: string | undefined, x: number, y: number, largura: number, altura: number, tamanho: number, opcoes: Partial<TextoPost> = {}) => {
    if (t?.trim()) elementos.push({ id, tipo: 'texto', texto: t.trim(), x, y, largura, altura, tamanho, cor: sobre, negrito: false, alinhamento: 'center', alinhamentoVertical: 'middle', ...opcoes });
  };
  /** Imagem e, se foi gerada por IA, o aviso logo abaixo dela. */
  const imagem = (id: string, i: ImagemPost | null | undefined, x: number, y: number, largura: number, altura: number) => {
    if (!i) return;
    const ia = i.origem === 'CATALOGO' && i.ia;
    elementos.push({ id, tipo: 'imagem', imagem: i, x, y, largura, altura: ia ? altura - 28 : altura, ajusteImagem: 'conter' });
    if (ia) texto(`${id}-ia`, 'Imagem gerada por IA', x, y + altura - 26, largura, 26, 20, { cor: '#475569' });
  };
  const selo = (n: number, t: string | undefined, x: number, y: number, tamanho: number) => {
    if (!t?.trim()) return;
    elementos.push({ id: `selo-fundo-${n}`, tipo: 'estrela', x, y, largura: tamanho, altura: tamanho, cor: destaque, pontas: 14, raioInterno: 0.82 });
    texto(`selo-${n}`, t, x + tamanho * 0.14, y + tamanho * 0.14, tamanho * 0.72, tamanho * 0.72, tamanho * 0.26, { cor: corSobre(destaque), negrito: true });
  };
  /** Preço anterior riscado e o preço, em faixa colorida. */
  const preco = (n: number, p: ProdutoPost, x: number, y: number, largura: number, altura: number, tamanho: number, raio: number) => {
    const alturaDe = p.precoDe?.trim() ? Math.min(46, altura * 0.3) : 0;
    // Na oferta e na foto em destaque, fica sobre o cartão branco.
    const corDe = dados.modelo === 'OFERTA' || variacao === 'FOTO_GRANDE' ? TEXTO_CARTAO : sobre;
    if (alturaDe) texto(`preco-de-${n}`, `De ${p.precoDe!.trim()} por`, x, y, largura, alturaDe, alturaDe * 0.72, { tachado: true, cor: corDe });
    if (!p.preco.trim()) return;
    const yFaixa = y + alturaDe;
    const alturaFaixa = altura - alturaDe;
    retangulo(`faixa-preco-${n}`, x, yFaixa, largura, alturaFaixa, destaque, raio);
    const unidade = p.unidade?.trim() ? ` ${p.unidade.trim()}` : '';
    const alturaTexto = alturaFaixa - 8;
    texto(`preco-${n}`, p.preco, x + 12, yFaixa + 4, largura - 24, alturaTexto, Math.min(tamanho, alturaTexto * 0.92), { cor: corSobre(destaque), negrito: true, preco: true, centavosPequenos: true });
    if (unidade) texto(`unidade-${n}`, unidade.trim(), x + largura - 118, yFaixa + alturaFaixa - 40, 110, 36, 26, { cor: corSobre(destaque), alinhamento: 'right' });
  };

  // Fundo primeiro: fica sempre atrás e não é selecionado.
  elementos.push({ id: 'fundo', tipo: 'retangulo', x: 0, y: 0, largura: w, altura: h, cor: fundo?.tipo === 'cor' || fundo?.tipo === 'degrade' ? (fundo.cor ?? principal) : principal, raio: 0, fixo: true, ...(fundo?.tipo === 'degrade' ? { cor2: fundo.cor2 ?? destaque, angulo: fundo.angulo ?? 135 } : {}) });
  if (fundoImagem) {
    elementos.push({ id: 'fundo-imagem', tipo: 'imagem', imagem: fundoImagem, x: 0, y: 0, largura: w, altura: h, ajusteImagem: 'cobrir', fixo: true });
    elementos.push({ id: 'fundo-veu', tipo: 'retangulo', x: 0, y: 0, largura: w, altura: h, cor: '#000000', opacidade: fundo?.veu ?? 0, raio: 0, fixo: true });
  }

  const topo = seguro;
  if (marca.logoId) elementos.push({ id: 'logo', tipo: 'imagem', imagem: { origem: 'GALERIA', id: marca.logoId }, x: (w - 320) / 2, y: topo, largura: 320, altura: 110, ajusteImagem: 'conter' });
  else texto('marca', marca.nome, MARGEM, topo, util, 110, 54, { negrito: true });
  const inicio = topo + 130;

  // Rodapé para cima: cada informação preenchida tira espaço do conteúdo.
  let base = h - seguro;
  if (c.rodape.trim()) {
    base -= 64;
    texto('rodape', c.rodape, MARGEM, base, util, 64, 26);
    base -= 16;
  }
  const contato = [c.telefone && `Tel. ${c.telefone.trim()}`, c.whatsapp && `WhatsApp ${c.whatsapp.trim()}`, c.instagram?.trim(), c.site?.trim()].filter(Boolean).join('  ·  ');
  if (contato) {
    base -= 48;
    texto('contato', contato, MARGEM, base, util, 48, 30, { negrito: true });
    base -= 8;
  }
  if (c.endereco?.trim()) {
    base -= 44;
    texto('endereco', c.endereco, MARGEM, base, util, 44, 28);
    base -= 8;
  }
  if (c.validade?.trim()) {
    base -= 44;
    texto('validade', c.validade, MARGEM, base, util, 44, 30);
    base -= 8;
  }
  if (c.chamada?.trim()) {
    base -= 90;
    retangulo('chamada-fundo', 240, base, w - 480, 90, destaque, 45);
    texto('chamada', c.chamada, 260, base + 6, w - 520, 78, 44, { cor: corSobre(destaque), negrito: true });
    base -= 16;
  }

  if (dados.modelo === 'PRODUTO') {
    const p: ProdutoPost = c.produtos[0] ?? { codigo: '', descricao: '', preco: '', imagem: null };
    const alturaDetalhe = p.detalhe?.trim() ? 60 : 0;
    const alturaPreco = (p.precoDe?.trim() ? 46 : 0) + 130;
    const alturaNome = 120;
    const espaco = base - inicio;
    if (variacao === 'LADO_A_LADO') {
      const larguraFoto = Math.round(util * 0.52);
      retangulo('cartao-0', MARGEM, inicio, larguraFoto, espaco, CARTAO, 32);
      imagem('imagem-0', p.imagem, MARGEM + 20, inicio + 20, larguraFoto - 40, espaco - 40);
      const xT = MARGEM + larguraFoto + 24;
      const lT = util - larguraFoto - 24;
      const alturaN = Math.max(120, espaco - alturaPreco - alturaDetalhe - 24);
      texto('nome-0', p.descricao, xT, inicio, lT, alturaN, 66, { negrito: true, alinhamento: 'left' });
      texto('detalhe-0', p.detalhe, xT, inicio + alturaN, lT, alturaDetalhe, 32, { alinhamento: 'left' });
      preco(0, p, xT, base - alturaPreco, lT, alturaPreco, 84, 24);
      selo(0, p.selo, MARGEM + larguraFoto - 170, inicio + 10, 160);
    } else if (variacao === 'FOTO_GRANDE') {
      const alturaFoto = espaco - alturaNome - alturaDetalhe - 20;
      retangulo('cartao-0', MARGEM, inicio, util, alturaFoto, CARTAO, 32);
      imagem('imagem-0', p.imagem, MARGEM + 20, inicio + 20, util - 40, alturaFoto - 40);
      texto('nome-0', p.descricao, MARGEM, inicio + alturaFoto + 10, util, alturaNome, 54, { negrito: true });
      texto('detalhe-0', p.detalhe, MARGEM, inicio + alturaFoto + 10 + alturaNome, util, alturaDetalhe, 32);
      // A faixa do preço fica sobre o canto do cartão, sem cobrir o meio da foto.
      preco(0, p, w - MARGEM - 430, inicio + alturaFoto - alturaPreco - 16, 410, alturaPreco, 84, 24);
      selo(0, p.selo, MARGEM + 12, inicio + 12, 170);
    } else {
      const alturaCartao = espaco - alturaPreco - alturaNome - alturaDetalhe - 30;
      retangulo('cartao-0', MARGEM, inicio, util, alturaCartao, CARTAO, 32);
      imagem('imagem-0', p.imagem, MARGEM + 30, inicio + 24, util - 60, alturaCartao - 48);
      texto('nome-0', p.descricao, MARGEM, inicio + alturaCartao + 10, util, alturaNome, 60, { negrito: true });
      texto('detalhe-0', p.detalhe, MARGEM, inicio + alturaCartao + 10 + alturaNome, util, alturaDetalhe, 34);
      preco(0, p, 240, base - alturaPreco, w - 480, alturaPreco, 96, 28);
      selo(0, p.selo, w - MARGEM - 180, inicio + 10, 170);
    }
  } else if (dados.modelo === 'OFERTA') {
    const alturaTitulo = c.titulo.trim() ? 100 : 0;
    texto('titulo', c.titulo, MARGEM, inicio, util, alturaTitulo, 72, { negrito: true });
    const alturaSub = c.subtitulo?.trim() ? 50 : 0;
    texto('subtitulo', c.subtitulo, MARGEM, inicio + alturaTitulo, util, alturaSub, 34);
    const y0 = inicio + alturaTitulo + alturaSub + (alturaTitulo || alturaSub ? 12 : 0);
    const n = c.produtos.length;
    const espaco = 20;
    const emLista = variacao === 'LADO_A_LADO';
    const linhas = Math.max(1, emLista ? n : Math.ceil(n / 2));
    const alturaCelula = (base - y0 - espaco * (linhas - 1)) / linhas;
    c.produtos.forEach((p, i) => {
      const inteira = emLista || (n % 2 === 1 && i === n - 1);
      const larguraCelula = inteira ? util : (util - espaco) / 2;
      const x = emLista ? MARGEM : MARGEM + (i % 2) * ((util - espaco) / 2 + espaco);
      const y = y0 + (emLista ? i : Math.floor(i / 2)) * (alturaCelula + espaco);
      retangulo(`cartao-${i}`, x, y, larguraCelula, alturaCelula, CARTAO, 24);
      if (emLista) {
        const lFoto = Math.min(larguraCelula * 0.34, alturaCelula - 16);
        imagem(`imagem-${i}`, p.imagem, x + 12, y + 8, lFoto, alturaCelula - 16);
        const xT = x + lFoto + 24;
        const lT = larguraCelula - lFoto - 36;
        const aPreco = Math.min(84, alturaCelula * 0.42);
        texto(`nome-${i}`, p.descricao, xT, y + 8, lT, alturaCelula - aPreco - 22, 36, { cor: TEXTO_CARTAO, negrito: true, alinhamento: 'left' });
        preco(i, p, xT, y + alturaCelula - aPreco - 8, lT, aPreco, 54, 14);
        selo(i, p.selo, x + 4, y + 4, Math.min(100, alturaCelula * 0.5));
        return;
      }
      const alturaPreco = Math.min(p.precoDe?.trim() ? 118 : 90, alturaCelula * 0.3);
      const alturaNome = Math.min(84, alturaCelula * 0.2);
      const alturaDetalhe = p.detalhe?.trim() ? Math.min(36, alturaCelula * 0.1) : 0;
      const alturaFoto = alturaCelula - alturaPreco - alturaNome - alturaDetalhe - 24;
      imagem(`imagem-${i}`, p.imagem, x + 14, y + 10, larguraCelula - 28, alturaFoto);
      texto(`nome-${i}`, p.descricao, x + 12, y + 10 + alturaFoto, larguraCelula - 24, alturaNome, 32, { cor: TEXTO_CARTAO, negrito: true });
      texto(`detalhe-${i}`, p.detalhe, x + 12, y + 10 + alturaFoto + alturaNome, larguraCelula - 24, alturaDetalhe, 24, { cor: TEXTO_CARTAO });
      preco(i, p, x + 12, y + alturaCelula - alturaPreco - 8, larguraCelula - 24, alturaPreco, 54, 14);
      selo(i, p.selo, x + larguraCelula - Math.min(120, alturaCelula * 0.4) - 4, y + 4, Math.min(120, alturaCelula * 0.4));
    });
  } else {
    const temImagem = !!c.imagem;
    const area = base - inicio;
    if (temImagem && variacao === 'LADO_A_LADO') {
      const lFoto = Math.round(util * 0.48);
      retangulo('cartao-aviso', MARGEM, inicio, lFoto, area, CARTAO, 32);
      imagem('imagem-aviso', c.imagem, MARGEM + 20, inicio + 20, lFoto - 40, area - 40);
      const xT = MARGEM + lFoto + 24;
      const lT = util - lFoto - 24;
      const aT = Math.round(area * 0.4);
      const aS = c.subtitulo?.trim() ? 70 : 0;
      texto('titulo', c.titulo, xT, inicio, lT, aT, 76, { negrito: true, alinhamento: 'left' });
      texto('subtitulo', c.subtitulo, xT, inicio + aT, lT, aS, 36, { alinhamento: 'left' });
      texto('texto', c.texto, xT, inicio + aT + aS, lT, area - aT - aS, 44, { alinhamento: 'left', alinhamentoVertical: 'top' });
    } else {
      const fotoGrande = temImagem && variacao === 'FOTO_GRANDE';
      const alturaTitulo = Math.min(280, area * (temImagem ? (fotoGrande ? 0.18 : 0.25) : 0.35));
      const alturaSub = c.subtitulo?.trim() ? 60 : 0;
      texto('titulo', c.titulo, MARGEM, inicio, util, alturaTitulo, 88, { negrito: true });
      texto('subtitulo', c.subtitulo, MARGEM, inicio + alturaTitulo, util, alturaSub, 40);
      const alturaTexto = temImagem ? area * (fotoGrande ? 0.14 : 0.25) : area - alturaTitulo - alturaSub - 20;
      const yTexto = inicio + alturaTitulo + alturaSub + 10;
      texto('texto', c.texto, MARGEM, yTexto, util, alturaTexto, 50);
      if (temImagem) {
        const y = yTexto + alturaTexto + 10;
        const altura = base - y;
        retangulo('cartao-aviso', MARGEM, y, util, altura, CARTAO, 32);
        imagem('imagem-aviso', c.imagem, MARGEM + 24, y + 20, util - 48, altura - 40);
      }
    }
  }

  // Elementos acrescentados à mão, na frente do que veio do modelo.
  for (const e of design?.extras ?? []) {
    const y = Math.round(e.yRel * h);
    const base_ = { id: e.id, x: e.x, y, largura: e.largura, altura: e.altura };
    const textoExtra = (e.vinculo && valorDoVinculo(c.produtos[e.vinculo.produto ?? 0]?.registro, e.vinculo)) ?? e.texto ?? '';
    if (e.tipo === 'texto') elementos.push({ ...base_, tipo: 'texto', texto: textoExtra, tamanho: 64, cor: sobre, negrito: false, alinhamento: 'center', alinhamentoVertical: 'middle' });
    else if (e.tipo === 'imagem') {
      if (e.imagem) elementos.push({ ...base_, tipo: 'imagem', imagem: e.imagem, ajusteImagem: 'conter' });
    } else if (e.tipo === 'qr') elementos.push({ ...base_, tipo: 'qr', texto: textoExtra });
    else if (e.tipo === 'estrela') elementos.push({ ...base_, tipo: 'estrela', cor: destaque, pontas: 14, raioInterno: 0.8 });
    else if (e.tipo === 'linha') elementos.push({ ...base_, tipo: 'linha', cor: sobre, bordaEspessura: 8 });
    else if (e.tipo === 'elipse') elementos.push({ ...base_, tipo: 'elipse', cor: destaque });
    else elementos.push({ ...base_, tipo: 'retangulo', cor: destaque, raio: 16 });
  }

  const ajustes = dados.ajustes[dados.formato] ?? {};
  const estilos = design?.estilos ?? {};
  const fontePadrao = design?.fontePadrao;
  const prontos = elementos.map((e): ElementoPost => {
    const comFonte = e.tipo === 'texto' && fontePadrao ? { ...e, fonte: fontePadrao } : e;
    return e.fixo ? comFonte : ({ ...comFonte, ...estilos[e.id], ...ajustes[e.id] } as ElementoPost);
  });
  return ordenarCamadas(prontos, design?.ordem?.[dados.formato]);
}

/** Fundo sempre atrás; o resto na ordem escolhida; elemento novo, que a ordem não conhece, vai para a frente. */
function ordenarCamadas(elementos: ElementoPost[], ordem: string[] | undefined): ElementoPost[] {
  if (!ordem?.length) return elementos;
  const posicao = new Map(ordem.map((id, i) => [id, i]));
  const fixos = elementos.filter((e) => e.fixo);
  const soltos = elementos.filter((e) => !e.fixo);
  const conhecidos = soltos.filter((e) => posicao.has(e.id)).sort((a, b) => posicao.get(a.id)! - posicao.get(b.id)!);
  return [...fixos, ...conhecidos, ...soltos.filter((e) => !posicao.has(e.id))];
}

const ROTULOS_FIXOS: Record<string, string> = {
  logo: 'Logomarca',
  marca: 'Nome da empresa',
  titulo: 'Título',
  subtitulo: 'Subtítulo',
  texto: 'Texto',
  rodape: 'Rodapé',
  contato: 'Contatos',
  endereco: 'Endereço',
  validade: 'Validade',
  chamada: 'Chamada',
  'chamada-fundo': 'Fundo da chamada',
  'cartao-aviso': 'Cartão da imagem',
  'imagem-aviso': 'Imagem',
  'imagem-aviso-ia': 'Aviso de IA',
};

const ROTULOS_DO_PRODUTO: [RegExp, string][] = [
  [/^cartao-(\d+)$/, 'Cartão'],
  [/^imagem-(\d+)-ia$/, 'Aviso de IA'],
  [/^imagem-(\d+)$/, 'Imagem'],
  [/^nome-(\d+)$/, 'Nome'],
  [/^detalhe-(\d+)$/, 'Detalhe'],
  [/^preco-de-(\d+)$/, 'Preço anterior'],
  [/^faixa-preco-(\d+)$/, 'Faixa do preço'],
  [/^preco-(\d+)$/, 'Preço'],
  [/^unidade-(\d+)$/, 'Unidade'],
  [/^selo-fundo-(\d+)$/, 'Fundo do selo'],
  [/^selo-(\d+)$/, 'Selo'],
];

const NOMES_EXTRA: Record<ElementoPost['tipo'], string> = { texto: 'Texto', imagem: 'Imagem', retangulo: 'Retângulo', elipse: 'Círculo', estrela: 'Estrela', linha: 'Linha', qr: 'QR code' };

/** Nome do elemento na lista de camadas. */
export function rotuloElemento(e: ElementoPost, varios = false): string {
  if (e.id.startsWith('extra-')) return e.tipo === 'texto' && e.texto ? `Texto: ${e.texto.slice(0, 18)}` : NOMES_EXTRA[e.tipo];
  if (ROTULOS_FIXOS[e.id]) return ROTULOS_FIXOS[e.id];
  for (const [re, nome] of ROTULOS_DO_PRODUTO) {
    const m = re.exec(e.id);
    if (m) return varios ? `${nome} ${Number(m[1]) + 1}` : nome;
  }
  return e.id;
}

/** Texto vindo dos dados do post: escrever no elemento muda o dado, não uma cópia dele. */
export function alterarTextoDoElemento(c: ConteudoPost, id: string, texto: string): ConteudoPost | null {
  if (id === 'titulo' || id === 'subtitulo' || id === 'texto' || id === 'rodape' || id === 'validade' || id === 'endereco' || id === 'chamada') return { ...c, [id]: texto };
  for (const [re, campo] of [
    [/^nome-(\d+)$/, 'descricao'],
    [/^detalhe-(\d+)$/, 'detalhe'],
    [/^preco-(\d+)$/, 'preco'],
    [/^unidade-(\d+)$/, 'unidade'],
    [/^selo-(\d+)$/, 'selo'],
  ] as const) {
    const m = re.exec(id);
    if (m) return { ...c, produtos: c.produtos.map((p, i) => (i === Number(m[1]) ? { ...p, [campo]: texto } : p)) };
  }
  return null;
}

/** Tudo o que a arte usa de imagem, para baixar antes de desenhar. */
export function imagensDosElementos(elementos: ElementoPost[]): ImagemPost[] {
  return elementos.flatMap((e) => (e.tipo === 'imagem' ? [e.imagem] : []));
}

export type TomLegenda = 'direto' | 'animado' | 'formal';
export const TONS_LEGENDA: Record<TomLegenda, string> = { direto: 'Direto', animado: 'Animado', formal: 'Formal' };

export function legendaSugerida(modelo: ModeloPost, conteudo: ConteudoPost, marca: MarcaPost, tom: TomLegenda = 'direto'): string {
  const linhas: string[] = [];
  const animado = tom === 'animado';
  const descricaoProduto = (p: ProdutoPost) => `${p.descricao}${p.detalhe ? ` (${p.detalhe})` : ''}`;
  const valor = (p: ProdutoPost) => `${p.precoDe ? `de ${p.precoDe} por ` : ''}${p.preco}${p.unidade ? ` ${p.unidade}` : ''}`;
  if (modelo === 'PRODUTO' && conteudo.produtos[0]) {
    const p = conteudo.produtos[0];
    if (p.preco) {
      if (tom === 'formal') linhas.push(`Temos ${descricaoProduto(p)} ${p.precoDe ? valor(p) : `por ${valor(p)}`}.`);
      else if (animado) linhas.push(`Olha essa oferta! ${descricaoProduto(p)} ${p.precoDe ? valor(p) : `por apenas ${valor(p)}`}!`);
      else linhas.push(`${descricaoProduto(p)} ${p.precoDe ? valor(p) : `por ${valor(p)}`}!`);
    } else linhas.push(`${descricaoProduto(p)}.`);
  } else if (modelo === 'OFERTA') {
    linhas.push(conteudo.titulo || (animado ? 'Ofertas imperdíveis!' : 'Ofertas'));
    if (conteudo.subtitulo) linhas.push(conteudo.subtitulo);
    linhas.push(...conteudo.produtos.map((p) => `• ${descricaoProduto(p)}${p.preco ? `: ${valor(p)}` : ''}`));
  } else {
    if (conteudo.titulo) linhas.push(conteudo.titulo);
    if (conteudo.subtitulo) linhas.push(conteudo.subtitulo);
    if (conteudo.texto) linhas.push(conteudo.texto);
  }
  if (conteudo.validade) linhas.push(conteudo.validade);
  if (marca.nome) linhas.push('', tom === 'formal' ? `Conte com a ${marca.nome}.` : animado ? `Corre para a ${marca.nome}!` : `Venha conferir na ${marca.nome}.`);
  const contato = [conteudo.endereco, conteudo.telefone && `Tel. ${conteudo.telefone}`, conteudo.whatsapp && `WhatsApp ${conteudo.whatsapp}`, conteudo.site].filter(Boolean);
  if (contato.length) linhas.push(...contato.map(String));
  if (conteudo.rodape && modelo !== 'AVISO') linhas.push(conteudo.rodape);
  if (conteudo.hashtags?.trim()) linhas.push('', conteudo.hashtags.trim());
  return linhas.join('\n').trim();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COR = /^#[0-9a-f]{6}$/i;
const MAX_DESIGN = 200_000;

function problemaNaImagem(i: unknown): string | null {
  if (i === null || i === undefined) return null;
  const x = i as ImagemPost;
  if (x?.origem === 'GALERIA' && typeof x.id === 'string' && UUID.test(x.id)) return null;
  if (x?.origem === 'CATALOGO' && typeof x.url === 'string' && x.url.length <= 500 && typeof x.ia === 'boolean') return null;
  return 'Imagem inválida no post.';
}

const textoAte = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
const opcionalAte = (v: unknown, max: number) => v === undefined || textoAte(v, max);
const numeroOk = (v: unknown, limite = 5000) => v === undefined || (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limite);
const corOk = (v: unknown) => v === undefined || (typeof v === 'string' && COR.test(v));

function problemaNoEstilo(e: EstiloElemento): string | null {
  if (typeof e !== 'object' || e === null) return 'Estilo inválido no post.';
  if (![e.cor, e.cor2, e.contornoCor, e.fundoTexto, e.sombraCor, e.bordaCor].every(corOk)) return 'Cor inválida no post.';
  if (e.fonte !== undefined && !FONTES.some((f) => f.id === e.fonte)) return 'Fonte desconhecida no post.';
  if (![e.tamanho, e.espacamentoLetras, e.alturaLinha, e.contornoEspessura, e.sombraBlur, e.sombraX, e.sombraY, e.opacidade, e.raio, e.angulo, e.bordaEspessura, e.brilho, e.contraste, e.saturacao, e.pontas, e.raioInterno].every((n) => numeroOk(n))) return 'Número inválido no estilo do post.';
  return null;
}

function problemaNoDesign(d: DesignPost): string | null {
  if (typeof d !== 'object' || d === null) return 'Aparência inválida no post.';
  if (JSON.stringify(d).length > MAX_DESIGN) return 'A arte tem elementos demais.';
  if (!corOk(d.corPrincipal) || !corOk(d.corDestaque) || !corOk(d.fundo?.cor) || !corOk(d.fundo?.cor2)) return 'Cor inválida no post.';
  if (d.fontePadrao !== undefined && !FONTES.some((f) => f.id === d.fontePadrao)) return 'Fonte desconhecida no post.';
  if (d.fundo && (!['cor', 'degrade', 'imagem'].includes(d.fundo.tipo) || !numeroOk(d.fundo.angulo) || !numeroOk(d.fundo.veu, 1))) return 'Fundo inválido no post.';
  const problemaFundo = problemaNaImagem(d.fundo?.imagem);
  if (problemaFundo) return problemaFundo;
  for (const e of Object.values(d.estilos ?? {})) {
    const problema = problemaNoEstilo(e);
    if (problema) return problema;
  }
  const extras = d.extras ?? [];
  if (!Array.isArray(extras) || extras.length > 40) return 'A arte aceita até 40 elementos acrescentados.';
  for (const x of extras) {
    if (typeof x?.id !== 'string' || !x.id.startsWith('extra-') || x.id.length > 60) return 'Elemento inválido no post.';
    if (!['texto', 'imagem', 'retangulo', 'elipse', 'estrela', 'linha', 'qr'].includes(x.tipo)) return 'Elemento inválido no post.';
    if (![x.x, x.largura, x.altura].every((n) => n !== undefined && numeroOk(n)) || !numeroOk(x.yRel, 2) || x.yRel === undefined || x.largura <= 0 || x.altura <= 0) return 'Elemento inválido no post.';
    if (!opcionalAte(x.texto, 1000)) return 'Texto grande demais em um elemento.';
    if (x.vinculo !== undefined && (!vinculoValido(x.vinculo) || !numeroOk(x.vinculo.produto, 10))) return 'Relacionamento inválido em um elemento.';
    const problema = problemaNaImagem(x.imagem);
    if (problema) return problema;
  }
  return null;
}

const TIPOS_FORMATO = ['texto', 'numero', 'moeda', 'data'];

function vinculoValido(v: VinculoCampo): boolean {
  return textoAte(v?.campo, 200) && !!v.campo && (v.formato === undefined || TIPOS_FORMATO.includes(v.formato?.tipo));
}

function problemaNosVinculos(v: VinculosPost | undefined, consultaId: string | undefined): string | null {
  if (consultaId !== undefined && !(typeof consultaId === 'string' && UUID.test(consultaId))) return 'Consulta inválida no post.';
  if (v === undefined) return null;
  if (typeof v !== 'object' || v === null) return 'Relacionamento de campos inválido.';
  for (const [k, vinculo] of Object.entries(v)) {
    if (!(k in CAMPOS_PRODUTO_POST) || !vinculoValido(vinculo)) return 'Relacionamento de campos inválido.';
  }
  return null;
}

function problemaNosAjustes(ajustes: AjustesPost): string | null {
  if (typeof ajustes !== 'object' || ajustes === null) return 'Ajustes inválidos no post.';
  for (const [formato, porElemento] of Object.entries(ajustes)) {
    const valores = Object.values(porElemento ?? {});
    if (!FORMATOS_POST[formato as FormatoPost] || valores.length > 120) return 'Ajustes inválidos no post.';
    for (const a of valores) {
      if (![a?.x, a?.y, a?.largura, a?.altura, a?.rotacao].every((n) => numeroOk(n))) return 'Ajustes inválidos no post.';
      if ((a.largura !== undefined && a.largura <= 0) || (a.altura !== undefined && a.altura <= 0)) return 'Ajustes inválidos no post.';
    }
  }
  return null;
}

export function problemaNoTemplate(t: TemplatePost): string | null {
  if (typeof t !== 'object' || t === null || !MODELOS_POST[t.modelo]) return 'Template inválido.';
  if (t.variacao !== undefined && !VARIACOES_POST[t.variacao]) return 'Template inválido.';
  if (![t.telefone, t.whatsapp, t.instagram, t.site, t.endereco].every((x) => opcionalAte(x, 160)) || !opcionalAte(t.rodape, 200) || !opcionalAte(t.hashtags, 500)) return 'Algum dado do template é grande demais.';
  return problemaNosVinculos(t.vinculos, t.consultaId) ?? problemaNosAjustes(t.ajustes) ?? problemaNoDesign(t.design);
}

export function problemaNoPost(d: DadosPost): string | null {
  if (!textoAte(d.titulo, 120) || !d.titulo?.trim()) return 'Dê um nome ao post.';
  if (!MODELOS_POST[d.modelo]) return 'Modelo de post inválido.';
  if (!FORMATOS_POST[d.formato]) return 'Tamanho de post inválido.';
  if (!textoAte(d.legenda, 2200)) return 'A legenda pode ter até 2.200 caracteres, o limite do Instagram.';
  const c = d.conteudo;
  if (!c || !textoAte(c.titulo, 120) || !textoAte(c.texto, 500) || !textoAte(c.rodape, 200) || !Array.isArray(c.produtos)) return 'Título, texto ou rodapé grandes demais.';
  if (![c.subtitulo, c.chamada, c.validade, c.telefone, c.whatsapp, c.instagram, c.site, c.endereco].every((t) => opcionalAte(t, 160)) || !opcionalAte(c.hashtags, 500)) return 'Algum dado do post é grande demais.';
  if (c.variacao !== undefined && !VARIACOES_POST[c.variacao]) return 'Variação de modelo inválida.';
  const { minProdutos, maxProdutos, rotulo } = MODELOS_POST[d.modelo];
  if (c.produtos.length < minProdutos || c.produtos.length > maxProdutos) return `O modelo "${rotulo}" aceita de ${minProdutos} a ${maxProdutos} produto(s).`;
  for (const p of c.produtos) {
    if (!textoAte(p?.codigo, 200) || !textoAte(p?.descricao, 300) || !textoAte(p?.preco, 40)) return 'Dados de produto inválidos no post.';
    if (![p.precoDe, p.unidade, p.selo].every((t) => opcionalAte(t, 40)) || !opcionalAte(p.detalhe, 160)) return 'Dados de produto inválidos no post.';
    if (p.registro !== undefined && (typeof p.registro !== 'object' || p.registro === null || JSON.stringify(p.registro).length > MAX_REGISTRO)) return 'Dados de produto inválidos no post.';
    const problema = problemaNaImagem(p.imagem ?? null);
    if (problema) return problema;
  }
  const problema = problemaNaImagem(c.imagem ?? null) ?? problemaNosVinculos(c.vinculos, c.consultaId) ?? problemaNosAjustes(d.ajustes);
  if (problema) return problema;
  return d.design === undefined ? null : problemaNoDesign(d.design);
}
