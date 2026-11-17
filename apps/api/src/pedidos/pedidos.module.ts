import { Module } from '@nestjs/common';
import { BanidosModule } from '../banidos/banidos.module';
import { ConsultasModule } from '../consultas/consultas.module';
import { TelasModule } from '../telas/telas.module';
import { CepService } from './cep';
import { ConfiguracaoPedidosController, ConfiguracaoPedidosService } from './configuracao';
import { LojaController, LojaService } from './loja';
import { PainelPedidosController, PainelPedidosService } from './painel';
import { VendasController, VendasService } from './vendas';
import { ImpressaoModule } from '../impressao/impressao.module';

@Module({ imports: [ConsultasModule, BanidosModule, TelasModule, ImpressaoModule], controllers: [ConfiguracaoPedidosController, VendasController, LojaController, PainelPedidosController], providers: [ConfiguracaoPedidosService, LojaService, CepService, PainelPedidosService, VendasService] })
export class PedidosModule {}
