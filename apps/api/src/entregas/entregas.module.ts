import { Module } from '@nestjs/common';
import { ConsultasModule } from '../consultas/consultas.module';
import { EntregadoresAdminController, EntregadoresAdminService } from './admin';
import { CreditosService } from './creditos';
import { DirecionamentoController, DirecionamentoService } from './direcionamento';
import { ExtratoPdfController, FechamentoController, FechamentoEntregadorController, FechamentoService } from './fechamento';
import { ChamadasEmpresaController, ChamadasEntregadorController, ChamadasService } from './chamadas';
import { EntregadorAppController, EntregadoresService, EntregadorPublicoController } from './entregadores';
import { EntregadorGuard } from './guarda';
import { EntregasEmpresaController, EntregasEmpresaService } from './empresa';
import { MapasService } from './mapas';
import { PedidosErpController, PedidosErpService } from './pedidos-erp';
import { JuntosController, JuntosService } from './juntos';
import { RastreioController, RastreioService } from './rastreio';

/** Entregas (docs/ENTREGAS.md), etapas 1 a 11: entregadores, créditos, online, mapa, chamadas, direcionamento, fechamento e acompanhamento. */
@Module({
  imports: [ConsultasModule],
  controllers: [JuntosController, PedidosErpController, EntregadorPublicoController, EntregadorAppController, EntregadoresAdminController, EntregasEmpresaController, ChamadasEmpresaController, ChamadasEntregadorController, DirecionamentoController, FechamentoController, FechamentoEntregadorController, ExtratoPdfController, RastreioController],
  providers: [JuntosService, PedidosErpService, MapasService, CreditosService, EntregadoresService, EntregadorGuard, EntregadoresAdminService, EntregasEmpresaService, ChamadasService, DirecionamentoService, FechamentoService, RastreioService],
  exports: [ChamadasService, RastreioService],
})
export class EntregasModule {}
