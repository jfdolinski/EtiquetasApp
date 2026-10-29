import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { EmpresaAtual, Publico, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AgentesService } from './agentes.service';
import { ConexoesService } from './conexoes.service';
import {
  AtivarAgenteDto,
  AtualizarAgenteDto,
  AtualizarConexaoDto,
  ConsultarDto,
  CriarAgenteDto,
  CriarConexaoDto,
} from './dto';

/** Rota pública usada pelo próprio agente na primeira execução. */
@Controller('agente')
export class AtivacaoAgenteController {
  constructor(private readonly agentes: AgentesService) {}

  @Post('ativar')
  @Publico()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  ativar(@Body() dto: AtivarAgenteDto) {
    return this.agentes.ativar(dto);
  }
}

@Controller('agentes')
export class AgentesController {
  constructor(private readonly agentes: AgentesService) {}

  @Get()
  @RequerPermissao('agente.ver')
  listar(@EmpresaAtual() empresaId: string) {
    return this.agentes.listar(empresaId);
  }

  @Get(':id')
  @RequerPermissao('agente.ver')
  obter(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.agentes.obter(empresaId, id);
  }

  @Post()
  @RequerPermissao('agente.editar')
  criar(@EmpresaAtual() empresaId: string, @Body() dto: CriarAgenteDto, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.agentes.criar(empresaId, dto, autor.id);
  }

  @Patch(':id')
  @RequerPermissao('agente.editar')
  atualizar(
    @EmpresaAtual() empresaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarAgenteDto,
    @UsuarioAtual() autor: UsuarioRequisicao,
  ) {
    return this.agentes.atualizar(empresaId, id, dto, autor.id);
  }

  @Post(':id/codigo-ativacao')
  @RequerPermissao('agente.editar')
  novoCodigo(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.agentes.novoCodigoAtivacao(empresaId, id, autor.id);
  }

  @Post(':id/rotacionar-token')
  @HttpCode(200)
  @RequerPermissao('agente.editar')
  rotacionar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.agentes.rotacionarToken(empresaId, id, autor.id);
  }
}

@Controller('conexoes')
export class ConexoesController {
  constructor(private readonly conexoes: ConexoesService) {}

  @Get()
  @RequerPermissao('agente.ver')
  listar(@EmpresaAtual() empresaId: string) {
    return this.conexoes.listar(empresaId);
  }

  @Post()
  @RequerPermissao('agente.editar')
  criar(@EmpresaAtual() empresaId: string, @Body() dto: CriarConexaoDto, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.conexoes.criar(empresaId, dto, autor.id);
  }

  @Patch(':id')
  @RequerPermissao('agente.editar')
  atualizar(
    @EmpresaAtual() empresaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarConexaoDto,
    @UsuarioAtual() autor: UsuarioRequisicao,
  ) {
    return this.conexoes.atualizar(empresaId, id, dto, autor.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequerPermissao('agente.editar')
  async excluir(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() autor: UsuarioRequisicao) {
    await this.conexoes.excluir(empresaId, id, autor.id);
  }

  @Post(':id/testar')
  @HttpCode(200)
  @RequerPermissao('agente.ver')
  testar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.conexoes.testar(empresaId, id);
  }

  @Post(':id/consultar')
  @HttpCode(200)
  @RequerPermissao('sql.editar')
  consultar(
    @EmpresaAtual() empresaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConsultarDto,
    @UsuarioAtual() autor: UsuarioRequisicao,
  ) {
    return this.conexoes.consultar(empresaId, id, dto, autor.id);
  }
}
