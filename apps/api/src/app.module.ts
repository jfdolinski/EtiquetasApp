import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AgentesModule } from './agentes/agentes.module';
import { AppMovelModule, DispositivosModule } from './app-movel/app-movel.module';
import { AuditoriaModule } from './auditoria/auditoria.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { BanidosModule } from './banidos/banidos.module';
import { CobrancaModule } from './cobranca/cobranca.module';
import { ConsultasModule } from './consultas/consultas.module';
import { PermissoesGuard } from './auth/permissoes.guard';
import { EmailModule } from './email/email.service';
import { EmpresasModule } from './empresas/empresas.module';
import { ErpsModule } from './erps/erps.module';
import { BannersModule } from './banners/banners.module';
import { HealthController } from './health.controller';
import { ImpressaoModule } from './impressao/impressao.module';
import { ModelosModule } from './modelos/modelos.module';
import { NotificacoesModule } from './notificacoes/notificacoes.module';
import { PainelModule } from './painel/painel.module';
import { PerfisModule } from './perfis/perfis.module';
import { PedidosModule } from './pedidos/pedidos.module';
import { PostsModule } from './posts/posts.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReferenciasModule } from './referencias/referencias.module';
import { SistemaModule } from './sistema/sistema.module';
import { TelasModule } from './telas/telas.module';
import { UsuariosModule } from './usuarios/usuarios.module';

@Module({
  imports: [
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 300 }], errorMessage: 'Muitas tentativas em pouco tempo. Aguarde um minuto e tente de novo.' }),
    PrismaModule,
    AuditoriaModule,
    EmailModule,
    DispositivosModule,
    AuthModule,
    EmpresasModule,
    UsuariosModule,
    PerfisModule,
    AgentesModule,
    ConsultasModule,
    BanidosModule,
    ModelosModule,
    ImpressaoModule,
    ErpsModule,
    CobrancaModule,
    NotificacoesModule,
    PainelModule,
    AppMovelModule,
    ReferenciasModule,
    SistemaModule,
    BannersModule,
    PedidosModule,
    PostsModule,
    TelasModule,
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
