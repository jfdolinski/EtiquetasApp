// Módulo de Entregas (docs/ENTREGAS.md), etapa 1: entregador, créditos por diária, online e mapa.
// Regras puras: a API e o site usam daqui; o app do entregador tem cópias conferidas em entregas-app.test.ts.

import { normalizarCelular } from './pedidos';
import type { OfertaResumo, TabelaPrecos } from './entregas-chamadas';
import type { RegrasDirecionamento } from './entregas-direcionamento';
import type { Adicionais } from './entregas-paradas';
import type { FotosObrigatorias } from './entregas-operacao';

// Entregador ------------------------------------------------------------------------------

export const TIPOS_VEICULO = ['MOTO', 'CARRO', 'BICICLETA', 'A_PE'] as const;
export type TipoVeiculo = (typeof TIPOS_VEICULO)[number];

export const ROTULO_VEICULO: Record<TipoVeiculo, string> = { MOTO: 'Moto', CARRO: 'Carro', BICICLETA: 'Bicicleta', A_PE: 'A pé' };

/** Motorizado: tem placa, CNH e documento do veículo. */
export const veiculoMotorizado = (v: TipoVeiculo) => v === 'MOTO' || v === 'CARRO';

export const SITUACOES_ENTREGADOR = ['PENDENTE', 'APROVADO', 'RECUSADO', 'SUSPENSO'] as const;
export type SituacaoEntregador = (typeof SITUACOES_ENTREGADOR)[number];

export const ROTULO_SITUACAO_ENTREGADOR: Record<SituacaoEntregador, string> = {
  PENDENTE: 'Aguardando aprovação',
  APROVADO: 'Aprovado',
  RECUSADO: 'Recusado',
  SUSPENSO: 'Suspenso',
};

export const TIPOS_DOCUMENTO_ENTREGADOR = ['SELFIE', 'CNH', 'CRLV'] as const;
export type TipoDocumentoEntregador = (typeof TIPOS_DOCUMENTO_ENTREGADOR)[number];

export const ROTULO_DOCUMENTO: Record<TipoDocumentoEntregador, string> = {
  SELFIE: 'Foto do rosto',
  CNH: 'CNH (carteira de motorista)',
  CRLV: 'Documento do veículo (CRLV)',
};

export function documentosExigidos(veiculo: TipoVeiculo): TipoDocumentoEntregador[] {
  return veiculoMotorizado(veiculo) ? ['SELFIE', 'CNH', 'CRLV'] : ['SELFIE'];
}

/** Até 5 MB por imagem de documento ou comprovante. */
export const DOCUMENTO_TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024;

/** Versão dos termos aceitos no cadastro: mudou o texto, sobe o número. */
export const VERSAO_TERMOS_ENTREGADOR = 1;

export function normalizarCpf(v: string): string {
  return (v ?? '').replace(/\D/g, '');
}

export function cpfValido(v: string): boolean {
  const d = normalizarCpf(v);
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const digito = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digito(9) === Number(d[9]) && digito(10) === Number(d[10]);
}

export const formatarCpf = (d: string) => (d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d);

/** Placa antiga (ABC1234) ou Mercosul (ABC1D23), sem traço e em maiúsculas. */
export function normalizarPlaca(v: string): string | null {
  const p = (v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(p) ? p : null;
}

/** Só o primeiro nome vai para as empresas. */
export function primeiroNome(nome: string): string {
  return (nome ?? '').trim().split(/\s+/)[0] ?? '';
}

export interface DadosCadastroEntregador {
  nome: string;
  cpf: string;
  celular: string;
  email: string;
  senha: string;
  veiculo: TipoVeiculo;
  placa?: string | null;
  chavePix: string;
  aceitaTermos: boolean;
}

export const SENHA_ENTREGADOR_MINIMO = 8;

export function problemaNoCadastroEntregador(d: DadosCadastroEntregador): string | null {
  if ((d.nome ?? '').trim().split(/\s+/).length < 2) return 'Informe o nome completo.';
  if (!cpfValido(d.cpf)) return 'CPF inválido.';
  if (!normalizarCelular(d.celular)) return 'Informe um celular com DDD.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((d.email ?? '').trim())) return 'E-mail inválido.';
  if ((d.senha ?? '').length < SENHA_ENTREGADOR_MINIMO) return `A senha precisa ter ao menos ${SENHA_ENTREGADOR_MINIMO} caracteres.`;
  if (!TIPOS_VEICULO.includes(d.veiculo)) return 'Escolha o veículo.';
  if (veiculoMotorizado(d.veiculo) && !normalizarPlaca(d.placa ?? '')) return 'Placa inválida.';
  if ((d.chavePix ?? '').trim().length < 3) return 'Informe a chave Pix para receber das empresas.';
  if (!d.aceitaTermos) return 'É preciso aceitar os termos para se cadastrar.';
  return null;
}

// Créditos (diárias) ----------------------------------------------------------------------

export interface PacoteCredito {
  id: string;
  nome: string;
  diarias: number;
  precoCentavos: number;
  /** Dias para usar as diárias, contados da confirmação do pagamento. */
  validadeDias: number;
  ativo: boolean;
}

export const LIMITES_PACOTE = { diariasMax: 365, validadeMaxDias: 730, precoMaxCentavos: 10_000_00 };

export function problemaNoPacote(p: Omit<PacoteCredito, 'id'>): string | null {
  if ((p.nome ?? '').trim().length < 2) return 'Informe o nome do pacote.';
  if (!Number.isInteger(p.diarias) || p.diarias < 1 || p.diarias > LIMITES_PACOTE.diariasMax) return `Diárias de 1 a ${LIMITES_PACOTE.diariasMax}.`;
  if (!Number.isInteger(p.precoCentavos) || p.precoCentavos < 1 || p.precoCentavos > LIMITES_PACOTE.precoMaxCentavos) return 'Preço inválido.';
  if (!Number.isInteger(p.validadeDias) || p.validadeDias < p.diarias || p.validadeDias > LIMITES_PACOTE.validadeMaxDias)
    return `A validade precisa ser de ${p.diarias} a ${LIMITES_PACOTE.validadeMaxDias} dias.`;
  return null;
}

export type SituacaoPedidoCredito = 'AGUARDANDO' | 'CONFIRMADO' | 'RECUSADO' | 'CANCELADO';

export const ROTULO_PEDIDO_CREDITO: Record<SituacaoPedidoCredito, string> = {
  AGUARDANDO: 'Aguardando confirmação',
  CONFIRMADO: 'Confirmado',
  RECUSADO: 'Recusado',
  CANCELADO: 'Cancelado',
};

/** Pedidos em aberto por entregador: evita uma pilha de Pix gerados e não pagos. */
export const MAX_PEDIDOS_CREDITO_ABERTOS = 3;

export type OrigemLote = 'COMPRA' | 'BONUS';

export interface LoteCredito {
  id: string;
  origem: OrigemLote;
  quantidade: number;
  restante: number;
  venceEm: string;
}

export function saldoDeDiarias(lotes: Pick<LoteCredito, 'restante' | 'venceEm'>[], agora: Date): number {
  return lotes.filter((l) => l.restante > 0 && new Date(l.venceEm) > agora).reduce((s, l) => s + l.restante, 0);
}

/** Gasta primeiro o que vence antes. */
export function loteParaConsumir<T extends Pick<LoteCredito, 'restante' | 'venceEm'>>(lotes: T[], agora: Date): T | null {
  return lotes.filter((l) => l.restante > 0 && new Date(l.venceEm) > agora).sort((a, b) => new Date(a.venceEm).getTime() - new Date(b.venceEm).getTime())[0] ?? null;
}

/** Dia do calendário (AAAA-MM-DD) no fuso informado: a diária vale para esse dia. */
export function diaNoFuso(agora: Date, fuso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

// Pix copia e cola (BR Code estático, com valor) -------------------------------------------

export interface DadosPix {
  chave: string;
  /** Nome de quem recebe: sem acento, até 25 caracteres. */
  nome: string;
  /** Cidade de quem recebe: sem acento, até 15 caracteres. */
  cidade: string;
  valorCentavos: number;
  /** Identificador que aparece no extrato de quem recebe (até 25 letras e números). */
  txid: string;
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const campoPix = (id: string, valor: string) => `${id}${String(valor.length).padStart(2, '0')}${valor}`;

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF), exigido no fim do BR Code. */
export function crc16Pix(texto: string): string {
  let crc = 0xffff;
  for (const ch of texto) {
    crc ^= ch.charCodeAt(0) << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function pixCopiaECola(d: DadosPix): string {
  const nome = semAcento(d.nome).toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().slice(0, 25);
  const cidade = semAcento(d.cidade).toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().slice(0, 15);
  const txid = d.txid.replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  const conta = campoPix('00', 'br.gov.bcb.pix') + campoPix('01', d.chave.trim());
  const corpo =
    campoPix('00', '01') +
    campoPix('26', conta) +
    campoPix('52', '0000') +
    campoPix('53', '986') +
    campoPix('54', (d.valorCentavos / 100).toFixed(2)) +
    campoPix('58', 'BR') +
    campoPix('59', nome) +
    campoPix('60', cidade) +
    campoPix('62', campoPix('05', txid)) +
    '6304';
  return corpo + crc16Pix(corpo);
}

export interface ParametrosEntregasPlataforma {
  pixChave: string;
  pixNome: string;
  pixCidade: string;
  /** Diárias grátis ao aprovar o cadastro (0 = nenhuma). */
  diariasBonusCadastro: number;
  /** Validade das diárias grátis, em dias. */
  validadeBonusDias: number;
  /** Tabela de preços das empresas que ainda não montaram a sua (nula = a do código). */
  tabelaPadrao: TabelaPrecos | null;
  /** Nenhuma chamada sai por menos que isso (0 = sem mínimo). */
  valorMinimoCentavos: number;
}

export const PARAMETROS_ENTREGAS_PADRAO: ParametrosEntregasPlataforma = { pixChave: '', pixNome: '', pixCidade: '', diariasBonusCadastro: 0, validadeBonusDias: 30, tabelaPadrao: null, valorMinimoCentavos: 0 };

export function problemaNosParametrosEntregas(p: ParametrosEntregasPlataforma): string | null {
  if (p.pixChave.trim() && (p.pixChave.trim().length > 77 || !p.pixNome.trim() || !p.pixCidade.trim())) return 'Para o Pix, informe a chave (até 77 caracteres), o nome e a cidade de quem recebe.';
  if (!Number.isInteger(p.diariasBonusCadastro) || p.diariasBonusCadastro < 0 || p.diariasBonusCadastro > 30) return 'Diárias grátis de 0 a 30.';
  if (!Number.isInteger(p.validadeBonusDias) || p.validadeBonusDias < 1 || p.validadeBonusDias > 365) return 'Validade das diárias grátis de 1 a 365 dias.';
  return null;
}

export const pixConfigurado = (p: Pick<ParametrosEntregasPlataforma, 'pixChave' | 'pixNome' | 'pixCidade'>) => !!(p.pixChave.trim() && p.pixNome.trim() && p.pixCidade.trim());

// Localização -----------------------------------------------------------------------------

export interface Ponto {
  lat: number;
  lon: number;
}

/** Posição mais velha que isso não serve para receber chamadas ("sem sinal"). */
export const SEGUNDOS_POSICAO_VALIDA = 120;
/** Sem nenhum aviso por esse tempo, o entregador é colocado offline. */
export const MINUTOS_OFFLINE_AUTOMATICO = 10;
/** Nas empresas, o entregador livre aparece arredondado nessa grade. */
export const METROS_APROXIMACAO = 200;
/** Intervalos do app: a cada 20 s ou 50 m em movimento. */
export const INTERVALO_POSICAO_SEGUNDOS = 20;
export const DISTANCIA_POSICAO_METROS = 50;

export function coordenadaValida(p: Partial<Ponto> | null | undefined): p is Ponto {
  if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number') return false;
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return false;
  if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return false;
  // (0, 0) é o GPS sem leitura, não um lugar.
  return !(p.lat === 0 && p.lon === 0);
}

const RAIO_TERRA_M = 6_371_000;
const rad = (g: number) => (g * Math.PI) / 180;

/** Distância em linha reta (haversine), em metros. */
export function distanciaMetros(a: Ponto, b: Ponto): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * RAIO_TERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Centro da célula de uma grade de `metros`: quem olha o mapa não sabe a porta da casa. */
export function posicaoAproximada(p: Ponto, metros = METROS_APROXIMACAO): Ponto {
  const passoLat = metros / 111_320;
  const lat = (Math.floor(p.lat / passoLat) + 0.5) * passoLat;
  const passoLon = metros / (111_320 * Math.max(0.01, Math.cos(rad(lat))));
  const lon = (Math.floor(p.lon / passoLon) + 0.5) * passoLon;
  return { lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) };
}

export type SituacaoNoMapa = 'LIVRE' | 'OCUPADO' | 'SEM_SINAL';

export const ROTULO_SITUACAO_MAPA: Record<SituacaoNoMapa, string> = { LIVRE: 'Livre', OCUPADO: 'Em chamada', SEM_SINAL: 'Sem sinal' };

export function situacaoNoMapa(posicaoEm: Date | string | null, agora: Date): SituacaoNoMapa {
  if (!posicaoEm) return 'SEM_SINAL';
  return agora.getTime() - new Date(posicaoEm).getTime() <= SEGUNDOS_POSICAO_VALIDA * 1000 ? 'LIVRE' : 'SEM_SINAL';
}

// Empresa ---------------------------------------------------------------------------------

export const RAIO_ATENDIMENTO_PADRAO_KM = 15;
export const RAIO_ATENDIMENTO_MAXIMO_KM = 100;

export interface ConfigEntregasEmpresa {
  /** Ponto de partida da empresa (loja, depósito); sem ele, o mapa não sabe o que é perto. */
  base: (Ponto & { endereco: string }) | null;
  raioAtendimentoKm: number;
  precos: TabelaPrecos;
  segundosParaAceitar: number;
  direcionamento: RegrasDirecionamento;
  /** Pedido com entrega aceito (em separação) já abre a chamada, na distribuição automática. */
  chamarAoAceitarPedido: boolean;
  /** Somam ao valor da tabela por horário e por região. */
  adicionais: Adicionais;
  /** O entregador tira foto na coleta e/ou em cada entrega. */
  fotos: FotosObrigatorias;
}

export interface ResultadoEndereco extends Ponto {
  endereco: string;
}

export interface ConfigMapa {
  /** Modelo de URL dos blocos do mapa ({z}/{x}/{y}). */
  blocos: string;
  atribuicao: string;
  zoomMaximo: number;
}

export interface EntregadorNoMapa {
  id: string;
  nome: string;
  veiculo: TipoVeiculo;
  /** Já arredondada (`posicaoAproximada`). */
  lat: number;
  lon: number;
  situacao: SituacaoNoMapa;
  posicaoEm: string;
  distanciaKm: number;
}

export interface MapaEntregas {
  config: ConfigEntregasEmpresa;
  entregadores: EntregadorNoMapa[];
  atualizadoEm: string;
}

// Telas -----------------------------------------------------------------------------------

export interface PerfilEntregador {
  id: string;
  nome: string;
  cpf: string;
  celular: string;
  email: string;
  veiculo: TipoVeiculo;
  placa: string | null;
  chavePix: string;
  situacao: SituacaoEntregador;
  motivo: string | null;
  documentos: { tipo: TipoDocumentoEntregador; enviadoEm: string }[];
  documentosFaltando: TipoDocumentoEntregador[];
  online: boolean;
  /** A diária de hoje já foi descontada. */
  diariaHoje: boolean;
  saldoDiarias: number;
}

export interface SessaoEntregadorResposta {
  token: string;
  perfil: PerfilEntregador;
}

export interface PedidoCreditoResumo {
  id: string;
  pacote: string;
  diarias: number;
  precoCentavos: number;
  validadeDias: number;
  situacao: SituacaoPedidoCredito;
  txid: string;
  /** Só enquanto aguarda: o código para pagar. */
  pixCopiaECola: string | null;
  pagamentoInformadoEm: string | null;
  temComprovante: boolean;
  motivo: string | null;
  criadoEm: string;
  decididoEm: string | null;
}

export interface MovimentoDiarias {
  tipo: 'COMPRA' | 'BONUS' | 'CONSUMO';
  quantidade: number;
  descricao: string;
  em: string;
  /** Entradas: até quando valem. */
  venceEm: string | null;
}

export interface CreditosEntregador {
  saldo: number;
  pacotes: PacoteCredito[];
  pixDisponivel: boolean;
  pedidos: PedidoCreditoResumo[];
  extrato: MovimentoDiarias[];
}

export interface RespostaPosicao {
  online: boolean;
  /** Por que ficou offline ou a posição foi recusada. */
  aviso: 'SEM_CREDITO' | 'GPS_FALSO' | 'NAO_APROVADO' | null;
  saldoDiarias: number;
  /** Oferta esperando a resposta dele (o app toca o aviso). */
  oferta: OfertaResumo | null;
  /** Chamada em andamento, se houver. */
  chamadaId: string | null;
}

/** Lista do super-admin. */
export interface EntregadorResumo {
  id: string;
  nome: string;
  cpf: string;
  celular: string;
  email: string;
  veiculo: TipoVeiculo;
  placa: string | null;
  chavePix: string;
  situacao: SituacaoEntregador;
  motivo: string | null;
  documentos: TipoDocumentoEntregador[];
  documentosFaltando: TipoDocumentoEntregador[];
  online: boolean;
  posicaoEm: string | null;
  saldoDiarias: number;
  criadoEm: string;
}

export interface PedidoCreditoAdmin extends PedidoCreditoResumo {
  entregador: { id: string; nome: string; cpf: string };
}
