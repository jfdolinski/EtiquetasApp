import { Module } from '@nestjs/common';
import { AgentesModule } from '../agentes/agentes.module';
import { ConsultasModule } from '../consultas/consultas.module';
import { DespachoService } from './despacho.service';
import { AvulsaController, ListasController, TrabalhosController } from './impressao.controller';
import { ListasService } from './listas.service';
import { TrabalhosService } from './trabalhos.service';

@Module({
  imports: [AgentesModule, ConsultasModule],
  controllers: [ListasController, AvulsaController, TrabalhosController],
  providers: [ListasService, TrabalhosService, DespachoService],
})
export class ImpressaoModule {}
