import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { SituacaoServidor } from '@etiquetas/shared';
import { Publico } from './auth/decorators';
import { config } from './config';
import { PrismaService } from './prisma/prisma.service';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Também é o relógio das telas: hora não é segredo, e o cabeçalho Date já a entrega. */
  @Get()
  @Publico()
  async verificar(): Promise<SituacaoServidor> {
    let banco: { agora: Date; fuso: string };
    try {
      [banco] = await this.prisma.$queryRaw<{ agora: Date; fuso: string }[]>`SELECT clock_timestamp() AS agora, current_setting('TimeZone') AS fuso`;
    } catch {
      throw new ServiceUnavailableException({ status: 'erro', banco: 'indisponivel' });
    }
    return {
      status: 'ok',
      banco: 'ok',
      horarios: { api: new Date().toISOString(), banco: banco.agora.toISOString(), fusoBanco: banco.fuso, fusoSistema: config().fusoHorario },
    };
  }
}
