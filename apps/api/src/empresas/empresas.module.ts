import { Module } from '@nestjs/common';
import { ConsultaCnpjService } from './consulta-cnpj';
import { EmpresasController } from './empresas.controller';
import { EmpresasService } from './empresas.service';

@Module({
  controllers: [EmpresasController],
  providers: [EmpresasService, ConsultaCnpjService],
})
export class EmpresasModule {}
