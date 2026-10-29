import { Module } from '@nestjs/common';
import { AgentesController, AtivacaoAgenteController, ConexoesController } from './agentes.controller';
import { AgentesGateway } from './agentes.gateway';
import { AgentesService } from './agentes.service';
import { ConexoesService } from './conexoes.service';

@Module({
  controllers: [AtivacaoAgenteController, AgentesController, ConexoesController],
  providers: [AgentesGateway, AgentesService, ConexoesService],
  exports: [AgentesGateway, ConexoesService],
})
export class AgentesModule {}
