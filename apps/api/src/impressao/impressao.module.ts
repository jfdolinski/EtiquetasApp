import { Module } from '@nestjs/common';
import { AgentesModule } from '../agentes/agentes.module';
import { ConsultasModule } from '../consultas/consultas.module';
import { DespachoService } from './despacho.service';
import { AgendamentosService } from './agendamentos.service';
import { AgendamentosController, AvulsaController, ListasController, TrabalhosController } from './impressao.controller';
import { ListasService } from './listas.service';
import { TrabalhosService } from './trabalhos.service';

@Module({
  imports: [AgentesModule, ConsultasModule],
  controllers: [ListasController, AvulsaController, TrabalhosController, AgendamentosController],
  providers: [ListasService, TrabalhosService, DespachoService, AgendamentosService],
})
export class ImpressaoModule {}
