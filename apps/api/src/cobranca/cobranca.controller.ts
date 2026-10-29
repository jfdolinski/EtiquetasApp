import { Body, ConflictException, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApenasSuperAdmin, EmpresaAtual, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AvaliacaoCobrancaService } from './avaliacao.service';
import { CobrancaService } from './cobranca.service';
import { AssinaturaDto, PagamentoDto, ParametrosEmpresaDto, ParametrosGlobaisDto } from './dto';
import { MensagensCobrancaService } from './mensagens-cobranca.service';

/** Parâmetros, assinaturas, pagamentos e avaliação: plataforma (super-admin). */
@Controller('cobranca')
@ApenasSuperAdmin()
export class CobrancaController {
  constructor(
    private readonly cobranca: CobrancaService,
    private readonly avaliacao: AvaliacaoCobrancaService,
  ) {}

  @Get('parametros')
  parametros() {
    return this.cobranca.parametrosGlobais();
  }

  @Put('parametros')
  salvarParametros(@Body() dto: ParametrosGlobaisDto, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.cobranca.salvarParametrosGlobais(dto, autor.id);
  }

  @Get('empresas')
  situacoes() {
    return this.cobranca.situacoes();
  }

  @Put('empresas/:id/assinatura')
  salvarAssinatura(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssinaturaDto, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.cobranca.salvarAssinatura(id, dto, autor.id);
  }

  @Delete('empresas/:id/assinatura')
  @HttpCode(204)
  async removerAssinatura(@Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() autor: UsuarioRequisicao) {
    await this.cobranca.removerAssinatura(id, autor.id);
  }

  @Put('empresas/:id/parametros')
  salvarParametrosEmpresa(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ParametrosEmpresaDto, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.cobranca.salvarParametrosEmpresa(id, dto, autor.id);
  }

  @Get('empresas/:id/pagamentos')
  pagamentos(@Param('id', ParseUUIDPipe) id: string) {
    return this.cobranca.pagamentos(id);
  }

  @Post('empresas/:id/pagamentos')
  registrarPagamento(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PagamentoDto, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.cobranca.registrarPagamento(id, dto, autor.id);
  }

  @Post('empresas/:id/pagamentos/:pagamentoId/estornar')
  @HttpCode(200)
  estornar(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('pagamentoId', ParseUUIDPipe) pagamentoId: string,
    @UsuarioAtual() autor: UsuarioRequisicao,
  ) {
    return this.cobranca.estornarPagamento(id, pagamentoId, autor.id);
  }

  @Get('execucoes')
  execucoes() {
    return this.avaliacao.execucoes();
  }

  /** Executa a avaliação agora (além da agendada). */
  @Post('avaliar')
  @HttpCode(200)
  async avaliar() {
    const r = await this.avaliacao.executar('MANUAL');
    if (!r) throw new ConflictException('Já existe uma avaliação em andamento.');
    return r;
  }
}

/** O que a empresa vê da própria assinatura. */
@Controller('assinatura')
export class AssinaturaController {
  constructor(
    private readonly cobranca: CobrancaService,
    private readonly mensagens: MensagensCobrancaService,
  ) {}

  @Get()
  @RequerPermissao('empresa.ver')
  minha(@EmpresaAtual() empresaId: string) {
    return this.cobranca.minhaAssinatura(empresaId);
  }

  /** Aviso vigente para o banner: qualquer usuário da empresa. */
  @Get('aviso')
  async aviso(@EmpresaAtual() empresaId: string) {
    return { aviso: await this.mensagens.avisoAtual(empresaId) };
  }
}
