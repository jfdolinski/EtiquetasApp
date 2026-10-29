import { Global, Module } from '@nestjs/common';
import { AvaliacaoCobrancaService } from './avaliacao.service';
import { AssinaturaController, CobrancaController } from './cobranca.controller';
import { CobrancaService } from './cobranca.service';
import { MensagensCobrancaService } from './mensagens-cobranca.service';

/** Global: o AuthGuard e o login usam as mensagens de bloqueio/carência. */
@Global()
@Module({
  controllers: [CobrancaController, AssinaturaController],
  providers: [MensagensCobrancaService, AvaliacaoCobrancaService, CobrancaService],
  exports: [MensagensCobrancaService],
})
export class CobrancaModule {}
