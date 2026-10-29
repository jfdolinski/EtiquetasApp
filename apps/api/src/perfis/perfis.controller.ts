import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { EmpresaAtual, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AtualizarPerfilDto, CriarPerfilDto } from './dto';
import { PerfisService } from './perfis.service';

@Controller('permissoes')
export class PermissoesController {
  constructor(private readonly perfis: PerfisService) {}

  @Get()
  @RequerPermissao('perfil.ver')
  catalogo() {
    return this.perfis.catalogo();
  }
}

@Controller('perfis')
export class PerfisController {
  constructor(private readonly perfis: PerfisService) {}

  @Get()
  @RequerPermissao('perfil.ver')
  listar(@EmpresaAtual() empresaId: string) {
    return this.perfis.listar(empresaId);
  }

  @Get(':id')
  @RequerPermissao('perfil.ver')
  obter(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.perfis.obter(empresaId, id);
  }

  @Post()
  @RequerPermissao('perfil.editar')
  criar(@EmpresaAtual() empresaId: string, @Body() dto: CriarPerfilDto, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.perfis.criar(empresaId, dto, autor.id);
  }

  @Patch(':id')
  @RequerPermissao('perfil.editar')
  atualizar(
    @EmpresaAtual() empresaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarPerfilDto,
    @UsuarioAtual() autor: UsuarioRequisicao,
  ) {
    return this.perfis.atualizar(empresaId, id, dto, autor.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequerPermissao('perfil.editar')
  async excluir(
    @EmpresaAtual() empresaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioAtual() autor: UsuarioRequisicao,
  ) {
    await this.perfis.excluir(empresaId, id, autor.id);
  }
}
