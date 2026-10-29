import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AgentesModule } from './agentes/agentes.module';
import { AuditoriaModule } from './auditoria/auditoria.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { ConsultasModule } from './consultas/consultas.module';
import { PermissoesGuard } from './auth/permissoes.guard';
import { EmpresasModule } from './empresas/empresas.module';
import { HealthController } from './health.controller';
import { PerfisModule } from './perfis/perfis.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsuariosModule } from './usuarios/usuarios.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    AuditoriaModule,
    AuthModule,
    EmpresasModule,
    UsuariosModule,
    PerfisModule,
    AgentesModule,
    ConsultasModule,
  ],
  controllers: [HealthController],
  providers: [
    // A ordem importa: rate limit → autenticação → permissões.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissoesGuard },
  ],
})
export class AppModule {}
