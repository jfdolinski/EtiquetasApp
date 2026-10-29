import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ConexoesService } from '../agentes/conexoes.service';
import { EmpresaAtual, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { ConsultasService } from './consultas.service';
import { AtualizarConsultaDto, CriarConsultaDto, PreviaConsultaDto } from './dto';

@Controller('consultas')
export class ConsultasController {
  constructor(
    private readonly consultas: ConsultasService,
    private readonly conexoesService: ConexoesService,
  ) {}

  @Get()
  @RequerPermissao('sql.ver')
  listar(@EmpresaAtual() empresaId: string) {
    return this.consultas.listar(empresaId);
  }

  /** Conexões para o editor (quem edita SQL nem sempre tem `agente.ver`). Sem senhas. */
  @Get('conexoes')
  @RequerPermissao('sql.ver')
  conexoes(@EmpresaAtual() empresaId: string) {
    return this.conexoesService.listar(empresaId);
  }

  /** Executa SQL ainda não salvo, direto do editor. */
  @Post('previa')
  @HttpCode(200)
  @RequerPermissao('sql.editar')
  previa(@EmpresaAtual() empresaId: string, @Body() dto: PreviaConsultaDto, @UsuarioAtual() usuario: UsuarioRequisicao) {
    return this.consultas.previa(empresaId, dto, usuario.id);
  }

  @Get(':id')
  @RequerPermissao('sql.ver')
  obter(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.consultas.obter(empresaId, id);
  }

  @Post()
  @RequerPermissao('sql.editar')
  criar(@EmpresaAtual() empresaId: string, @Body() dto: CriarConsultaDto, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.consultas.criar(empresaId, dto, autor.id);
  }

  @Patch(':id')
  @RequerPermissao('sql.editar')
  atualizar(
    @EmpresaAtual() empresaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarConsultaDto,
    @UsuarioAtual() autor: UsuarioRequisicao,
  ) {
    return this.consultas.atualizar(empresaId, id, dto, autor.id);
  }

  @Post(':id/atualizar-campos')
  @HttpCode(200)
  @RequerPermissao('sql.editar')
  atualizarCampos(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.consultas.atualizarCampos(empresaId, id, autor.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequerPermissao('sql.editar')
  async excluir(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() autor: UsuarioRequisicao) {
    await this.consultas.excluir(empresaId, id, autor.id);
  }
}
