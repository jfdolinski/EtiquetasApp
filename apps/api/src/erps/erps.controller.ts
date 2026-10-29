import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApenasSuperAdmin, EmpresaAtual, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AtualizarSistemaErpDto, AtualizarTemplateConsultaDto, CopiarTemplateDto, CriarSistemaErpDto, TemplateConsultaDto } from './dto';
import { ErpEmpresaService } from './erp-empresa.service';
import { ErpsService } from './erps.service';

/** Cadastro de ERPs e templates (plataforma). */
@Controller('erps')
@ApenasSuperAdmin()
export class ErpsController {
  constructor(private readonly erps: ErpsService) {}

  @Get()
  listar() {
    return this.erps.listar();
  }

  @Get(':id')
  obter(@Param('id', ParseUUIDPipe) id: string) {
    return this.erps.obter(id);
  }

  @Post()
  criar(@Body() dto: CriarSistemaErpDto, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.erps.criar(dto, autor.id);
  }

  @Patch(':id')
  atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarSistemaErpDto, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.erps.atualizar(id, dto, autor.id);
  }

  @Delete(':id')
  @HttpCode(204)
  async excluir(@Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() autor: UsuarioRequisicao) {
    await this.erps.excluir(id, autor.id);
  }

  @Post(':id/consultas')
  criarConsulta(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TemplateConsultaDto, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.erps.criarConsulta(id, dto, autor.id);
  }

  @Patch(':id/consultas/:consultaId')
  atualizarConsulta(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('consultaId', ParseUUIDPipe) consultaId: string,
    @Body() dto: AtualizarTemplateConsultaDto,
    @UsuarioAtual() autor: UsuarioRequisicao,
  ) {
    return this.erps.atualizarConsulta(id, consultaId, dto, autor.id);
  }

  @Delete(':id/consultas/:consultaId')
  @HttpCode(204)
  async excluirConsulta(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('consultaId', ParseUUIDPipe) consultaId: string,
    @UsuarioAtual() autor: UsuarioRequisicao,
  ) {
    await this.erps.excluirConsulta(id, consultaId, autor.id);
  }
}

/** ERP vinculado à empresa atual: template e cópia para as consultas da empresa. */
@Controller('erp-empresa')
export class ErpEmpresaController {
  constructor(private readonly erp: ErpEmpresaService) {}

  @Get()
  @RequerPermissao('sql.ver')
  obter(@EmpresaAtual() empresaId: string) {
    return this.erp.obter(empresaId);
  }

  @Post('copiar')
  @HttpCode(200)
  @RequerPermissao('sql.editar')
  copiar(@EmpresaAtual() empresaId: string, @Body() dto: CopiarTemplateDto, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.erp.copiar(empresaId, dto, autor.id);
  }
}
