import { Module } from '@nestjs/common';
import { AgentesModule } from '../agentes/agentes.module';
import { NotificacoesController } from './notificacoes.controller';
import { NotificacoesService } from './notificacoes.service';

@Module({
  imports: [AgentesModule],
  controllers: [NotificacoesController],
  providers: [NotificacoesService],
})
export class NotificacoesModule {}
