import { Module } from '@nestjs/common';
import { ConsultasModule } from '../consultas/consultas.module';
import { ImpressorasService } from './impressoras.service';
import { ImpressorasController, ModelosController } from './modelos.controller';
import { ModelosService } from './modelos.service';

@Module({
  imports: [ConsultasModule],
  controllers: [ModelosController, ImpressorasController],
  providers: [ModelosService, ImpressorasService],
  exports: [ModelosService, ImpressorasService],
})
export class ModelosModule {}
