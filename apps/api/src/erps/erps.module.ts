import { Module } from '@nestjs/common';
import { AgentesModule } from '../agentes/agentes.module';
import { ConsultasModule } from '../consultas/consultas.module';
import { ErpEmpresaService } from './erp-empresa.service';
import { ErpEmpresaController, ErpsController } from './erps.controller';
import { ErpsService } from './erps.service';

@Module({
  imports: [AgentesModule, ConsultasModule],
  controllers: [ErpsController, ErpEmpresaController],
  providers: [ErpsService, ErpEmpresaService],
})
export class ErpsModule {}
