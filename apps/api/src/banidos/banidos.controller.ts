import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { EmpresaAtual, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { BanidosService } from './banidos.service';
import { BanirDto } from './dto';

@Controller('banidos')
export class BanidosController {
  constructor(private readonly banidos: BanidosService) {}

  @Get()
  @RequerPermissao('produto_banido.ver')
  listar(@EmpresaAtual() empresaId: string) {
    return this.banidos.listar(empresaId);
  }

  @Post()
  @HttpCode(200)
  @RequerPermissao('produto_banido.editar')
  banir(@EmpresaAtual() empresaId: string, @Body() dto: BanirDto, @UsuarioAtual() usuario: UsuarioRequisicao) {
    return this.banidos.banir(empresaId, dto, usuario.id);
  }

  @Delete(':codigo')
  @HttpCode(204)
  @RequerPermissao('produto_banido.editar')
  async liberar(@EmpresaAtual() empresaId: string, @Param('codigo') codigo: string, @UsuarioAtual() usuario: UsuarioRequisicao) {
    await this.banidos.liberar(empresaId, codigo, usuario.id);
  }
}
