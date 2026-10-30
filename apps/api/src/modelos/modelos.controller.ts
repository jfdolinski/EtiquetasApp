import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AgentesGateway } from '../agentes/agentes.gateway';
import { ApenasSuperAdmin, EmpresaAtual, Publico, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import {
  AmostraDto,
  AtualizarImpressoraDto,
  AtualizarModeloDto,
  CadastrarImpressoraAgenteDto,
  CopiarModeloDto,
  CriarImpressoraDto,
  CriarModeloDto,
  GerarDto,
  ImportarModeloDto,
} from './dto';
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

  @Get(':id/exportar')
  @RequerPermissao('etiqueta.modelo.ver')
  exportar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.modelos.exportar(empresaId, id, autor.id);
  }

  @Post('importar')
  @RequerPermissao('etiqueta.modelo.editar')
  importar(@EmpresaAtual() empresaId: string, @Body() dto: ImportarModeloDto, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.modelos.importar(empresaId, dto.arquivo, autor.id);
  }

  /** Copia o modelo da empresa atual (X-Empresa-Id) para outras empresas. */
  @Post(':id/copiar')
  @HttpCode(200)
  @ApenasSuperAdmin()
  copiar(
    @EmpresaAtual() empresaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CopiarModeloDto,
    @UsuarioAtual() autor: UsuarioRequisicao,
  ) {
    return this.modelos.copiarParaEmpresas(empresaId, id, dto.empresaIds, autor.id);
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

/**
 * Painel do agente (Windows): lista e cadastra as impressoras que o próprio agente entrega.
 * Autenticado pelo token do agente, como o WebSocket; a empresa vem do agente.
 */
@Controller('agente/impressoras')
@Publico()
export class ImpressorasAgenteController {
  constructor(
    private readonly impressoras: ImpressorasService,
    private readonly gateway: AgentesGateway,
  ) {}

  private async agente(autorizacao: string | undefined) {
    const auth = await this.gateway.autenticar(autorizacao);
    if (!auth.ok) throw auth.status === 403 ? new ForbiddenException(auth.mensagem) : new UnauthorizedException(auth.mensagem);
    return auth;
  }

  @Get()
  async listar(@Headers('authorization') autorizacao: string | undefined) {
    const { empresaId, agenteId } = await this.agente(autorizacao);
    return this.impressoras.listarDoAgente(empresaId, agenteId);
  }

  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async cadastrar(@Headers('authorization') autorizacao: string | undefined, @Body() dto: CadastrarImpressoraAgenteDto) {
    const { empresaId, agenteId } = await this.agente(autorizacao);
    return this.impressoras.cadastrarPeloAgente(empresaId, agenteId, dto);
  }
}
