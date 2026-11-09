import { Module } from '@nestjs/common';
import { BanidosModule } from '../banidos/banidos.module';
import { ConsultasModule } from '../consultas/consultas.module';
import { TelasModule } from '../telas/telas.module';
import { ConfiguracaoPedidosController, ConfiguracaoPedidosService } from './configuracao';

@Module({ imports: [ConsultasModule, BanidosModule, TelasModule], controllers: [ConfiguracaoPedidosController], providers: [ConfiguracaoPedidosService] })
export class PedidosModule {}
