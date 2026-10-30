/**
 * Layout de etiqueta. Todas as medidas em milímetros; os geradores convertem para pontos
 * conforme o DPI da impressora. O editor (Konva) e os geradores leem o mesmo layout.
 */

export type LinguagemImpressora = 'ZPL' | 'PPLA' | 'PPLB' | 'ESCPOS' | 'PDF';

export const LINGUAGENS: readonly LinguagemImpressora[] = ['ZPL', 'PPLA', 'PPLB', 'ESCPOS', 'PDF'];

export const ROTULO_LINGUAGEM: Record<LinguagemImpressora, string> = {
  ZPL: 'Zebra (ZPL)',
  PPLA: 'Argox (PPLA)',
  PPLB: 'Argox (PPLB)',
  ESCPOS: 'Térmica 80 mm (ESC/POS)',
  PDF: 'Impressora comum (PDF)',
};

export const DPIS = [152, 203, 300, 600] as const;

export type Rotacao = 0 | 90 | 180 | 270;
export type Alinhamento = 'esquerda' | 'centro' | 'direita';
export type Simbologia = 'EAN13' | 'EAN8' | 'CODE128' | 'CODE39';

export const SIMBOLOGIAS: readonly Simbologia[] = ['EAN13', 'EAN8', 'CODE128', 'CODE39'];
export const ROTULO_SIMBOLOGIA: Record<Simbologia, string> = {
  EAN13: 'EAN-13',
  EAN8: 'EAN-8',
  CODE128: 'Code 128',
  CODE39: 'Code 39',
};

/** De onde vem o conteúdo de um texto, código de barras ou QR code. */
export type OrigemValor =
  | { tipo: 'fixo'; texto: string }
  | { tipo: 'campo'; campo: string; formato?: FormatoCampo }
  /** Data de hoje mais `dias` (ex.: validade = hoje + 3). */
  | { tipo: 'data'; dias: number; formato: FormatoData }
  /** Numeração sequencial ao longo do lote. */
  | { tipo: 'contador'; inicio: number; passo: number; digitos: number };

export type FormatoData = 'dd/MM/yyyy' | 'dd/MM/yy' | 'dd/MM' | 'yyyy-MM-dd' | 'MM/yyyy';
export const FORMATOS_DATA: readonly FormatoData[] = ['dd/MM/yyyy', 'dd/MM/yy', 'dd/MM', 'yyyy-MM-dd', 'MM/yyyy'];

export type FormatoCampo =
  | { tipo: 'texto' }
  | { tipo: 'numero'; casas: number }
  | { tipo: 'moeda'; casas: number }
  | { tipo: 'data'; formato: FormatoData };

/**
 * Campos opcionais (`?`) vieram com o editor de design (cartazes em jato de tinta). Layouts
 * antigos não os têm: valem os padrões indicados. As térmicas ignoram a maioria (com aviso).
 */
interface ElementoBase {
  id: string;
  x: number;
  y: number;
  largura: number;
  altura: number;
  rotacao: Rotacao;
  /** 0 (invisível) a 1 (padrão). Só no PDF. */
  opacidade?: number;
  /** Travado no editor (não arrasta nem redimensiona). */
  travado?: boolean;
}

/** Cor em hexadecimal, `#rrggbb`. */
export type Cor = string;

export type AlinhamentoVertical = 'topo' | 'meio' | 'base';
export type CaixaTexto = 'normal' | 'maiusculas' | 'minusculas';

export interface Contorno {
  cor: Cor;
  espessuraPt: number;
}

/** Estilo de fonte comum a texto e preço. */
interface EstiloFonte {
  /** Altura da fonte em pontos tipográficos (1 pt = 0,3528 mm). */
  tamanhoPt: number;
  negrito: boolean;
  alinhamento: Alinhamento;
  /** Id do catálogo `FONTES` (padrão: helvetica). */
  fonte?: string;
  italico?: boolean;
  /** Padrão: preto. */
  cor?: Cor;
  alinhamentoVertical?: AlinhamentoVertical;
  contorno?: Contorno | null;
  /** Cor de fundo da caixa do elemento (null/ausente = transparente). */
  corFundo?: Cor | null;
  /** Diminui a fonte até o conteúdo caber na caixa. */
  ajustar?: boolean;
}

export interface ElementoTexto extends ElementoBase, EstiloFonte {
  tipo: 'texto';
  valor: OrigemValor;
  prefixo: string;
  sufixo: string;
  sublinhado?: boolean;
  tachado?: boolean;
  /** Espaço extra entre letras, em pt (pode ser negativo). */
  espacamentoLetras?: number;
  /** Múltiplo do tamanho da fonte (padrão 1,15). */
  alturaLinha?: number;
  caixa?: CaixaTexto;
}

/**
 * Preço de cartaz: símbolo pequeno, reais grandes e centavos sobrescritos ("R$ 9,⁹⁹").
 * O valor vem de um número (campo ou fixo) e é formatado com 2 casas.
 */
export interface ElementoPreco extends ElementoBase, EstiloFonte {
  tipo: 'preco';
  valor: OrigemValor;
  /** Ex.: "R$"; vazio = sem símbolo. */
  simbolo: string;
  /** Centavos menores e alinhados ao topo; desligado = tudo no mesmo tamanho. */
  centavosSobrescritos: boolean;
}

export interface ElementoCodigoBarras extends ElementoBase {
  tipo: 'codigo_barras';
  valor: OrigemValor;
  simbologia: Simbologia;
  /** Imprime os dígitos abaixo das barras. */
  mostrarTexto: boolean;
}

export interface ElementoQrCode extends ElementoBase {
  tipo: 'qrcode';
  valor: OrigemValor;
}

/** Preenchimento e borda das formas. Borda com espessura 0 = sem borda. */
interface EstiloForma {
  espessuraMm: number;
  preenchido: boolean;
  /** Padrão: preto. */
  corPreenchimento?: Cor;
  /** Padrão: preto. */
  corBorda?: Cor;
  tracejado?: boolean;
}

export interface ElementoRetangulo extends ElementoBase, EstiloForma {
  tipo: 'retangulo';
  /** Raio dos cantos arredondados. */
  raioMm?: number;
}

export interface ElementoElipse extends ElementoBase, EstiloForma {
  tipo: 'elipse';
}

/** Estrela ou "explosão" de oferta, inscrita na caixa. */
export interface ElementoEstrela extends ElementoBase, EstiloForma {
  tipo: 'estrela';
  pontas: number;
  /** Raio interno como fração do externo (0,1 a 0,95). */
  raioInterno: number;
}

export interface ElementoLinha extends ElementoBase {
  tipo: 'linha';
  /** Linha horizontal ocupando a largura (ou vertical, se altura > largura). */
  espessuraMm: number;
  cor?: Cor;
  tracejado?: boolean;
}

/**
 * Imagem enviada pelo usuário (logotipo, selo…), guardada em tons de cinza já reduzida
 * (no máximo 480 px no maior lado). Cada gerador converte para preto e branco na
 * resolução da impressora, esticando para a caixa do elemento.
 */
export interface ElementoImagem extends ElementoBase {
  tipo: 'imagem';
  /** Nome do arquivo original, só para exibição. */
  nome: string;
  larguraPx: number;
  alturaPx: number;
  /** larguraPx × alturaPx bytes em base64, linha a linha; 0 = preto, 255 = branco (transparência vira branco). */
  cinza: string;
  /** Tons abaixo deste valor (0–255) imprimem preto nas térmicas. */
  limiar: number;
  /** Pontilhado (Floyd–Steinberg) para fotos e degradês nas térmicas, em vez de corte no limiar. */
  pontilhado: boolean;
  /** Imagem colorida (data URL PNG ou JPEG, até 1600 px) usada no PDF e no editor. Sem ela, vale o cinza. */
  original?: string;
}

export type ElementoEtiqueta =
  | ElementoTexto
  | ElementoPreco
  | ElementoCodigoBarras
  | ElementoQrCode
  | ElementoRetangulo
  | ElementoElipse
  | ElementoEstrela
  | ElementoLinha
  | ElementoImagem;
export type TipoElemento = ElementoEtiqueta['tipo'];

export type Papel = { tipo: 'rolo' } | { tipo: 'folha'; larguraMm: number; alturaMm: number };

export interface LayoutEtiqueta {
  larguraMm: number;
  alturaMm: number;
  /** Etiquetas lado a lado no rolo ou por linha da folha. */
  colunas: number;
  espacamentoHorizontalMm: number;
  espacamentoVerticalMm: number;
  margens: { superior: number; inferior: number; esquerda: number; direita: number };
  papel: Papel;
  /** Cor de fundo de cada etiqueta (padrão: branco/sem fundo). Só no PDF. */
  corFundo?: Cor | null;
  elementos: ElementoEtiqueta[];
}

export const LAYOUT_PADRAO: LayoutEtiqueta = {
  larguraMm: 60,
  alturaMm: 40,
  colunas: 1,
  espacamentoHorizontalMm: 2,
  espacamentoVerticalMm: 3,
  margens: { superior: 0, inferior: 0, esquerda: 0, direita: 0 },
  papel: { tipo: 'rolo' },
  elementos: [],
};

/** Registro de dados de uma etiqueta: uma linha da consulta, coluna → valor. */
export type Registro = Record<string, unknown>;

export interface ModeloEtiquetaResumo {
  id: string;
  nome: string;
  descricao: string | null;
  consultaId: string | null;
  /** Impressora usada na lista do dia e sugerida na avulsa. */
  impressoraId: string | null;
  /** Entra na lista do dia (a consulta deve ter finalidade "Lista do dia"). */
  naListaDiaria: boolean;
  layout: LayoutEtiqueta;
  ativo: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

/** Consulta vista pelo editor de etiquetas: campos e parâmetros, sem o SQL. */
export interface ConsultaParaModelo {
  id: string;
  nome: string;
  finalidade: 'LISTA_DIARIA' | 'BUSCA_PRODUTO' | 'OUTRA';
  campos: { nome: string; tipoBanco: string; categoria: 'texto' | 'numero' | 'data' | 'data_hora' | 'booleano' | 'binario' }[];
  /** Nomes dos `{param.*}` que a consulta exige. */
  parametros: string[];
}

export interface AmostraModelo {
  registros: Registro[];
  campos: ConsultaParaModelo['campos'];
  /** Campos usados no layout que a consulta não devolve mais. */
  camposAusentes: string[];
}

export type MetodoImpressora = 'REDE' | 'SISTEMA';

export interface ImpressoraResumo {
  id: string;
  nome: string;
  agenteId: string | null;
  linguagem: LinguagemImpressora;
  dpi: number;
  /** REDE: envio direto para IP:porta (9100). SISTEMA: impressora instalada no computador do agente. */
  metodo: MetodoImpressora;
  /** IP:porta ou nome da impressora no sistema. */
  endereco: string;
  modelo: string | null;
  larguraMaximaMm: number | null;
  ativo: boolean;
  criadoEm: string;
}

/** Saída de um gerador. Texto (ZPL, PPL) em UTF-8/Latin-1; binário (ESC/POS, PDF) em base64. */
export interface SaidaEtiquetas {
  linguagem: LinguagemImpressora;
  mime: string;
  codificacao: 'texto' | 'base64';
  conteudo: string;
  /** Recursos do layout que a linguagem não suporta e foram simplificados ou ignorados. */
  avisos: string[];
}
