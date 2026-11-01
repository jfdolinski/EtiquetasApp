import { Module } from '@nestjs/common';
import { CadastroController } from './cadastro.controller';
import { CadastroService } from './cadastro.service';
import { ConsultaCnpjService } from './consulta-cnpj';
import { EmpresasController } from './empresas.controller';
import { EmpresasService } from './empresas.service';

@Module({
  controllers: [EmpresasController, CadastroController],
  providers: [EmpresasService, ConsultaCnpjService, CadastroService],
})
export class EmpresasModule {}
