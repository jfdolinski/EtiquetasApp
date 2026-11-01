import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { EmpresaAtual, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { SalvarNotificacoesDto } from './dto';
import { NotificacoesService } from './notificacoes.service';

@Controller('notificacoes')
export class NotificacoesController {
  constructor(private readonly notificacoes: NotificacoesService) {}

  @Get()
  @RequerPermissao('notificacao.ver')
  listar(@EmpresaAtual() empresaId: string) {
    return this.notificacoes.listar(empresaId);
  }

  @Get('nao-lidas')
  @RequerPermissao('notificacao.ver')
  naoLidas(@EmpresaAtual() empresaId: string) {
    return this.notificacoes.naoLidas(empresaId);
  }

  @Post('lidas')
  @HttpCode(204)
  @RequerPermissao('notificacao.ver')
  async marcarTodas(@EmpresaAtual() empresaId: string) {
    await this.notificacoes.marcarTodasLidas(empresaId);
  }

  @Post(':id/lida')
  @HttpCode(204)
  @RequerPermissao('notificacao.ver')
  async marcar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.notificacoes.marcarLida(empresaId, id);
  }

  @Get('configuracao')
  @RequerPermissao('notificacao.ver')
  configuracao(@EmpresaAtual() empresaId: string) {
    return this.notificacoes.configuracao(empresaId);
  }

  @Put('configuracao')
  @RequerPermissao('notificacao.editar')
  salvar(@EmpresaAtual() empresaId: string, @Body() dto: SalvarNotificacoesDto, @UsuarioAtual() usuario: UsuarioRequisicao) {
    return this.notificacoes.salvar(empresaId, dto, usuario.id);
  }

  @Post('teste')
  @HttpCode(200)
  @RequerPermissao('notificacao.editar')
  testar(@EmpresaAtual() empresaId: string, @UsuarioAtual() usuario: UsuarioRequisicao) {
    return this.notificacoes.testar(empresaId, usuario.id);
  }
}
