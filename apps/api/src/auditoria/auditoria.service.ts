import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface RegistroAuditoria {
  empresaId: string | null;
  usuarioId: string | null;
  acao: string;
  entidade: string;
  entidadeId?: string;
  detalhes?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditoriaService {
  constructor(private readonly prisma: PrismaService) {}

  /** Aceita um client de transação para gravar o log junto com a operação auditada. */
  async registrar(registro: RegistroAuditoria, tx: Prisma.TransactionClient = this.prisma) {
    await tx.logAuditoria.create({ data: registro });
  }
}
