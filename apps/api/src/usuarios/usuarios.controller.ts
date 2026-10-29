import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { EmpresaAtual, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AtualizarUsuarioDto, CriarUsuarioDto } from './dto';
import { UsuariosService } from './usuarios.service';

@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  @RequerPermissao('usuario.ver')
  listar(@EmpresaAtual() empresaId: string) {
    return this.usuarios.listar(empresaId);
  }

  @Get(':id')
  @RequerPermissao('usuario.ver')
  obter(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.usuarios.obter(empresaId, id);
  }

  @Post()
  @RequerPermissao('usuario.editar')
  criar(@EmpresaAtual() empresaId: string, @Body() dto: CriarUsuarioDto, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.usuarios.criar(empresaId, dto, autor.id);
  }

  @Patch(':id')
  @RequerPermissao('usuario.editar')
  atualizar(
    @EmpresaAtual() empresaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarUsuarioDto,
    @UsuarioAtual() autor: UsuarioRequisicao,
  ) {
    return this.usuarios.atualizar(empresaId, id, dto, autor.id);
  }
}
