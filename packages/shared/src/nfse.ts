/**
 * NFS-e no padrão nacional (Sefin Nacional / ADN). Regras puras: validação dos dados do emissor,
 * montagem da DPS e do pedido de cancelamento em XML (sem a assinatura, que é feita na API com o
 * certificado A1) e textos para as telas. Valores sempre em centavos, como nos Pedidos.
 */
import { normalizarCnpj, validarCnpj } from './cnpj';
import { cpfValido } from './entregas';

export const AMBIENTES_NFSE = ['PRODUCAO_RESTRITA', 'PRODUCAO'] as const;
export type AmbienteNfse = (typeof AMBIENTES_NFSE)[number];
export const ROTULO_AMBIENTE_NFSE: Record<AmbienteNfse, string> = {
  PRODUCAO_RESTRITA: 'Produção restrita (testes, sem valor fiscal)',
  PRODUCAO: 'Produção (nota de verdade)',
};

/** MEI, Simples Nacional (ME/EPP) ou fora do Simples (Lucro Presumido/Real). */
export const REGIMES_NFSE = ['MEI', 'SIMPLES', 'NORMAL'] as const;
export type RegimeNfse = (typeof REGIMES_NFSE)[number];
export const ROTULO_REGIME_NFSE: Record<RegimeNfse, string> = {
  MEI: 'MEI',
  SIMPLES: 'Simples Nacional (ME/EPP)',
  NORMAL: 'Fora do Simples (Lucro Presumido ou Real)',
};

/** Regime especial de tributação municipal (regEspTrib). */
export const REGIMES_ESPECIAIS_NFSE = [
  { codigo: 0, rotulo: 'Nenhum' },
  { codigo: 1, rotulo: 'Ato cooperado (cooperativa)' },
  { codigo: 2, rotulo: 'Estimativa' },
  { codigo: 3, rotulo: 'Microempresa municipal' },
  { codigo: 4, rotulo: 'Notário ou registrador' },
  { codigo: 5, rotulo: 'Profissional autônomo' },
  { codigo: 6, rotulo: 'Sociedade de profissionais' },
  { codigo: 9, rotulo: 'Outros' },
] as const;

export const SITUACOES_NOTA = ['PENDENTE', 'PROCESSANDO', 'EMITIDA', 'ERRO', 'CANCELANDO', 'CANCELADA'] as const;
export type SituacaoNota = (typeof SITUACOES_NOTA)[number];
export const ROTULO_SITUACAO_NOTA: Record<SituacaoNota, string> = {
  PENDENTE: 'Na fila',
  PROCESSANDO: 'Enviando',
  EMITIDA: 'Emitida',
  ERRO: 'Com erro',
  CANCELANDO: 'Cancelando',
  CANCELADA: 'Cancelada',
};

export const ORIGENS_NOTA = ['MENSALIDADE', 'PEDIDO', 'AVULSA'] as const;
export type OrigemNota = (typeof ORIGENS_NOTA)[number];
export const ROTULO_ORIGEM_NOTA: Record<OrigemNota, string> = { MENSALIDADE: 'Mensalidade', PEDIDO: 'Pedido', AVULSA: 'Avulsa' };

/** Valor da nota do pedido: só a taxa de entrega (os produtos são mercadoria, vão em NF-e) ou o total. */
export const VALORES_PEDIDO_NFSE = ['TAXA_ENTREGA', 'TOTAL'] as const;
export type ValorPedidoNfse = (typeof VALORES_PEDIDO_NFSE)[number];

export interface ServicoNfse {
  /** Código de tributação nacional (cTribNac): 6 dígitos, item e subitem da LC 116 + desdobramento. */
  codigoTributacaoNacional: string;
  /** Código de tributação municipal (cTribMun), 3 dígitos, quando o município pede. */
  codigoTributacaoMunicipal?: string | null;
  /** Código NBS (9 dígitos), opcional. */
  codigoNbs?: string | null;
  /** Descrição do serviço que vai na nota. */
  descricao: string;
  /**
   * Alíquota do ISS em %, ex.: 2.5. Com o município no padrão nacional, a Sefin usa a alíquota
   * cadastrada pelo município e recusa a informada; ela só vai na DPS do Simples (ME/EPP) com ISS
   * retido (`vaiAliquotaNaDps`). Nos outros casos serve para a estimativa do ISS na tela.
   */
  aliquotaIss?: number | null;
  /** Percentual aproximado dos tributos (Lei 12.741): `pTotTribSN` no Simples, `pTotTrib` federal fora dele. */
  percentualTributos?: number | null;
  /** ISS retido pelo tomador. */
  issRetido?: boolean;
}

export interface TomadorNfse {
  /** CPF (11) ou CNPJ (14), só dígitos (CNPJ pode ter letras). Sem documento, o tomador não é identificado. */
  documento?: string | null;
  nome: string;
  email?: string | null;
}

export interface AutomaticoNfse {
  /** Plataforma: emitir a nota da mensalidade ao registrar o pagamento. */
  mensalidade?: boolean;
  /** Empresa: emitir a nota do pedido concluído. */
  pedidos?: boolean;
  valorPedido?: ValorPedidoNfse;
}

export interface DadosEmissorNfse {
  ambiente: AmbienteNfse;
  cnpj: string;
  inscricaoMunicipal?: string | null;
  razaoSocial: string;
  codigoMunicipio: string;
  regime: RegimeNfse;
  regimeEspecial?: number;
  email?: string | null;
  telefone?: string | null;
  serie: string;
  proximoNumero: number;
  servico: ServicoNfse;
  automatico: AutomaticoNfse;
}

/** O que a tela recebe: nunca o certificado nem a senha. */
export interface EmissorNfseResumo extends DadosEmissorNfse {
  certificado: { titular: string | null; documento: string | null; validoAte: string | null } | null;
  /** Dias até o certificado vencer (negativo: vencido). */
  diasParaVencer: number | null;
  problema: string | null;
}

export interface EventoNota {
  em: string;
  texto: string;
  autor?: string | null;
}

export interface NotaResumo {
  id: string;
  origem: OrigemNota;
  situacao: SituacaoNota;
  ambiente: AmbienteNfse;
  serie: string;
  numeroDps: number;
  numeroNfse: string | null;
  chaveAcesso: string | null;
  tomador: TomadorNfse | null;
  descricao: string;
  valorCentavos: number;
  issCentavos: number;
  competencia: string;
  erro: string | null;
  emitidaEm: string | null;
  canceladaEm: string | null;
  motivoCancelamento: string | null;
  criadoEm: string;
  /** Pedido ligado (número) ou pagamento da mensalidade. */
  pedidoNumero: number | null;
  /** Nota da plataforma: quem emitiu. Nota recebida pela empresa: o emissor é a plataforma. */
  emitente: string;
  historico: EventoNota[];
}

export interface NovaNotaAvulsa {
  tomador: TomadorNfse | null;
  descricao?: string | null;
  valorCentavos: number;
  /** AAAA-MM-DD; sem valor, hoje. */
  competencia?: string | null;
}

/** Motivos do evento de cancelamento (e101101). */
export const MOTIVOS_CANCELAMENTO_NFSE = [
  { codigo: 1, rotulo: 'Erro na emissão' },
  { codigo: 2, rotulo: 'Serviço não prestado' },
  { codigo: 9, rotulo: 'Outros' },
] as const;
export type MotivoCancelamentoNfse = (typeof MOTIVOS_CANCELAMENTO_NFSE)[number]['codigo'];

export const LIMITE_DESCRICAO_SERVICO = 2000;
export const MIN_TEXTO_CANCELAMENTO = 15;
export const MAX_TEXTO_CANCELAMENTO = 255;
/** Esperas entre tentativas quando a Sefin está fora do ar (falha de rede ou 5xx). */
export const ESPERAS_NFSE_MS = [30_000, 120_000, 600_000, 1_800_000, 7_200_000, 21_600_000];
/** A partir de quantos dias antes do vencimento a tela avisa do certificado. */
export const DIAS_AVISO_CERTIFICADO = 30;
export const VERSAO_DPS = '1.01';
/** Série da DPS de aplicativo próprio (API): 1 a 49999 (faixas maiores são dos emissores do governo). */
export const MAX_SERIE_DPS = 49_999;
export const NAMESPACE_NFSE = 'http://www.sped.fazenda.gov.br/nfse';

const digitos = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

/** CPF com 11 dígitos ou CNPJ (numérico ou alfanumérico) normalizado; nulo se não for nenhum dos dois válido. */
export function documentoDoTomador(v: string | null | undefined): string | null {
  const bruto = (v ?? '').trim();
  if (!bruto) return null;
  const cpf = digitos(bruto);
  if (cpf.length === 11 && cpfValido(cpf)) return cpf;
  const cnpj = normalizarCnpj(bruto);
  return validarCnpj(cnpj) ? cnpj : null;
}

export function problemaNoServico(s: ServicoNfse | null | undefined, regime: RegimeNfse): string | null {
  if (!s) return 'Informe o serviço.';
  if (!/^\d{6}$/.test(s.codigoTributacaoNacional ?? '')) return 'O código de tributação nacional tem 6 dígitos (item e subitem da LC 116 + desdobramento, ex.: 140101).';
  if (s.codigoTributacaoMunicipal && !/^\d{3}$/.test(s.codigoTributacaoMunicipal)) return 'O código de tributação municipal tem 3 dígitos.';
  if (s.codigoNbs && !/^\d{9}$/.test(digitos(s.codigoNbs))) return 'O código NBS tem 9 dígitos.';
  const d = (s.descricao ?? '').trim();
  if (d.length < 5) return 'Descreva o serviço (ao menos 5 letras).';
  if (d.length > LIMITE_DESCRICAO_SERVICO) return `A descrição do serviço passa de ${LIMITE_DESCRICAO_SERVICO} caracteres.`;
  if (s.aliquotaIss != null) {
    if (regime === 'MEI') return 'MEI não informa alíquota de ISS.';
    if (!Number.isFinite(s.aliquotaIss) || s.aliquotaIss <= 0 || s.aliquotaIss > 5) return 'A alíquota do ISS vai até 5%.';
  }
  if (regime === 'MEI' && s.issRetido) return 'MEI não tem ISS retido.';
  if (regime === 'SIMPLES' && s.issRetido && !(Number(s.aliquotaIss) >= 1.8)) return 'Com ISS retido no Simples, informe a alíquota (mínimo de 1,8%).';
  if (s.percentualTributos != null && (!Number.isFinite(s.percentualTributos) || s.percentualTributos < 0 || s.percentualTributos > 100)) return 'Percentual aproximado dos tributos inválido.';
  return null;
}

export function problemaNoTomador(t: TomadorNfse | null | undefined): string | null {
  if (!t) return null;
  if (t.documento && !documentoDoTomador(t.documento)) return 'CPF ou CNPJ do tomador inválido.';
  const nome = (t.nome ?? '').trim();
  if (t.documento && nome.length < 2) return 'Informe o nome do tomador.';
  if (nome.length > 150) return 'O nome do tomador passa de 150 caracteres.';
  if (t.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.email.trim())) return 'E-mail do tomador inválido.';
  return null;
}

export function problemaNoEmissor(d: DadosEmissorNfse): string | null {
  if (!AMBIENTES_NFSE.includes(d.ambiente)) return 'Escolha o ambiente.';
  if (!validarCnpj(d.cnpj ?? '')) return 'CNPJ do emissor inválido.';
  if ((d.razaoSocial ?? '').trim().length < 2) return 'Informe a razão social.';
  if (!/^\d{7}$/.test(d.codigoMunicipio ?? '')) return 'O código do município (IBGE) tem 7 dígitos.';
  if (d.inscricaoMunicipal && !/^[0-9A-Za-z.\-/]{1,15}$/.test(d.inscricaoMunicipal.trim())) return 'Inscrição municipal inválida (até 15 caracteres).';
  if (!REGIMES_NFSE.includes(d.regime)) return 'Escolha o regime tributário.';
  if (!REGIMES_ESPECIAIS_NFSE.some((r) => r.codigo === (d.regimeEspecial ?? 0))) return 'Regime especial inválido.';
  if (d.regime !== 'NORMAL' && (d.regimeEspecial ?? 0) !== 0) return 'MEI e Simples Nacional não usam regime especial.';
  if (!/^[1-9]\d{0,4}$/.test(d.serie ?? '') || Number(d.serie) > MAX_SERIE_DPS) return `A série da DPS vai de 1 a ${MAX_SERIE_DPS} (sem zeros à esquerda).`;
  if (!Number.isInteger(d.proximoNumero) || d.proximoNumero < 1 || d.proximoNumero > 999_999_999_999_999) return 'Próximo número da DPS inválido.';
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) return 'E-mail do emissor inválido.';
  if (d.telefone && !/^\d{10,11}$/.test(digitos(d.telefone))) return 'Telefone do emissor: DDD + número.';
  if (d.automatico?.valorPedido && !VALORES_PEDIDO_NFSE.includes(d.automatico.valorPedido)) return 'Escolha o valor da nota do pedido.';
  return problemaNoServico(d.servico, d.regime);
}

/** Id da DPS: "DPS" + município (7) + tipo de inscrição (1 = CPF, 2 = CNPJ) + inscrição (14) + série (5) + número (15). */
export function idDps(codigoMunicipio: string, cnpj: string, serie: string, numero: number): string {
  return `DPS${codigoMunicipio}2${normalizarCnpj(cnpj).padStart(14, '0')}${serie.padStart(5, '0')}${String(numero).padStart(15, '0')}`;
}

/** ISS estimado em centavos (arredondado), zero sem alíquota. O valor oficial é o da nota autorizada. */
export function issDaNota(valorCentavos: number, aliquota: number | null | undefined): number {
  return aliquota ? Math.round((valorCentavos * aliquota) / 100) : 0;
}

export function decimalDeCentavos(c: number): string {
  const neg = c < 0 ? '-' : '';
  const a = Math.abs(Math.round(c));
  return `${neg}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

/** Data e hora no fuso, no formato da Sefin: 2026-11-26T10:00:00-03:00 (sem milissegundos). */
export function dataHoraNoFuso(momento: Date, fuso: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(momento)
      .map((x) => [x.type, x.value]),
  );
  const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  const min = Math.round((local - Math.floor(momento.getTime() / 1000) * 1000) / 60_000);
  const sinal = min < 0 ? '-' : '+';
  const abs = Math.abs(min);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sinal}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Escapa texto de elemento como a C14N escreve: aspas ficam como estão. */
export function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#xD;')
    // Fora do que o XML 1.0 aceita (controles), some.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** Texto em uma linha, sem espaços repetidos, cortado no limite. */
function linha(t: string, max: number): string {
  return t.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Monta `<tag>valor</tag>` (canônico: sem tag vazia autofechada), ou nada se o valor for vazio. */
function el(tag: string, valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '';
  return `<${tag}>${escaparXml(String(valor))}</${tag}>`;
}

/**
 * Leiaute da DPS. Os dois usam `versao="1.01"`: a NT 009 mudou o esquema sem trocar a versão.
 * PRODUCAO_2026 é o esquema em produção; NT_009 é o da Produção Restrita desde 20/10/2026
 * (`finNFSe` e `indDest` sobem para `infDPS` e são obrigatórios) e vai chegar à produção sem data.
 */
export const LEIAUTES_DPS = ['PRODUCAO_2026', 'NT_009'] as const;
export type LeiauteDps = (typeof LEIAUTES_DPS)[number];

/** Leiaute de cada ambiente; `emProducao` troca o da produção quando a NT 009 chegar lá. */
export function leiauteDoAmbiente(ambiente: AmbienteNfse, emProducao: LeiauteDps = 'PRODUCAO_2026'): LeiauteDps {
  return ambiente === 'PRODUCAO' ? emProducao : 'NT_009';
}

/** A alíquota só vai na DPS do Simples (ME/EPP, tudo pelo SN) com ISS retido; nos outros casos a Sefin recusa. */
export function vaiAliquotaNaDps(regime: RegimeNfse, regimeEspecial: number, s: Pick<ServicoNfse, 'aliquotaIss' | 'issRetido'>): boolean {
  return regime === 'SIMPLES' && (regimeEspecial ?? 0) === 0 && !!s.issRetido && !!s.aliquotaIss;
}

export interface DadosDps {
  emissor: Pick<DadosEmissorNfse, 'ambiente' | 'cnpj' | 'inscricaoMunicipal' | 'codigoMunicipio' | 'regime' | 'regimeEspecial' | 'email' | 'telefone'>;
  serie: string;
  numero: number;
  /** Já no formato dataHoraNoFuso (alguns segundos antes de agora: a Sefin recusa hora à frente da dela). */
  emitidaEm: string;
  competencia: string;
  tomador: TomadorNfse | null;
  servico: ServicoNfse;
  valorCentavos: number;
  versaoAplicativo: string;
  leiaute?: LeiauteDps;
}

const percentual = (n: number | null | undefined) => (Number(n) || 0).toFixed(2);

/**
 * XML da DPS, já na forma canônica (C14N): sem declaração, sem espaços entre as tags, atributos em
 * ordem e nenhuma tag autofechada. Assim a API assina exatamente estes bytes. A assinatura entra
 * depois de `</infDPS>`, como último filho de `<DPS>`. A ordem dos elementos segue o XSD.
 */
export function montarDps(d: DadosDps): string {
  const e = d.emissor;
  const leiaute = d.leiaute ?? 'PRODUCAO_2026';
  const id = idDps(e.codigoMunicipio, e.cnpj, d.serie, d.numero);
  const opSimpNac = e.regime === 'MEI' ? 2 : e.regime === 'SIMPLES' ? 3 : 1;
  const regEsp = e.regime === 'NORMAL' ? (e.regimeEspecial ?? 0) : 0;
  const regTrib = `<regTrib>${el('opSimpNac', opSimpNac)}${e.regime === 'SIMPLES' ? el('regApTribSN', 1) : ''}${el('regEspTrib', regEsp)}</regTrib>`;
  // Com tpEmit = 1 o prestador não leva nome nem endereço (vêm do cadastro nacional).
  const prest = `<prest>${el('CNPJ', normalizarCnpj(e.cnpj))}${el('IM', e.inscricaoMunicipal?.trim())}${el('fone', digitos(e.telefone) || null)}${el('email', e.email?.trim())}${regTrib}</prest>`;
  const t = d.tomador;
  const doc = documentoDoTomador(t?.documento);
  const toma = t && doc ? `<toma>${doc.length === 11 ? el('CPF', doc) : el('CNPJ', doc)}${el('xNome', linha(t.nome, 150))}${el('email', t.email?.trim())}</toma>` : '';
  const s = d.servico;
  const cServ =
    `<cServ>${el('cTribNac', s.codigoTributacaoNacional)}${el('cTribMun', s.codigoTributacaoMunicipal)}${el('cNBS', digitos(s.codigoNbs) || null)}` +
    `${el('xDescServ', linha(s.descricao, LIMITE_DESCRICAO_SERVICO))}</cServ>`;
  const serv = `<serv><locPrest>${el('cLocPrestacao', e.codigoMunicipio)}</locPrest>${cServ}</serv>`;
  const tribMun =
    `<tribMun>${el('tribISSQN', 1)}${el('tpRetISSQN', s.issRetido ? 2 : 1)}` +
    `${vaiAliquotaNaDps(e.regime, regEsp, s) ? el('pAliq', s.aliquotaIss!.toFixed(2)) : ''}</tribMun>`;
  // Total aproximado dos tributos: MEI pode "não informar"; Simples usa pTotTribSN; fora dele, pTotTrib.
  const totTrib =
    e.regime === 'MEI'
      ? `<totTrib>${el('indTotTrib', 0)}</totTrib>`
      : e.regime === 'SIMPLES'
        ? `<totTrib>${el('pTotTribSN', percentual(s.percentualTributos))}</totTrib>`
        : `<totTrib><pTotTrib>${el('pTotTribFed', percentual(s.percentualTributos))}${el('pTotTribEst', '0.00')}${el('pTotTribMun', '0.00')}</pTotTrib></totTrib>`;
  const valores = `<valores><vServPrest>${el('vServ', decimalDeCentavos(d.valorCentavos))}</vServPrest><trib>${tribMun}${totTrib}</trib></valores>`;
  // NT 009: finalidade (0 = regular) depois do tipo de emitente e destinatário (0 = o próprio tomador) depois do tomador.
  const nt009 = leiaute === 'NT_009';
  const inf =
    `<infDPS Id="${id}">${el('tpAmb', e.ambiente === 'PRODUCAO' ? 1 : 2)}${el('dhEmi', d.emitidaEm)}${el('verAplic', linha(d.versaoAplicativo, 20))}` +
    `${el('serie', d.serie)}${el('nDPS', d.numero)}${el('dCompet', d.competencia)}${el('tpEmit', 1)}${nt009 ? el('finNFSe', 0) : ''}${el('cLocEmi', e.codigoMunicipio)}` +
    `${prest}${toma}${nt009 ? el('indDest', 0) : ''}${serv}${valores}</infDPS>`;
  return `<DPS xmlns="${NAMESPACE_NFSE}" versao="${VERSAO_DPS}">${inf}</DPS>`;
}

/** Id do pedido de evento: "PRE" + chave de acesso (50) + código do evento (6). */
export function idPedidoEvento(chaveAcesso: string, codigoEvento = '101101'): string {
  return `PRE${chaveAcesso}${codigoEvento}`;
}

export function problemaNoCancelamento(motivo: number, texto: string): string | null {
  if (!MOTIVOS_CANCELAMENTO_NFSE.some((m) => m.codigo === motivo)) return 'Escolha o motivo do cancelamento.';
  const t = (texto ?? '').trim();
  if (t.length < MIN_TEXTO_CANCELAMENTO) return `Explique o cancelamento (ao menos ${MIN_TEXTO_CANCELAMENTO} letras).`;
  if (t.length > MAX_TEXTO_CANCELAMENTO) return `A explicação passa de ${MAX_TEXTO_CANCELAMENTO} caracteres.`;
  return null;
}

export interface DadosCancelamento {
  ambiente: AmbienteNfse;
  cnpjAutor: string;
  chaveAcesso: string;
  emitidoEm: string;
  motivo: MotivoCancelamentoNfse;
  texto: string;
  versaoAplicativo: string;
}

/** Pedido de registro do evento de cancelamento (e101101), canônico como a DPS. */
export function montarPedidoCancelamento(d: DadosCancelamento): string {
  const inf =
    `<infPedReg Id="${idPedidoEvento(d.chaveAcesso)}">${el('tpAmb', d.ambiente === 'PRODUCAO' ? 1 : 2)}${el('verAplic', linha(d.versaoAplicativo, 20))}` +
    `${el('dhEvento', d.emitidoEm)}${el('CNPJAutor', normalizarCnpj(d.cnpjAutor))}${el('chNFSe', d.chaveAcesso)}` +
    `<e101101>${el('xDesc', 'Cancelamento de NFS-e')}${el('cMotivo', d.motivo)}${el('xMotivo', linha(d.texto, MAX_TEXTO_CANCELAMENTO))}</e101101></infPedReg>`;
  return `<pedRegEvento xmlns="${NAMESPACE_NFSE}" versao="${VERSAO_DPS}">${inf}</pedRegEvento>`;
}

export function podeCancelarNota(s: SituacaoNota): boolean {
  return s === 'EMITIDA';
}

/** Emitir de novo: a nota com erro volta à fila (com os dados fiscais de agora). */
export function podeEmitirDeNovo(s: SituacaoNota): boolean {
  return s === 'ERRO';
}

/** Mês da competência por extenso curto: "11/2026". */
function mesAno(iso: string): string {
  return `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Descrição da nota da mensalidade: o serviço padrão + o período pago. */
export function descricaoDaMensalidade(base: string, vencimentoQuitado: string, meses: number): string {
  const periodo = meses === 1 ? `mensalidade de ${mesAno(vencimentoQuitado)}` : `${meses} mensalidades a partir de ${mesAno(vencimentoQuitado)}`;
  return `${base.trim()} - ${periodo}`.slice(0, LIMITE_DESCRICAO_SERVICO);
}

export function descricaoDoPedido(base: string, numero: number, modo: ValorPedidoNfse): string {
  return `${base.trim()} - ${modo === 'TAXA_ENTREGA' ? 'entrega do pedido' : 'pedido'} nº ${numero}`.slice(0, LIMITE_DESCRICAO_SERVICO);
}

export function valorDoPedidoNaNota(p: { taxaCentavos: number; totalCentavos: number }, modo: ValorPedidoNfse | undefined): number {
  return (modo ?? 'TAXA_ENTREGA') === 'TOTAL' ? p.totalCentavos : p.taxaCentavos;
}

/** Dias inteiros até `validoAte` (negativo: vencido). */
export function diasParaVencer(validoAte: Date | string, agora: Date): number {
  return Math.floor((new Date(validoAte).getTime() - agora.getTime()) / 86_400_000);
}

/** Falha da Sefin que vale tentar de novo sozinho (fora do ar), em vez de parar com erro. */
export function falhaTemporaria(status: number | null): boolean {
  return status === null || status === 408 || status === 429 || status >= 500;
}

export function esperaDaTentativa(tentativas: number): number | null {
  return tentativas < ESPERAS_NFSE_MS.length ? ESPERAS_NFSE_MS[tentativas] : null;
}
