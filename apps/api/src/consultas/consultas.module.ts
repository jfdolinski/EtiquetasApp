import { Module } from '@nestjs/common';
import { AgentesModule } from '../agentes/agentes.module';
import { ConsultasController } from './consultas.controller';
import { ConsultasService } from './consultas.service';

@Module({
  imports: [AgentesModule],
  controllers: [ConsultasController],
  providers: [ConsultasService],
  exports: [ConsultasService],
})
export class ConsultasModule {}
