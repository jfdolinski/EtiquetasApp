import { Module } from '@nestjs/common';
import { EntregadoresAdminController, EntregadoresAdminService } from './admin';
import { CreditosService } from './creditos';
import { DirecionamentoController, DirecionamentoService } from './direcionamento';
import { FechamentoController, FechamentoEntregadorController, FechamentoService } from './fechamento';
import { ChamadasEmpresaController, ChamadasEntregadorController, ChamadasService } from './chamadas';
import { EntregadorAppController, EntregadoresService, EntregadorPublicoController } from './entregadores';
import { EntregadorGuard } from './guarda';
import { EntregasEmpresaController, EntregasEmpresaService } from './empresa';
import { MapasService } from './mapas';

/** Entregas (docs/ENTREGAS.md), etapas 1 a 4: entregadores, créditos, online, mapa, chamadas, direcionamento e fechamento. */
@Module({
  controllers: [EntregadorPublicoController, EntregadorAppController, EntregadoresAdminController, EntregasEmpresaController, ChamadasEmpresaController, ChamadasEntregadorController, DirecionamentoController, FechamentoController, FechamentoEntregadorController],
  providers: [MapasService, CreditosService, EntregadoresService, EntregadorGuard, EntregadoresAdminService, EntregasEmpresaService, ChamadasService, DirecionamentoService, FechamentoService],
})
export class EntregasModule {}
