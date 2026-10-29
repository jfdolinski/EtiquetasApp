import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PaginaAuditoria } from '@etiquetas/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface FiltrosAuditoria {
  /** Prefixo da ação, ex.: "impressao." */
  acao?: string;
  entidade?: string;
  entidadeId?: string;
  /** Trecho do nome ou e-mail do usuário. */
  usuario?: string;
  /** AAAA-MM-DD (inclusive). */
  de?: string;
  ate?: string;
  cursor?: string;
  limite?: number;
}

const LIMITE_MAXIMO = 200;

function lerCursor(cursor: string): { criadoEm: Date; id: string } {
  const [data, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const criadoEm = new Date(data);
  if (Number.isNaN(criadoEm.getTime()) || !/^[0-9a-f-]{36}$/i.test(id ?? '')) throw new BadRequestException('Cursor inválido.');
  return { criadoEm, id };
}

function data(valor: string, campo: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new BadRequestException(`Data inválida em "${campo}".`);
  return new Date(`${valor}T00:00:00Z`);
}

/**
 * Consulta do registro de auditoria, do mais recente para o mais antigo, paginada por
 * cursor (criadoEm + id). `empresaId` null = visão da plataforma (super-admin).
 */
@Injectable()
export class AuditoriaConsultaService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(escopo: { empresaId: string } | { plataforma: true; empresaId?: string }, f: FiltrosAuditoria): Promise<PaginaAuditoria> {
    const limite = Math.min(LIMITE_MAXIMO, Math.max(1, f.limite ?? 50));
    const where: Prisma.LogAuditoriaWhereInput[] = [];
    if ('plataforma' in escopo) {
      if (escopo.empresaId) where.push({ empresaId: escopo.empresaId });
    } else {
      where.push({ empresaId: escopo.empresaId });
    }
    if (f.acao) where.push({ acao: { startsWith: f.acao } });
    if (f.entidade) where.push({ entidade: f.entidade });
    if (f.entidadeId) where.push({ entidadeId: f.entidadeId });
    if (f.usuario?.trim()) {
      const t = f.usuario.trim();
      where.push({ usuario: { OR: [{ nome: { contains: t, mode: 'insensitive' } }, { email: { contains: t, mode: 'insensitive' } }] } });
    }
    // Datas no calendário UTC do servidor; a tela envia o dia escolhido.
    if (f.de) where.push({ criadoEm: { gte: data(f.de, 'de') } });
    if (f.ate) where.push({ criadoEm: { lt: new Date(data(f.ate, 'ate').getTime() + 86_400_000) } });
    if (f.cursor) {
      const c = lerCursor(f.cursor);
      where.push({ OR: [{ criadoEm: { lt: c.criadoEm } }, { criadoEm: c.criadoEm, id: { lt: c.id } }] });
    }

    const linhas = await this.prisma.logAuditoria.findMany({
      where: { AND: where },
      orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
      take: limite + 1,
      select: {
        id: true,
        criadoEm: true,
        acao: true,
        entidade: true,
        entidadeId: true,
        detalhes: true,
        usuario: { select: { id: true, nome: true, email: true } },
        empresa: { select: { id: true, razaoSocial: true, nomeFantasia: true } },
      },
    });
    const pagina = linhas.slice(0, limite);
    const ultimo = pagina.at(-1);
    return {
      itens: pagina.map((l) => ({
        id: l.id,
        criadoEm: l.criadoEm.toISOString(),
        acao: l.acao,
        entidade: l.entidade,
        entidadeId: l.entidadeId,
        detalhes: l.detalhes,
        usuario: l.usuario,
        empresa: 'plataforma' in escopo && l.empresa ? { id: l.empresa.id, nome: l.empresa.nomeFantasia || l.empresa.razaoSocial } : null,
      })),
      proximo: linhas.length > limite && ultimo ? Buffer.from(`${ultimo.criadoEm.toISOString()}|${ultimo.id}`).toString('base64url') : null,
    };
  }
}
