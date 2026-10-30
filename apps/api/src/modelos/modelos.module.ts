import { Module } from '@nestjs/common';
import { AgentesModule } from '../agentes/agentes.module';
import { ConsultasModule } from '../consultas/consultas.module';
import { ImpressorasService } from './impressoras.service';
import { ImpressorasAgenteController, ImpressorasController, ModelosController } from './modelos.controller';
import { ModelosService } from './modelos.service';

@Module({
  imports: [ConsultasModule, AgentesModule],
  controllers: [ModelosController, ImpressorasController, ImpressorasAgenteController],
  providers: [ModelosService, ImpressorasService],
  exports: [ModelosService, ImpressorasService],
})
export class ModelosModule {}
