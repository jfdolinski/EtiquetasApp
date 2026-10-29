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

interface ElementoBase {
  id: string;
  x: number;
  y: number;
  largura: number;
  altura: number;
  rotacao: Rotacao;
}

export interface ElementoTexto extends ElementoBase {
  tipo: 'texto';
  valor: OrigemValor;
  prefixo: string;
  sufixo: string;
  /** Altura da fonte em pontos tipográficos (1 pt = 0,3528 mm). */
  tamanhoPt: number;
  negrito: boolean;
  alinhamento: Alinhamento;
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

export interface ElementoRetangulo extends ElementoBase {
  tipo: 'retangulo';
  espessuraMm: number;
  preenchido: boolean;
}

export interface ElementoLinha extends ElementoBase {
  tipo: 'linha';
  /** Linha horizontal ocupando a largura (ou vertical, se altura > largura). */
  espessuraMm: number;
}

export type ElementoEtiqueta = ElementoTexto | ElementoCodigoBarras | ElementoQrCode | ElementoRetangulo | ElementoLinha;
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
