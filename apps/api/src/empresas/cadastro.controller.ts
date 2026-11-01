import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApenasSuperAdmin, Publico, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { CadastroService } from './cadastro.service';
import { CadastroDto } from './dto';

@Controller('cadastros')
export class CadastroController {
  constructor(private readonly cadastro: CadastroService) {}

  @Post()
  @Publico()
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  solicitar(@Body() dto: CadastroDto) {
    return this.cadastro.solicitar(dto);
  }

  @Get('pendentes')
  @ApenasSuperAdmin()
  pendentes() {
    return this.cadastro.pendentes();
  }

  @Post('empresas/:id/aprovar')
  @ApenasSuperAdmin()
  @HttpCode(204)
  async aprovarEmpresa(@Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() autor: UsuarioRequisicao) {
    await this.cadastro.aprovarEmpresa(id, autor.id);
  }

  @Post('empresas/:id/recusar')
  @ApenasSuperAdmin()
  @HttpCode(204)
  async recusarEmpresa(@Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() autor: UsuarioRequisicao) {
    await this.cadastro.recusarEmpresa(id, autor.id);
  }
}
