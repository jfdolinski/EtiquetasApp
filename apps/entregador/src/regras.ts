// Cópias de packages/shared/src/entregas.ts e pedidos.ts: o app só importa tipos de lá.
// packages/shared/src/entregas-app.test.ts confere que dão o mesmo resultado.

import type { MotivoOcorrencia, SituacaoChamada, TipoChamada } from '../../../packages/shared/src/entregas-chamadas';
import type { DadosCadastroEntregador, SituacaoEntregador, SituacaoPedidoCredito, TipoDocumentoEntregador, TipoVeiculo } from '../../../packages/shared/src/entregas';
import type { ChecklistMaquina, EstadoMaquina } from '../../../packages/shared/src/entregas-servico';
import type { AssinaturaEntrega, TracoAssinatura } from '../../../packages/shared/src/entregas-comprovacao';
import type { ResponsavelAvaria, SituacaoAvaria, TipoAvaria } from '../../../packages/shared/src/entregas-escala';

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

// Chamadas (cópias de packages/shared/src/entregas-chamadas.ts) ------------------------------

export const ROTULO_TIPO_CHAMADA: Record<TipoChamada, string> = {
  ENTREGA: 'Entrega',
  COLETA: 'Coleta',
  DEVOLUCAO_MAQUINA: 'Devolução de máquina',
};

export const ROTULO_SITUACAO_CHAMADA: Record<SituacaoChamada, string> = {
  ABERTA: 'Aguardando entregador',
  ACEITA: 'A caminho da coleta',
  NA_COLETA: 'No local da coleta',
  COLETADA: 'A caminho do destino',
  NO_DESTINO: 'No destino',
  CONCLUIDA: 'Concluída',
  OCORRENCIA: 'Ocorrência',
  CANCELADA: 'Cancelada',
};

export const PROXIMA_ETAPA: Partial<Record<SituacaoChamada, { para: SituacaoChamada; rotulo: string }>> = {
  ACEITA: { para: 'NA_COLETA', rotulo: 'Cheguei na coleta' },
  NA_COLETA: { para: 'COLETADA', rotulo: 'Coletei' },
  COLETADA: { para: 'NO_DESTINO', rotulo: 'Cheguei no destino' },
  NO_DESTINO: { para: 'CONCLUIDA', rotulo: 'Entreguei' },
};

export const MOTIVOS_OCORRENCIA: MotivoOcorrencia[] = ['CLIENTE_AUSENTE', 'ENDERECO_NAO_ENCONTRADO', 'RECUSA_NO_RECEBIMENTO', 'MAQUINA_COM_DEFEITO', 'SERIE_DIFERENTE', 'OUTRO'];

export const ROTULO_MOTIVO_OCORRENCIA: Record<MotivoOcorrencia, string> = {
  CLIENTE_AUSENTE: 'Cliente ausente',
  ENDERECO_NAO_ENCONTRADO: 'Endereço não encontrado',
  RECUSA_NO_RECEBIMENTO: 'Recusou o recebimento',
  MAQUINA_COM_DEFEITO: 'Máquina com defeito ou faltando item',
  SERIE_DIFERENTE: 'Número de série diferente',
  OUTRO: 'Outro motivo',
};

export function normalizarSerie(v: string): string {
  return (v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export const formatarKm = (metros: number) => `${(metros / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: metros < 10_000 ? 1 : 0 })} km`;

export function linkNavegacao(p: { lat: number; lon: number }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`;
}

// Etapa 10 (cópias de entregas-servico.ts): checklist da maquininha e espera.
export const ESPERA_BLOCO_MINUTOS = 10;
export const ESTADOS_MAQUINA: EstadoMaquina[] = ['BOA', 'AVARIADA'];
export const ROTULO_ESTADO_MAQUINA: Record<EstadoMaquina, string> = { BOA: 'Em bom estado', AVARIADA: 'Com avaria' };
export const ITENS_CHECKLIST: { chave: 'carregador' | 'bobina' | 'chip'; rotulo: string }[] = [
  { chave: 'carregador', rotulo: 'Carregador' },
  { chave: 'bobina', rotulo: 'Bobina' },
  { chave: 'chip', rotulo: 'Chip' },
];
export const LIMITE_OBSERVACAO_CHECKLIST = 300;

export function problemaNoChecklist(c: Partial<ChecklistMaquina> | null | undefined): string | null {
  if (!c) return 'Preencha o checklist da máquina.';
  for (const i of ITENS_CHECKLIST) if (typeof c[i.chave] !== 'boolean') return `Marque se veio ${i.rotulo.toLowerCase()}.`;
  if (!ESTADOS_MAQUINA.includes(c.estado as EstadoMaquina)) return 'Informe o estado da máquina.';
  if (c.estado === 'AVARIADA' && !(c.observacao ?? '').trim()) return 'Descreva a avaria.';
  if ((c.observacao ?? '').length > LIMITE_OBSERVACAO_CHECKLIST) return 'Observação longa demais.';
  return null;
}

// Etapa 11 (cópias de entregas-comprovacao.ts): assinatura de quem recebe.
export const LIMITES_ASSINATURA = { tracos: 60, pontos: 3000, recebedorMaximo: 80 };
export const PROPORCAO_ASSINATURA = 2.5;

export function comprimentoDaAssinatura(tracos: TracoAssinatura[]): number {
  let total = 0;
  for (const t of tracos)
    for (let i = 1; i < t.length; i++) total += Math.hypot(t[i][0] - t[i - 1][0], (t[i][1] - t[i - 1][1]) / PROPORCAO_ASSINATURA);
  return total;
}

export function problemaNaAssinatura(a: Partial<AssinaturaEntrega> | null | undefined): string | null {
  if (!a || !Array.isArray(a.tracos)) return 'Peça para quem recebe assinar na tela.';
  if ((a.recebedor ?? '').trim().length < 2) return 'Informe o nome de quem recebeu.';
  if ((a.recebedor ?? '').length > LIMITES_ASSINATURA.recebedorMaximo) return 'Nome longo demais.';
  if (a.tracos.length > LIMITES_ASSINATURA.tracos) return 'Assinatura com traços demais: limpe e assine de novo.';
  let pontos = 0;
  for (const t of a.tracos) {
    if (!Array.isArray(t)) return 'Assinatura inválida.';
    for (const p of t) {
      if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)) return 'Assinatura inválida.';
      pontos++;
    }
  }
  if (pontos > LIMITES_ASSINATURA.pontos) return 'Assinatura com traços demais: limpe e assine de novo.';
  if (comprimentoDaAssinatura(a.tracos) < 0.3) return 'Peça para quem recebe assinar na tela.';
  return null;
}

// Etapa 12 (cópias de entregas-balcao.ts): etiqueta de coleta, volumes e conversa.
export const LIMITE_MENSAGEM = 500;
export const LIMITES_VOLUMES = { minimo: 1, maximo: 99 };

export function normalizarCodigoColeta(lido: string): string | null {
  const t = (lido ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const m = /FC[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}/.exec(t);
  return m ? m[0] : null;
}

export function problemaNosVolumes(v: unknown): string | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < LIMITES_VOLUMES.minimo || v > LIMITES_VOLUMES.maximo) return `Informe quantos volumes (de ${LIMITES_VOLUMES.minimo} a ${LIMITES_VOLUMES.maximo}).`;
  return null;
}

export const textoVolumes = (n: number) => (n === 1 ? '1 volume' : `${n} volumes`);

// Etapa 13: avarias (cópias de entregas-escala.ts).
export const ROTULO_TIPO_AVARIA: Record<TipoAvaria, string> = { AVARIA: 'Avaria (chegou danificado)', EXTRAVIO: 'Extravio (não chegou)' };
export const ROTULO_RESPONSAVEL_AVARIA: Record<ResponsavelAvaria, string> = { ENTREGADOR: 'Entregador', EMPRESA: 'Empresa (embalagem, separação)', CLIENTE: 'Cliente', TERCEIROS: 'Terceiros (acidente, roubo)' };
export const ROTULO_SITUACAO_AVARIA: Record<SituacaoAvaria, string> = {
  SEM_DESCONTO: 'Registrada, sem desconto',
  AGUARDANDO: 'Aguardando o entregador',
  ACEITA: 'Desconto aceito',
  CONTESTADA: 'Contestada pelo entregador',
  RETIRADA: 'Retirada pela empresa',
};
