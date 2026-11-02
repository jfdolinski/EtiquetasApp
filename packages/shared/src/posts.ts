import type { Registro } from './etiquetas/tipos';
import { chaveDoRegistro, descricaoDoRegistro } from './impressao';

/**
 * Posts para redes sociais. Os dados do produto vêm do ERP, as imagens do catálogo ou da galeria
 * da empresa. O post guarda só o conteúdo: a arte é montada por `montarPost`, igual em cada tamanho.
 */
export type FormatoPost = 'QUADRADO' | 'RETRATO' | 'STORIES';
export type ModeloPost = 'PRODUTO' | 'OFERTA' | 'AVISO';

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

export type ImagemPost = { origem: 'CATALOGO'; url: string; ia: boolean } | { origem: 'GALERIA'; id: string };

export interface ProdutoPost {
  codigo: string;
  descricao: string;
  /** Texto pronto: "R$ 4,99". Vem do ERP e pode ser corrigido no post. */
  preco: string;
  imagem: ImagemPost | null;
  /** O catálogo diz que é medicamento: a tela avisa das regras de propaganda. */
  medicamento?: boolean;
}

export interface ConteudoPost {
  titulo: string;
  texto: string;
  rodape: string;
  produtos: ProdutoPost[];
  imagem: ImagemPost | null;
}

export interface AjusteElemento {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

/** Edição livre: posição por tamanho de post e por elemento. O que não foi mexido segue o modelo. */
export type AjustesPost = Partial<Record<FormatoPost, Record<string, AjusteElemento>>>;

export interface DadosPost {
  titulo: string;
  modelo: ModeloPost;
  formato: FormatoPost;
  conteudo: ConteudoPost;
  legenda: string;
  ajustes: AjustesPost;
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
  medicamento: boolean;
  imagens: ImagemCatalogo[];
  /** O catálogo não respondeu ou recusou: dá para seguir com imagem própria. */
  aviso: string | null;
}

export interface ConsultaPost {
  id: string;
  nome: string;
}

export interface BuscaProdutosPost {
  produtos: ProdutoPost[];
  banidos: number;
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
export function produtoDoRegistro(registro: Registro): ProdutoPost {
  const barras = Object.keys(registro).find((c) => /ean|gtin|barra|codbar/i.test(c) && registro[c]);
  return {
    codigo: barras ? String(registro[barras]).trim() : chaveDoRegistro(registro),
    descricao: descricaoDoRegistro(registro),
    preco: precoDoRegistro(registro),
    imagem: null,
  };
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

interface BaseElemento extends AjusteElemento {
  id: string;
  /** Fundo não é arrastado na edição livre. */
  fixo?: boolean;
}
export interface RetanguloPost extends BaseElemento {
  tipo: 'retangulo';
  cor: string;
  raio: number;
}
export interface FotoPost extends BaseElemento {
  tipo: 'imagem';
  imagem: ImagemPost;
}
export interface TextoPost extends BaseElemento {
  tipo: 'texto';
  texto: string;
  cor: string;
  /** Tamanho máximo: a tela reduz até caber no quadro. */
  tamanho: number;
  negrito: boolean;
  alinhamento: 'left' | 'center';
}
export type ElementoPost = RetanguloPost | FotoPost | TextoPost;

const MARGEM = 60;
const CARTAO = '#ffffff';
const TEXTO_CARTAO = '#0f172a';

/** A arte do post, em pixels do tamanho escolhido. Nos stories, topo e base ficam livres: o Instagram cobre essas faixas. */
export function montarPost(dados: Pick<DadosPost, 'modelo' | 'formato' | 'conteudo' | 'ajustes'>, marca: MarcaPost): ElementoPost[] {
  const { largura: w, altura: h } = FORMATOS_POST[dados.formato];
  const { conteudo: c } = dados;
  const seguro = dados.formato === 'STORIES' ? 230 : 50;
  const util = w - 2 * MARGEM;
  const sobre = corSobre(marca.corPrincipal);
  const elementos: ElementoPost[] = [{ id: 'fundo', tipo: 'retangulo', x: 0, y: 0, largura: w, altura: h, cor: marca.corPrincipal, raio: 0, fixo: true }];
  const texto = (id: string, t: string, x: number, y: number, largura: number, altura: number, tamanho: number, opcoes: { cor?: string; negrito?: boolean; alinhamento?: 'left' | 'center' } = {}) => {
    if (t.trim()) elementos.push({ id, tipo: 'texto', texto: t.trim(), x, y, largura, altura, tamanho, cor: opcoes.cor ?? sobre, negrito: opcoes.negrito ?? false, alinhamento: opcoes.alinhamento ?? 'center' });
  };
  /** Imagem e, se foi gerada por IA, o aviso logo abaixo dela. */
  const imagem = (id: string, i: ImagemPost | null, x: number, y: number, largura: number, altura: number) => {
    if (!i) return;
    const ia = i.origem === 'CATALOGO' && i.ia;
    elementos.push({ id, tipo: 'imagem', imagem: i, x, y, largura, altura: ia ? altura - 28 : altura });
    if (ia) texto(`${id}-ia`, 'Imagem gerada por IA', x, y + altura - 26, largura, 26, 20, { cor: '#475569' });
  };

  const topo = seguro;
  if (marca.logoId) elementos.push({ id: 'logo', tipo: 'imagem', imagem: { origem: 'GALERIA', id: marca.logoId }, x: (w - 320) / 2, y: topo, largura: 320, altura: 110 });
  else texto('marca', marca.nome, MARGEM, topo, util, 110, 54, { negrito: true });
  const fim = h - seguro;
  const inicio = topo + 130;
  const baseConteudo = c.rodape.trim() ? fim - 80 : fim;
  texto('rodape', c.rodape, MARGEM, fim - 64, util, 64, 26);

  if (dados.modelo === 'PRODUTO') {
    const p = c.produtos[0];
    const alturaPreco = 140;
    const alturaNome = 140;
    const alturaCartao = baseConteudo - inicio - alturaPreco - alturaNome - 40;
    elementos.push({ id: 'cartao-0', tipo: 'retangulo', x: MARGEM, y: inicio, largura: util, altura: alturaCartao, cor: CARTAO, raio: 32 });
    imagem('imagem-0', p?.imagem ?? null, MARGEM + 30, inicio + 24, util - 60, alturaCartao - 48);
    texto('nome-0', p?.descricao ?? '', MARGEM, inicio + alturaCartao + 16, util, alturaNome, 60, { negrito: true });
    const yPreco = baseConteudo - alturaPreco;
    if (p?.preco.trim()) {
      elementos.push({ id: 'faixa-preco-0', tipo: 'retangulo', x: 240, y: yPreco, largura: w - 480, altura: alturaPreco, cor: marca.corDestaque, raio: 28 });
      texto('preco-0', p.preco, 260, yPreco + 10, w - 520, alturaPreco - 20, 96, { cor: corSobre(marca.corDestaque), negrito: true });
    }
  } else if (dados.modelo === 'OFERTA') {
    const alturaTitulo = c.titulo.trim() ? 110 : 0;
    texto('titulo', c.titulo, MARGEM, inicio, util, alturaTitulo, 72, { negrito: true });
    const y0 = inicio + alturaTitulo + (alturaTitulo ? 16 : 0);
    const n = c.produtos.length;
    const linhas = Math.max(1, Math.ceil(n / 2));
    const espaco = 24;
    const alturaCelula = (baseConteudo - y0 - espaco * (linhas - 1)) / linhas;
    c.produtos.forEach((p, i) => {
      const inteira = n % 2 === 1 && i === n - 1;
      const larguraCelula = inteira ? util : (util - espaco) / 2;
      const x = MARGEM + (i % 2) * ((util - espaco) / 2 + espaco);
      const y = y0 + Math.floor(i / 2) * (alturaCelula + espaco);
      const alturaPreco = Math.min(90, alturaCelula * 0.22);
      const alturaNome = Math.min(90, alturaCelula * 0.22);
      elementos.push({ id: `cartao-${i}`, tipo: 'retangulo', x, y, largura: larguraCelula, altura: alturaCelula, cor: CARTAO, raio: 24 });
      imagem(`imagem-${i}`, p.imagem, x + 16, y + 14, larguraCelula - 32, alturaCelula - alturaPreco - alturaNome - 32);
      texto(`nome-${i}`, p.descricao, x + 14, y + alturaCelula - alturaPreco - alturaNome - 12, larguraCelula - 28, alturaNome, 32, { cor: TEXTO_CARTAO, negrito: true });
      if (p.preco.trim()) {
        const yP = y + alturaCelula - alturaPreco - 10;
        elementos.push({ id: `faixa-preco-${i}`, tipo: 'retangulo', x: x + 14, y: yP, largura: larguraCelula - 28, altura: alturaPreco, cor: marca.corDestaque, raio: 16 });
        texto(`preco-${i}`, p.preco, x + 20, yP + 4, larguraCelula - 40, alturaPreco - 8, 54, { cor: corSobre(marca.corDestaque), negrito: true });
      }
    });
  } else {
    const temImagem = !!c.imagem;
    const area = baseConteudo - inicio;
    const alturaTitulo = Math.min(280, area * (temImagem ? 0.25 : 0.35));
    texto('titulo', c.titulo, MARGEM, inicio, util, alturaTitulo, 88, { negrito: true });
    const alturaTexto = temImagem ? area * 0.25 : area - alturaTitulo - 20;
    texto('texto', c.texto, MARGEM, inicio + alturaTitulo + 10, util, alturaTexto, 50);
    if (temImagem) {
      const y = inicio + alturaTitulo + alturaTexto + 20;
      const altura = baseConteudo - y;
      elementos.push({ id: 'cartao-aviso', tipo: 'retangulo', x: MARGEM, y, largura: util, altura, cor: CARTAO, raio: 32 });
      imagem('imagem-aviso', c.imagem, MARGEM + 24, y + 20, util - 48, altura - 40);
    }
  }

  const ajustes = dados.ajustes[dados.formato] ?? {};
  return elementos.map((e) => (ajustes[e.id] ? { ...e, ...ajustes[e.id] } : e));
}

export function legendaSugerida(modelo: ModeloPost, conteudo: ConteudoPost, marca: MarcaPost): string {
  const linhas: string[] = [];
  if (modelo === 'PRODUTO' && conteudo.produtos[0]) {
    const p = conteudo.produtos[0];
    linhas.push(p.preco ? `${p.descricao} por ${p.preco}!` : `${p.descricao}.`);
  } else if (modelo === 'OFERTA') {
    if (conteudo.titulo) linhas.push(conteudo.titulo);
    linhas.push(...conteudo.produtos.map((p) => `• ${p.descricao}${p.preco ? `: ${p.preco}` : ''}`));
  } else {
    if (conteudo.titulo) linhas.push(conteudo.titulo);
    if (conteudo.texto) linhas.push(conteudo.texto);
  }
  if (marca.nome) linhas.push('', `Venha conferir na ${marca.nome}.`);
  if (conteudo.rodape && modelo !== 'AVISO') linhas.push(conteudo.rodape);
  return linhas.join('\n').trim();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function problemaNaImagem(i: unknown): string | null {
  if (i === null) return null;
  const x = i as ImagemPost;
  if (x?.origem === 'GALERIA' && typeof x.id === 'string' && UUID.test(x.id)) return null;
  if (x?.origem === 'CATALOGO' && typeof x.url === 'string' && x.url.length <= 500 && typeof x.ia === 'boolean') return null;
  return 'Imagem inválida no post.';
}

const textoAte = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;

export function problemaNoPost(d: DadosPost): string | null {
  if (!textoAte(d.titulo, 120) || !d.titulo?.trim()) return 'Dê um nome ao post.';
  if (!MODELOS_POST[d.modelo]) return 'Modelo de post inválido.';
  if (!FORMATOS_POST[d.formato]) return 'Tamanho de post inválido.';
  if (!textoAte(d.legenda, 2200)) return 'A legenda pode ter até 2.200 caracteres, o limite do Instagram.';
  const c = d.conteudo;
  if (!c || !textoAte(c.titulo, 120) || !textoAte(c.texto, 500) || !textoAte(c.rodape, 200) || !Array.isArray(c.produtos)) return 'Título, texto ou rodapé grandes demais.';
  const { minProdutos, maxProdutos, rotulo } = MODELOS_POST[d.modelo];
  if (c.produtos.length < minProdutos || c.produtos.length > maxProdutos) return `O modelo "${rotulo}" aceita de ${minProdutos} a ${maxProdutos} produto(s).`;
  for (const p of c.produtos) {
    if (!textoAte(p?.codigo, 200) || !textoAte(p?.descricao, 300) || !textoAte(p?.preco, 40)) return 'Dados de produto inválidos no post.';
    const problema = problemaNaImagem(p.imagem ?? null);
    if (problema) return problema;
  }
  const problema = problemaNaImagem(c.imagem ?? null);
  if (problema) return problema;
  if (typeof d.ajustes !== 'object' || d.ajustes === null) return 'Ajustes inválidos no post.';
  for (const [formato, porElemento] of Object.entries(d.ajustes)) {
    const valores = Object.values(porElemento ?? {});
    if (!FORMATOS_POST[formato as FormatoPost] || valores.length > 60) return 'Ajustes inválidos no post.';
    for (const a of valores) {
      const numeros = [a?.x, a?.y, a?.largura, a?.altura];
      if (!numeros.every((n) => Number.isFinite(n) && Math.abs(n) <= 5000) || a.largura <= 0 || a.altura <= 0) return 'Ajustes inválidos no post.';
    }
  }
  return null;
}
