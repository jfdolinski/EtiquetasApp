import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { EmpresaAtual, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AmostraDto, AtualizarImpressoraDto, AtualizarModeloDto, CriarImpressoraDto, CriarModeloDto, GerarDto } from './dto';
import { ImpressorasService } from './impressoras.service';
import { ModelosService } from './modelos.service';

@Controller('modelos')
export class ModelosController {
  constructor(private readonly modelos: ModelosService) {}

  @Get()
  @RequerPermissao('etiqueta.modelo.ver')
  listar(@EmpresaAtual() empresaId: string) {
    return this.modelos.listar(empresaId);
  }

  @Get('consultas')
  @RequerPermissao('etiqueta.modelo.ver')
  consultas(@EmpresaAtual() empresaId: string) {
    return this.modelos.consultasDisponiveis(empresaId);
  }

  /** Gera ZPL/PPLA/PPLB/ESC-POS/PDF de um layout (salvo ou em edição) com os registros enviados. */
  @Post('gerar')
  @HttpCode(200)
  @RequerPermissao('etiqueta.modelo.ver')
  gerar(@EmpresaAtual() empresaId: string, @Body() dto: GerarDto) {
    return this.modelos.gerar(empresaId, dto);
  }

  @Get(':id')
  @RequerPermissao('etiqueta.modelo.ver')
  obter(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.modelos.obter(empresaId, id);
  }

  @Post()
  @RequerPermissao('etiqueta.modelo.editar')
  criar(@EmpresaAtual() empresaId: string, @Body() dto: CriarModeloDto, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.modelos.criar(empresaId, dto, autor.id);
  }

  @Patch(':id')
  @RequerPermissao('etiqueta.modelo.editar')
  atualizar(
    @EmpresaAtual() empresaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarModeloDto,
    @UsuarioAtual() autor: UsuarioRequisicao,
  ) {
    return this.modelos.atualizar(empresaId, id, dto, autor.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequerPermissao('etiqueta.modelo.editar')
  async excluir(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() autor: UsuarioRequisicao) {
    await this.modelos.excluir(empresaId, id, autor.id);
  }

  /** Linhas reais da consulta do modelo, para pré-visualizar no editor. */
  @Post(':id/amostra')
  @HttpCode(200)
  @RequerPermissao('etiqueta.modelo.ver')
  amostra(
    @EmpresaAtual() empresaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AmostraDto,
    @UsuarioAtual() usuario: UsuarioRequisicao,
  ) {
    return this.modelos.amostra(empresaId, id, dto, usuario.id);
  }
}

@Controller('impressoras')
export class ImpressorasController {
  constructor(private readonly impressoras: ImpressorasService) {}

  @Get()
  @RequerPermissao('impressora.ver')
  listar(@EmpresaAtual() empresaId: string) {
    return this.impressoras.listar(empresaId);
  }

  @Post()
  @RequerPermissao('impressora.editar')
  criar(@EmpresaAtual() empresaId: string, @Body() dto: CriarImpressoraDto, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.impressoras.criar(empresaId, dto, autor.id);
  }

  @Patch(':id')
  @RequerPermissao('impressora.editar')
  atualizar(
    @EmpresaAtual() empresaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarImpressoraDto,
    @UsuarioAtual() autor: UsuarioRequisicao,
  ) {
    return this.impressoras.atualizar(empresaId, id, dto, autor.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequerPermissao('impressora.editar')
  async excluir(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() autor: UsuarioRequisicao) {
    await this.impressoras.excluir(empresaId, id, autor.id);
  }
}
