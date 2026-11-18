import { Module } from '@nestjs/common';
import { EntregadoresAdminController, EntregadoresAdminService } from './admin';
import { CreditosService } from './creditos';
import { ChamadasEmpresaController, ChamadasEntregadorController, ChamadasService } from './chamadas';
import { EntregadorAppController, EntregadoresService, EntregadorPublicoController } from './entregadores';
import { EntregadorGuard } from './guarda';
import { EntregasEmpresaController, EntregasEmpresaService } from './empresa';
import { MapasService } from './mapas';

/** Entregas (docs/ENTREGAS.md), etapas 1 e 2: entregadores, créditos, online, mapa e chamadas. */
@Module({
  controllers: [EntregadorPublicoController, EntregadorAppController, EntregadoresAdminController, EntregasEmpresaController, ChamadasEmpresaController, ChamadasEntregadorController],
  providers: [MapasService, CreditosService, EntregadoresService, EntregadorGuard, EntregadoresAdminService, EntregasEmpresaService, ChamadasService],
})
export class EntregasModule {}
