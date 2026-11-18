// Cópias de packages/shared/src/entregas.ts e pedidos.ts: o app só importa tipos de lá.
// packages/shared/src/entregas-app.test.ts confere que dão o mesmo resultado.

import type { DadosCadastroEntregador, SituacaoEntregador, SituacaoPedidoCredito, TipoDocumentoEntregador, TipoVeiculo } from '../../../packages/shared/src/entregas';

export const TIPOS_VEICULO: TipoVeiculo[] = ['MOTO', 'CARRO', 'BICICLETA', 'A_PE'];
export const ROTULO_VEICULO: Record<TipoVeiculo, string> = { MOTO: 'Moto', CARRO: 'Carro', BICICLETA: 'Bicicleta', A_PE: 'A pé' };
export const veiculoMotorizado = (v: TipoVeiculo) => v === 'MOTO' || v === 'CARRO';

export const ROTULO_SITUACAO_ENTREGADOR: Record<SituacaoEntregador, string> = {
  PENDENTE: 'Aguardando aprovação',
  APROVADO: 'Aprovado',
  RECUSADO: 'Recusado',
  SUSPENSO: 'Suspenso',
};

export const ROTULO_DOCUMENTO: Record<TipoDocumentoEntregador, string> = {
  SELFIE: 'Foto do rosto',
  CNH: 'CNH (carteira de motorista)',
  CRLV: 'Documento do veículo (CRLV)',
};

export const ROTULO_PEDIDO_CREDITO: Record<SituacaoPedidoCredito, string> = {
  AGUARDANDO: 'Aguardando confirmação',
  CONFIRMADO: 'Confirmado',
  RECUSADO: 'Recusado',
  CANCELADO: 'Cancelado',
};

export const SENHA_ENTREGADOR_MINIMO = 8;
export const INTERVALO_POSICAO_SEGUNDOS = 20;

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

export function normalizarPlaca(v: string): string | null {
  const p = (v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(p) ? p : null;
}

export function normalizarCelular(v: string): string | null {
  let d = (v ?? '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
  if (!/^[1-9][1-9]9\d{8}$/.test(d)) return null;
  return d;
}

export const formatarCelular = (d: string) => (d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d);

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

export function formatarCentavos(c: number): string {
  const negativo = c < 0;
  const abs = Math.abs(Math.round(c));
  const inteiro = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? '-' : ''}R$ ${inteiro},${String(abs % 100).padStart(2, '0')}`;
}

/** "1.2.10" é mais nova que "1.2.9"; formato estranho nunca é mais nova. */
export function versaoMaisNova(candidata: string, atual: string): boolean {
  const partes = (v: string) => v.trim().split('.').map(Number);
  const a = partes(candidata);
  const b = partes(atual);
  if ([...a, ...b].some((n) => !Number.isInteger(n) || n < 0)) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Endereço digitado na tela de entrada (só quando o APK não traz um). */
export function servidorValido(texto: string, aceitarHttp: boolean): string | null {
  const t = (texto ?? '').trim().replace(/\/+$/, '');
  const m = /^(https?):\/\/[a-z0-9.-]+(:\d+)?$/i.exec(t);
  if (!m) return null;
  if (m[1].toLowerCase() === 'http' && !aceitarHttp) return null;
  return t;
}

export function dataCurta(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
