import { Injectable } from '@nestjs/common';
import {
  avaliarAssinatura,
  mesclarParametros,
  PARAMETROS_COBRANCA_PADRAO,
  renderizarMensagem,
  type AvisoCobrancaResumo,
  type ParametrosCobranca,
  type ParametrosCobrancaEmpresa,
  type ParametrosCobrancaGlobais,
} from '@etiquetas/shared';
import { MENSAGEM_BLOQUEIO, MENSAGEM_CARENCIA } from '../auth/acesso-empresa';
import { config } from '../config';
import { agoraNoFuso } from '../consultas/consultas.service';
import { PrismaService } from '../prisma/prisma.service';

const CACHE_MS = 30_000;

export function dataIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function hojeNoFuso(): string {
  return agoraNoFuso(new Date(), config().fusoHorario).data;
}

/**
 * Parâmetros de cobrança e as mensagens que os usuários veem (login, guard, banner).
 * Global: usado pelo AuthGuard em toda requisição de empresa bloqueada.
 */
@Injectable()
export class MensagensCobrancaService {
  private cache: { valor: ParametrosCobrancaGlobais; ate: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  invalidarCache() {
    this.cache = null;
  }

  /** Globais; campos nulos (ou linha ausente) caem no padrão. */
  async globais(): Promise<ParametrosCobrancaGlobais> {
    if (this.cache && this.cache.ate > Date.now()) return this.cache.valor;
    const linha = await this.prisma.parametroCobranca.findFirst({ where: { empresaId: null } });
    const valor = { ...PARAMETROS_COBRANCA_PADRAO };
    if (linha) {
      for (const k of Object.keys(PARAMETROS_COBRANCA_PADRAO) as (keyof ParametrosCobrancaGlobais)[]) {
        const v = linha[k];
        if (v !== null && v !== undefined) (valor as Record<string, unknown>)[k] = v;
      }
    }
    this.cache = { valor, ate: Date.now() + CACHE_MS };
    return valor;
  }

  async daEmpresa(empresaId: string): Promise<{ efetivos: ParametrosCobranca; sobrescritos: ParametrosCobrancaEmpresa }> {
    const linha = await this.prisma.parametroCobranca.findUnique({
      where: { empresaId },
      select: { diasAvisoPrevio: true, diasCarencia: true, diasAteBloqueio: true, frequenciaAvisoDias: true },
    });
    const sobrescritos: ParametrosCobrancaEmpresa = linha ?? { diasAvisoPrevio: null, diasCarencia: null, diasAteBloqueio: null, frequenciaAvisoDias: null };
    return { efetivos: mesclarParametros(await this.globais(), sobrescritos), sobrescritos };
  }

  /** Aviso vigente (vencimento atual, exceto bloqueio). Carência manual sem assinatura usa a mensagem padrão. */
  async avisoAtual(empresaId: string): Promise<AvisoCobrancaResumo | null> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { statusAssinatura: true, assinatura: { select: { vencimentoAtual: true } } },
    });
    if (!empresa) return null;
    if (empresa.assinatura) {
      const aviso = await this.prisma.avisoCobranca.findFirst({
        where: { empresaId, vencimento: empresa.assinatura.vencimentoAtual, tipo: { not: 'BLOQUEADA' } },
        orderBy: { criadoEm: 'desc' },
        select: { id: true, tipo: true, mensagem: true, criadoEm: true },
      });
      if (aviso) return { ...aviso, criadoEm: aviso.criadoEm.toISOString() };
    }
    if (empresa.statusAssinatura === 'CARENCIA') {
      return { id: 'carencia-manual', tipo: 'CARENCIA', mensagem: MENSAGEM_CARENCIA, criadoEm: new Date().toISOString() };
    }
    return null;
  }

  /** Mensagem de bloqueio com os dados da assinatura; bloqueio manual sem assinatura usa a padrão. */
  async mensagemBloqueio(empresaId: string | null): Promise<string> {
    if (!empresaId) return MENSAGEM_BLOQUEIO;
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { razaoSocial: true, nomeFantasia: true, ativa: true, statusAssinatura: true, assinatura: { select: { valorMensal: true, vencimentoAtual: true } } },
    });
    // Empresa desativada ou cancelada não é caso de inadimplência.
    if (!empresa?.assinatura || !empresa.ativa || empresa.statusAssinatura !== 'BLOQUEADA') return MENSAGEM_BLOQUEIO;
    const { efetivos } = await this.daEmpresa(empresaId);
    const vencimento = dataIso(empresa.assinatura.vencimentoAtual);
    return renderizarMensagem(efetivos.mensagemBloqueio, {
      empresa: empresa.nomeFantasia || empresa.razaoSocial,
      valor: Number(empresa.assinatura.valorMensal),
      vencimento,
      avaliacao: avaliarAssinatura(hojeNoFuso(), vencimento, efetivos),
    });
  }
}
