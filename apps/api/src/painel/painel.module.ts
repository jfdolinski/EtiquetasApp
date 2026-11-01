import { Module } from '@nestjs/common';
import { AgentesModule } from '../agentes/agentes.module';
import { PainelController } from './painel.controller';
import { PainelService } from './painel.service';

@Module({
  imports: [AgentesModule],
  controllers: [PainelController],
  providers: [PainelService],
})
export class PainelModule {}
