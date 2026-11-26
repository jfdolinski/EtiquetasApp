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
import { JuntosController, JuntosService, RoteirizarController } from './juntos';
import { BalcaoEmpresaController, BalcaoEntregadorController, BalcaoService } from './balcao';
import { RastreioController, RastreioService } from './rastreio';
import { EscalaAdminController, EscalaEmpresaController, EscalaEntregadorController, EscalaService } from './escala';
import { MetasEmpresaController, MetasEntregadorController, MetasService } from './metas';
import { ChaveApiGuard, IntegracaoApiController, IntegracaoEmpresaController, IntegracaoService } from './integracao';
import { SuporteAdminController, SuporteEmpresaController, SuporteEntregadorController, SuporteService } from './suporte';

/** Entregas (docs/ENTREGAS.md), etapas 1 a 14: entregadores, créditos, online, mapa, chamadas, direcionamento, fechamento e acompanhamento. */
@Module({
  imports: [ConsultasModule],
  controllers: [MetasEmpresaController, MetasEntregadorController, IntegracaoEmpresaController, IntegracaoApiController, SuporteEmpresaController, SuporteEntregadorController, SuporteAdminController, RoteirizarController, EscalaEmpresaController, EscalaEntregadorController, EscalaAdminController, BalcaoEmpresaController, BalcaoEntregadorController, JuntosController, PedidosErpController, EntregadorPublicoController, EntregadorAppController, EntregadoresAdminController, EntregasEmpresaController, ChamadasEmpresaController, ChamadasEntregadorController, DirecionamentoController, FechamentoController, FechamentoEntregadorController, ExtratoPdfController, RastreioController],
  providers: [MetasService, IntegracaoService, ChaveApiGuard, SuporteService, EscalaService, BalcaoService, JuntosService, PedidosErpService, MapasService, CreditosService, EntregadoresService, EntregadorGuard, EntregadoresAdminService, EntregasEmpresaService, ChamadasService, DirecionamentoService, FechamentoService, RastreioService],
  exports: [ChamadasService, RastreioService],
})
export class EntregasModule {}
