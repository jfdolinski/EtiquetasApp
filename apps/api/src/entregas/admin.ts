import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import {
  formatarCpf,
  saldoDeDiarias,
  SITUACOES_ENTREGADOR,
  TIPOS_DOCUMENTO_ENTREGADOR,
  type EntregadorResumo,
  type PacoteCredito,
  type ParametrosEntregasPlataforma,
  type PedidoCreditoAdmin,
  type SituacaoEntregador,
  type SituacaoPedidoCredito,
  type TipoDocumentoEntregador,
  type TipoVeiculo,
} from '@etiquetas/shared';
import { ApenasSuperAdmin, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreditosService } from './creditos';
import { documentosFaltando } from './entregadores';
import { dataUrl } from './imagens';

class MotivoDto {
  @IsString() @MinLength(3, { message: 'Informe o motivo.' }) @MaxLength(500) motivo: string;
}

class BonusDto {
  @IsInt() @Min(1) @Max(60) diarias: number;
  @IsInt() @Min(1) @Max(365) validadeDias: number;
  @IsString() @MinLength(3, { message: 'Informe o motivo.' }) @MaxLength(200) motivo: string;
}

class PacoteDto {
  @IsString() @MinLength(2) @MaxLength(60) nome: string;
  @IsInt() diarias: number;
  @IsInt() precoCentavos: number;
  @IsInt() validadeDias: number;
  @IsBoolean() ativo: boolean;
}

class ParametrosDto {
  @IsString() @MaxLength(77) pixChave: string;
  @IsString() @MaxLength(60) pixNome: string;
  @IsString() @MaxLength(40) pixCidade: string;
  @IsInt() diariasBonusCadastro: number;
  @IsInt() validadeBonusDias: number;
}

class FiltroEntregadoresDto {
  @IsOptional() @IsIn(SITUACOES_ENTREGADOR) situacao?: SituacaoEntregador;
  @IsOptional() @IsString() @MaxLength(80) busca?: string;
}

class FiltroPedidosDto {
  @IsOptional() @IsIn(['AGUARDANDO', 'CONFIRMADO', 'RECUSADO', 'CANCELADO', 'TODOS']) situacao?: SituacaoPedidoCredito | 'TODOS';
}

/** Aprovação e acompanhamento dos entregadores (super-admin). */
@Injectable()
export class EntregadoresAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly creditos: CreditosService,
  ) {}

  async listar(filtro: FiltroEntregadoresDto): Promise<EntregadorResumo[]> {
    const busca = filtro.busca?.trim();
    const digitos = busca?.replace(/\D/g, '');
    const agora = new Date();
    const lista = await this.prisma.entregador.findMany({
      where: {
        ...(filtro.situacao ? { situacao: filtro.situacao } : {}),
        ...(busca
          ? { OR: [{ nome: { contains: busca, mode: 'insensitive' } }, { email: { contains: busca.toLowerCase() } }, ...(digitos ? [{ cpf: { contains: digitos } }, { celular: { contains: digitos } }] : [])] }
          : {}),
      },
      orderBy: [{ criadoEm: 'desc' }],
      take: 300,
      include: {
        documentos: { select: { tipo: true } },
        lotes: { where: { restante: { gt: 0 }, venceEm: { gt: agora } }, select: { restante: true, venceEm: true } },
      },
    });
    return lista.map((e) => {
      const enviados = e.documentos.map((d) => d.tipo);
      return {
        id: e.id,
        nome: e.nome,
        cpf: formatarCpf(e.cpf),
        celular: e.celular,
        email: e.email,
        veiculo: e.veiculo as TipoVeiculo,
        placa: e.placa,
        chavePix: e.chavePix,
        situacao: e.situacao as SituacaoEntregador,
        motivo: e.motivo,
        documentos: enviados as TipoDocumentoEntregador[],
        documentosFaltando: documentosFaltando(e.veiculo as TipoVeiculo, enviados),
        online: e.online,
        posicaoEm: e.posicaoEm?.toISOString() ?? null,
        saldoDiarias: saldoDeDiarias(e.lotes.map((l) => ({ restante: l.restante, venceEm: l.venceEm.toISOString() })), agora),
        criadoEm: e.criadoEm.toISOString(),
      };
    });
  }

  async documento(id: string, tipo: string): Promise<{ dados: string }> {
    if (!TIPOS_DOCUMENTO_ENTREGADOR.includes(tipo as TipoDocumentoEntregador)) throw new NotFoundException('Documento desconhecido.');
    const d = await this.prisma.documentoEntregador.findUnique({ where: { entregadorId_tipo: { entregadorId: id, tipo } } });
    if (!d) throw new NotFoundException('Documento não enviado.');
    return { dados: dataUrl(d.mime, d.bytes) };
  }

  async aprovar(id: string, autorId: string): Promise<void> {
    const e = await this.prisma.entregador.findUnique({ where: { id }, include: { documentos: { select: { tipo: true } } } });
    if (!e) throw new NotFoundException('Entregador não encontrado.');
    if (e.situacao !== 'PENDENTE' && e.situacao !== 'RECUSADO') throw new ConflictException('Só cadastro pendente ou recusado é aprovado.');
    if (documentosFaltando(e.veiculo as TipoVeiculo, e.documentos.map((d) => d.tipo)).length) throw new BadRequestException('Faltam documentos.');
    const parametros = await this.creditos.parametros();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.entregador.updateMany({ where: { id, situacao: e.situacao }, data: { situacao: 'APROVADO', motivo: null, decididoEm: new Date() } });
      if (!count) throw new ConflictException('O cadastro mudou enquanto você olhava. Recarregue.');
      // Diárias grátis só na primeira aprovação.
      const jaGanhou = await tx.loteCredito.count({ where: { entregadorId: id, origem: 'BONUS', motivo: 'Diárias grátis do cadastro' } });
      if (parametros.diariasBonusCadastro > 0 && !jaGanhou) {
        await this.creditos.bonus(id, parametros.diariasBonusCadastro, parametros.validadeBonusDias, 'Diárias grátis do cadastro', autorId, tx);
      }
      await this.auditoria.registrar({ empresaId: null, usuarioId: autorId, acao: 'entregador.aprovar', entidade: 'Entregador', entidadeId: id }, tx);
    });
  }

  async recusar(id: string, motivo: string, autorId: string): Promise<void> {
    await this.mudar(id, ['PENDENTE'], 'RECUSADO', motivo, autorId, 'entregador.recusar');
  }

  async suspender(id: string, motivo: string, autorId: string): Promise<void> {
    await this.mudar(id, ['APROVADO'], 'SUSPENSO', motivo, autorId, 'entregador.suspender');
  }

  async reativar(id: string, autorId: string): Promise<void> {
    await this.mudar(id, ['SUSPENSO'], 'APROVADO', null, autorId, 'entregador.reativar');
  }

  private async mudar(id: string, de: SituacaoEntregador[], para: SituacaoEntregador, motivo: string | null, autorId: string, acao: string) {
    const texto = motivo?.trim() ?? null;
    const { count } = await this.prisma.entregador.updateMany({
      where: { id, situacao: { in: de } },
      data: { situacao: para, motivo: texto, decididoEm: new Date(), ...(para === 'APROVADO' ? {} : { online: false, onlineDesde: null }) },
    });
    if (!count) throw new ConflictException('A situação do cadastro não permite isso. Recarregue.');
    await this.auditoria.registrar({ empresaId: null, usuarioId: autorId, acao, entidade: 'Entregador', entidadeId: id, detalhes: texto ? { motivo: texto } : undefined });
  }
}

@ApenasSuperAdmin()
@Controller('entregadores')
export class EntregadoresAdminController {
  constructor(
    private readonly admin: EntregadoresAdminService,
    private readonly creditos: CreditosService,
  ) {}

  // Rotas fixas antes de ':id'.

  @Get('parametros')
  parametros(): Promise<ParametrosEntregasPlataforma> {
    return this.creditos.parametros();
  }

  @Put('parametros')
  salvarParametros(@Body() dto: ParametrosDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<ParametrosEntregasPlataforma> {
    return this.creditos.salvarParametros(dto, u.id);
  }

  @Get('pacotes')
  pacotes(): Promise<PacoteCredito[]> {
    return this.creditos.pacotes(false);
  }

  @Post('pacotes')
  criarPacote(@Body() dto: PacoteDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<PacoteCredito> {
    return this.creditos.salvarPacote(null, dto, u.id);
  }

  @Put('pacotes/:id')
  editarPacote(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PacoteDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<PacoteCredito> {
    return this.creditos.salvarPacote(id, dto, u.id);
  }

  @Delete('pacotes/:id')
  @HttpCode(204)
  excluirPacote(@Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao): Promise<void> {
    return this.creditos.excluirPacote(id, u.id);
  }

  @Get('creditos')
  pedidos(@Query() f: FiltroPedidosDto): Promise<PedidoCreditoAdmin[]> {
    return this.creditos.listarPedidos(f.situacao === 'TODOS' ? null : (f.situacao ?? 'AGUARDANDO'));
  }

  @Get('creditos/:id/comprovante')
  comprovante(@Param('id', ParseUUIDPipe) id: string): Promise<{ dados: string }> {
    return this.creditos.comprovante(id);
  }

  @Post('creditos/:id/confirmar')
  @HttpCode(204)
  confirmar(@Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao): Promise<void> {
    return this.creditos.confirmar(id, u.id);
  }

  @Post('creditos/:id/recusar')
  @HttpCode(204)
  recusarPedido(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MotivoDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<void> {
    return this.creditos.recusar(id, dto.motivo, u.id);
  }

  @Get()
  listar(@Query() f: FiltroEntregadoresDto): Promise<EntregadorResumo[]> {
    return this.admin.listar(f);
  }

  @Get(':id/documentos/:tipo')
  documento(@Param('id', ParseUUIDPipe) id: string, @Param('tipo') tipo: string): Promise<{ dados: string }> {
    return this.admin.documento(id, tipo);
  }

  @Post(':id/aprovar')
  @HttpCode(204)
  aprovar(@Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao): Promise<void> {
    return this.admin.aprovar(id, u.id);
  }

  @Post(':id/recusar')
  @HttpCode(204)
  recusar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MotivoDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<void> {
    return this.admin.recusar(id, dto.motivo, u.id);
  }

  @Post(':id/suspender')
  @HttpCode(204)
  suspender(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MotivoDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<void> {
    return this.admin.suspender(id, dto.motivo, u.id);
  }

  @Post(':id/reativar')
  @HttpCode(204)
  reativar(@Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao): Promise<void> {
    return this.admin.reativar(id, u.id);
  }

  @Post(':id/bonus')
  @HttpCode(204)
  bonus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BonusDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<void> {
    return this.creditos.bonus(id, dto.diarias, dto.validadeDias, dto.motivo, u.id);
  }
}
