import { Global, Module } from '@nestjs/common';
import { AuditoriaConsultaService } from './auditoria-consulta.service';
import { AuditoriaController } from './auditoria.controller';
import { AuditoriaService } from './auditoria.service';

@Global()
@Module({
  controllers: [AuditoriaController],
  providers: [AuditoriaService, AuditoriaConsultaService],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}
