import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import type { Response } from 'express';
import {
  AMBIENTES_NFSE,
  LIMITE_DESCRICAO_SERVICO,
  MAX_TEXTO_CANCELAMENTO,
  REGIMES_NFSE,
  SITUACOES_NOTA,
  VALORES_PEDIDO_NFSE,
  type AmbienteNfse,
  type AutomaticoNfse,
  type DadosEmissorNfse,
  type NovaNotaAvulsa,
  type RegimeNfse,
  type ServicoNfse,
  type SituacaoNota,
  type TomadorNfse,
  type ValorPedidoNfse,
} from '@etiquetas/shared';
import { ApenasSuperAdmin, EmpresaAtual, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { NfseService, type Escopo } from './nfse.service';

class ServicoDto implements ServicoNfse {
  @IsString() @MaxLength(10) codigoTributacaoNacional: string;
  @IsOptional() @IsString() @MaxLength(10) codigoTributacaoMunicipal?: string | null;
  @IsOptional() @IsString() @MaxLength(12) codigoNbs?: string | null;
  @IsString() @MaxLength(LIMITE_DESCRICAO_SERVICO) descricao: string;
  @IsOptional() @IsNumber() aliquotaIss?: number | null;
  @IsOptional() @IsBoolean() issRetido?: boolean;
  @IsOptional() @IsNumber() percentualTributos?: number | null;
}

class AutomaticoDto implements AutomaticoNfse {
  @IsOptional() @IsBoolean() mensalidade?: boolean;
  @IsOptional() @IsBoolean() pedidos?: boolean;
  @IsOptional() @IsIn(VALORES_PEDIDO_NFSE) valorPedido?: ValorPedidoNfse;
}

class EmissorDto implements DadosEmissorNfse {
  @IsIn(AMBIENTES_NFSE, { message: 'Escolha o ambiente.' }) ambiente: AmbienteNfse;
  @IsString() @MaxLength(20) cnpj: string;
  @IsOptional() @IsString() @MaxLength(20) inscricaoMunicipal?: string | null;
  @IsString() @MaxLength(150) razaoSocial: string;
  @IsString() @Matches(/^\d{7}$/, { message: 'O código do município (IBGE) tem 7 dígitos.' }) codigoMunicipio: string;
  @IsIn(REGIMES_NFSE, { message: 'Escolha o regime tributário.' }) regime: RegimeNfse;
  @IsOptional() @IsInt() regimeEspecial?: number;
  @IsOptional() @IsString() @MaxLength(80) email?: string | null;
  @IsOptional() @IsString() @MaxLength(20) telefone?: string | null;
  @IsString() @MaxLength(5) serie: string;
  @IsInt() @Min(1) proximoNumero: number;
  @IsObject() @ValidateNested() @Type(() => ServicoDto) servico: ServicoDto;
  @IsObject() @ValidateNested() @Type(() => AutomaticoDto) automatico: AutomaticoDto;
}

class CertificadoDto {
  /** O .pfx em base64 (pode vir como data URL). */
  @IsString() @MaxLength(200_000) arquivo: string;
  @IsString() @MaxLength(200) senha: string;
}

class TomadorDto implements TomadorNfse {
  @IsOptional() @IsString() @MaxLength(20) documento?: string | null;
  @IsString() @MaxLength(150) nome: string;
  @IsOptional() @IsString() @MaxLength(80) email?: string | null;
}

class AvulsaDto implements NovaNotaAvulsa {
  @IsOptional() @IsObject() @ValidateNested() @Type(() => TomadorDto) tomador: TomadorDto | null;
  @IsOptional() @IsString() @MaxLength(LIMITE_DESCRICAO_SERVICO) descricao?: string | null;
  @IsInt({ message: 'Informe o valor do serviço.' }) @Min(1, { message: 'Informe o valor do serviço.' }) valorCentavos: number;
  @IsOptional() @IsString() @MaxLength(10) competencia?: string | null;
}

class CancelarDto {
  @IsInt({ message: 'Escolha o motivo do cancelamento.' }) motivo: number;
  @IsString() @MaxLength(MAX_TEXTO_CANCELAMENTO + 50) texto: string;
}

class FiltroDto {
  @IsOptional() @IsIn(['EMITIDAS', 'RECEBIDAS']) tipo?: 'EMITIDAS' | 'RECEBIDAS';
  @IsOptional() @IsIn(SITUACOES_NOTA) situacao?: SituacaoNota;
  @IsOptional() @IsString() @MaxLength(80) busca?: string;
}

async function enviarPdf(res: Response, p: Promise<{ nome: string; bytes: Uint8Array }>) {
  const { nome, bytes } = await p;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.end(Buffer.from(bytes));
}

async function enviarXml(res: Response, p: Promise<{ nome: string; xml: string }>) {
  const { nome, xml } = await p;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.end(xml);
}

/** NFS-e da empresa: dados fiscais, certificado, notas emitidas e as recebidas da plataforma. */
@Controller('nfse')
export class NfseEmpresaController {
  constructor(private readonly nfse: NfseService) {}

  private e(empresaId: string): Escopo {
    return { empresaId };
  }

  @Get('emissor')
  @RequerPermissao('nfse.ver')
  emissor(@EmpresaAtual() empresaId: string) {
    return this.nfse.emissor(this.e(empresaId)).then((e) => ({ emissor: e }));
  }

  @Put('emissor')
  @RequerPermissao('nfse.configurar')
  salvar(@EmpresaAtual() empresaId: string, @Body() dto: EmissorDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.nfse.salvarEmissor(this.e(empresaId), dto, u.id);
  }

  @Post('emissor/certificado')
  @HttpCode(200)
  @RequerPermissao('nfse.configurar')
  certificado(@EmpresaAtual() empresaId: string, @Body() dto: CertificadoDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.nfse.enviarCertificado(this.e(empresaId), dto.arquivo, dto.senha, u.id);
  }

  @Delete('emissor/certificado')
  @RequerPermissao('nfse.configurar')
  removerCertificado(@EmpresaAtual() empresaId: string, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.nfse.removerCertificado(this.e(empresaId), u.id);
  }

  @Get('notas')
  @RequerPermissao('nfse.ver')
  listar(@EmpresaAtual() empresaId: string, @Query() f: FiltroDto) {
    return this.nfse.listar(this.e(empresaId), f);
  }

  @Post('notas')
  @RequerPermissao('nfse.emitir')
  avulsa(@EmpresaAtual() empresaId: string, @Body() dto: AvulsaDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.nfse.avulsa(this.e(empresaId), dto, u.id);
  }

  @Get('notas/:id')
  @RequerPermissao('nfse.ver')
  obter(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.nfse.obter(this.e(empresaId), id);
  }

  @Get('notas/:id/pdf')
  @RequerPermissao('nfse.ver')
  pdf(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    return enviarPdf(res, this.nfse.pdf(this.e(empresaId), id));
  }

  @Get('notas/:id/xml')
  @RequerPermissao('nfse.ver')
  xml(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    return enviarXml(res, this.nfse.xml(this.e(empresaId), id));
  }

  @Post('notas/:id/emitir-de-novo')
  @HttpCode(200)
  @RequerPermissao('nfse.emitir')
  deNovo(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.nfse.emitirDeNovo(this.e(empresaId), id, u.id);
  }

  @Post('notas/:id/cancelar')
  @HttpCode(200)
  @RequerPermissao('nfse.emitir')
  cancelar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelarDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.nfse.cancelar(this.e(empresaId), id, dto.motivo, dto.texto, u.id);
  }

  @Get('pedidos/:id')
  @RequerPermissao('nfse.ver')
  doPedido(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.nfse.notaDoPedidoResumo(empresaId, id).then((nota) => ({ nota }));
  }

  @Post('pedidos/:id/nota')
  @RequerPermissao('nfse.emitir')
  emitirDoPedido(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.nfse.doPedido(empresaId, id, u.id);
  }
}

/** NFS-e da plataforma (super-admin): a nota da mensalidade de cada empresa. */
@ApenasSuperAdmin()
@Controller('plataforma/nfse')
export class NfsePlataformaController {
  private readonly p: Escopo = { plataforma: true };
  constructor(private readonly nfse: NfseService) {}

  @Get('emissor')
  emissor() {
    return this.nfse.emissor(this.p).then((e) => ({ emissor: e }));
  }

  @Put('emissor')
  salvar(@Body() dto: EmissorDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.nfse.salvarEmissor(this.p, dto, u.id);
  }

  @Post('emissor/certificado')
  @HttpCode(200)
  certificado(@Body() dto: CertificadoDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.nfse.enviarCertificado(this.p, dto.arquivo, dto.senha, u.id);
  }

  @Delete('emissor/certificado')
  removerCertificado(@UsuarioAtual() u: UsuarioRequisicao) {
    return this.nfse.removerCertificado(this.p, u.id);
  }

  @Get('notas')
  listar(@Query() f: FiltroDto) {
    return this.nfse.listar(this.p, f);
  }

  @Post('notas')
  avulsa(@Body() dto: AvulsaDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.nfse.avulsa(this.p, dto, u.id);
  }

  @Get('notas/:id')
  obter(@Param('id', ParseUUIDPipe) id: string) {
    return this.nfse.obter(this.p, id);
  }

  @Get('notas/:id/pdf')
  pdf(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    return enviarPdf(res, this.nfse.pdf(this.p, id));
  }

  @Get('notas/:id/xml')
  xml(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    return enviarXml(res, this.nfse.xml(this.p, id));
  }

  @Post('notas/:id/emitir-de-novo')
  @HttpCode(200)
  deNovo(@Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.nfse.emitirDeNovo(this.p, id, u.id);
  }

  @Post('notas/:id/cancelar')
  @HttpCode(200)
  cancelar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelarDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.nfse.cancelar(this.p, id, dto.motivo, dto.texto, u.id);
  }

  @Post('pagamentos/:id/nota')
  doPagamento(@Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.nfse.doPagamento(id, u.id);
  }
}
