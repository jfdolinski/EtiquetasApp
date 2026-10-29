import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApenasSuperAdmin, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AtualizarEmpresaDto, CriarEmpresaDto } from './dto';
import { EmpresasService } from './empresas.service';

@Controller('empresas')
@ApenasSuperAdmin()
export class EmpresasController {
  constructor(private readonly empresas: EmpresasService) {}

  @Get()
  listar() {
    return this.empresas.listar();
  }

  @Get(':id')
  obter(@Param('id', ParseUUIDPipe) id: string) {
    return this.empresas.obter(id);
  }

  @Post()
  criar(@Body() dto: CriarEmpresaDto, @UsuarioAtual() usuario: UsuarioRequisicao) {
    return this.empresas.criar(dto, usuario.id);
  }

  @Patch(':id')
  atualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarEmpresaDto,
    @UsuarioAtual() usuario: UsuarioRequisicao,
  ) {
    return this.empresas.atualizar(id, dto, usuario.id);
  }
}
