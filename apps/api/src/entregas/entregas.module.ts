import { Module } from '@nestjs/common';
import { EntregadoresAdminController, EntregadoresAdminService } from './admin';
import { CreditosService } from './creditos';
import { EntregadorAppController, EntregadoresService, EntregadorGuard, EntregadorPublicoController } from './entregadores';
import { EntregasEmpresaController, EntregasEmpresaService } from './empresa';
import { MapasService } from './mapas';

/** Entregas (docs/ENTREGAS.md), etapa 1: entregadores, créditos, online e mapa. */
@Module({
  controllers: [EntregadorPublicoController, EntregadorAppController, EntregadoresAdminController, EntregasEmpresaController],
  providers: [MapasService, CreditosService, EntregadoresService, EntregadorGuard, EntregadoresAdminService, EntregasEmpresaService],
})
export class EntregasModule {}
