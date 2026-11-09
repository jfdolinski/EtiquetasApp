import { Module } from '@nestjs/common';
import { BanidosModule } from '../banidos/banidos.module';
import { ConsultasModule } from '../consultas/consultas.module';
import { TelasModule } from '../telas/telas.module';
import { CepService } from './cep';
import { ConfiguracaoPedidosController, ConfiguracaoPedidosService } from './configuracao';
import { LojaController, LojaService } from './loja';

@Module({ imports: [ConsultasModule, BanidosModule, TelasModule], controllers: [ConfiguracaoPedidosController, LojaController], providers: [ConfiguracaoPedidosService, LojaService, CepService] })
export class PedidosModule {}
