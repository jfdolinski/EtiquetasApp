import { Module } from '@nestjs/common';
import { AgentesModule } from '../agentes/agentes.module';
import { CatalogoService } from '../posts/catalogo.service';
import { ConsultasController } from './consultas.controller';
import { ConsultasService } from './consultas.service';

@Module({
  imports: [AgentesModule],
  controllers: [ConsultasController],
  providers: [ConsultasService, CatalogoService],
  exports: [ConsultasService, CatalogoService],
})
export class ConsultasModule {}
