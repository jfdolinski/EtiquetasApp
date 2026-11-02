import { randomBytes } from 'node:crypto';
import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Global, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put, UnauthorizedException, forwardRef } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import type { CodigoVinculoResposta, DispositivoResumo, ImprimirResposta, VincularAppResposta } from '@etiquetas/shared';
import { empresaBloqueada } from '../auth/acesso-empresa';
import { AuthService } from '../auth/auth.service';
import { AuthModule } from '../auth/auth.module';
import { hashDoToken } from '../auth/conta.service';
import { EmpresaAtual, PermitidoNoApp, Publico, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ImprimirAvulsaDto } from '../impressao/dto';
import { ImpressaoModule } from '../impressao/impressao.module';
import { ListasService } from '../impressao/listas.service';
import { PrismaService } from '../prisma/prisma.service';
import { FcmService, type AvisoPush } from './fcm.service';

const VALIDADE_CODIGO_MS = 5 * 60_000;
const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TAMANHO_CODIGO = 10;

export function gerarCodigoVinculo(): string {
  return [...randomBytes(TAMANHO_CODIGO)].map((b) => ALFABETO_CODIGO[b % ALFABETO_CODIGO.length]).join('');
}

class VincularDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]{10}$/, { message: 'Código inválido.' })
  codigo: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nome: string;

  @IsIn(['ANDROID', 'IOS'], { message: 'Plataforma desconhecida.' })
  plataforma: 'ANDROID' | 'IOS';

  @IsOptional()
  @IsString()
  @MaxLength(40)
  versao?: string;
}

class TokenPushDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  token?: string | null;
}

class ItemAprovadoDto {
  @IsUUID('all', { message: 'Item inválido.' })
  id: string;

  @IsInt({ message: 'Quantidade inválida.' })
  @Min(1, { message: 'A quantidade deve ser ao menos 1.' })
  quantidade: number;
}

class AprovarDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Selecione ao menos um produto.' })
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ItemAprovadoDto)
  itens: ItemAprovadoDto[];
}

class DescartarDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Selecione ao menos um produto.' })
  @ArrayMaxSize(2000)
  @IsUUID('all', { each: true })
  ids: string[];
}

/** Vínculo do celular com o usuário e envio de avisos para os aparelhos. */
@Injectable()
export class DispositivosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly fcm: FcmService,
  ) {}

  /** Código de uso único do QR. Pedir outro invalida o anterior. */
  async criarCodigo(usuarioId: string, empresaId: string): Promise<CodigoVinculoResposta> {
    const codigo = gerarCodigoVinculo();
    const expiraEm = new Date(Date.now() + VALIDADE_CODIGO_MS);
    await this.prisma.$transaction([
      this.prisma.codigoVinculoApp.updateMany({ where: { usuarioId, usadoEm: null }, data: { usadoEm: new Date() } }),
      this.prisma.codigoVinculoApp.create({ data: { usuarioId, empresaId, codigoHash: hashDoToken(codigo), expiraEm } }),
    ]);
    return { codigo, expiraEm: expiraEm.toISOString() };
  }

  async vincular(dto: VincularDto): Promise<Omit<VincularAppResposta, 'usuario'> & { usuarioId: string }> {
    const invalido = () => new UnauthorizedException('Código inválido ou vencido. Gere outro em Minha conta.');
    const registro = await this.prisma.codigoVinculoApp.findUnique({
      where: { codigoHash: hashDoToken(dto.codigo.toUpperCase()) },
      include: { usuario: { select: { id: true, ativo: true, superAdmin: true, empresaId: true, empresa: { select: { ativa: true, statusAssinatura: true } } } } },
    });
    if (!registro || registro.usadoEm || registro.expiraEm < new Date()) throw invalido();
    if (!registro.usuario.ativo) throw invalido();
    if (!registro.usuario.superAdmin && (!registro.usuario.empresa || empresaBloqueada(registro.usuario.empresa))) throw new ForbiddenException('Empresa bloqueada: fale com o administrador.');

    const token = `app_${randomBytes(32).toString('base64url')}`;
    await this.prisma.$transaction(async (tx) => {
      // updateMany no estado antigo: o mesmo QR não vincula dois celulares.
      const { count } = await tx.codigoVinculoApp.updateMany({ where: { id: registro.id, usadoEm: null }, data: { usadoEm: new Date() } });
      if (count === 0) throw invalido();
      const d = await tx.dispositivoMovel.create({
        data: { usuarioId: registro.usuarioId, empresaId: registro.empresaId, nome: dto.nome.trim(), plataforma: dto.plataforma, versaoApp: dto.versao ?? null, tokenHash: hashDoToken(token) },
      });
      await this.auditoria.registrar({ empresaId: registro.empresaId, usuarioId: registro.usuarioId, acao: 'app.vincular', entidade: 'DispositivoMovel', entidadeId: d.id, detalhes: { nome: d.nome, plataforma: d.plataforma } }, tx);
    });
    return { token, empresaId: registro.empresaId, usuarioId: registro.usuarioId };
  }

  async listar(usuarioId: string, atual?: string): Promise<DispositivoResumo[]> {
    const lista = await this.prisma.dispositivoMovel.findMany({ where: { usuarioId, revogadoEm: null }, orderBy: { criadoEm: 'desc' } });
    return lista.map((d) => ({
      id: d.id,
      nome: d.nome,
      plataforma: d.plataforma as DispositivoResumo['plataforma'],
      versaoApp: d.versaoApp,
      recebeAvisos: d.pushToken !== null,
      criadoEm: d.criadoEm.toISOString(),
      ultimoUsoEm: d.ultimoUsoEm.toISOString(),
      atual: d.id === atual,
    }));
  }

  async desvincular(usuarioId: string, id: string, empresaId: string | null) {
    const { count } = await this.prisma.dispositivoMovel.updateMany({ where: { id, usuarioId, revogadoEm: null }, data: { revogadoEm: new Date(), pushToken: null } });
    if (count === 0) throw new NotFoundException('Aparelho não encontrado.');
    await this.auditoria.registrar({ empresaId, usuarioId, acao: 'app.desvincular', entidade: 'DispositivoMovel', entidadeId: id });
  }

  async definirPush(dispositivoId: string, token: string | null | undefined) {
    // O mesmo aparelho pode ter sido vinculado antes por outra pessoa: o aviso vai só para o vínculo novo.
    if (token) await this.prisma.dispositivoMovel.updateMany({ where: { pushToken: token, id: { not: dispositivoId } }, data: { pushToken: null } });
    await this.prisma.dispositivoMovel.update({ where: { id: dispositivoId }, data: { pushToken: token ?? null } });
  }

  /** Aparelhos da empresa cujo usuário pode ver as notificações. */
  async avisarEmpresa(empresaId: string, aviso: AvisoPush): Promise<number> {
    const aparelhos = await this.prisma.dispositivoMovel.findMany({
      where: {
        empresaId,
        revogadoEm: null,
        pushToken: { not: null },
        usuario: { ativo: true, OR: [{ superAdmin: true }, { perfil: { permissoes: { some: { permissaoCodigo: 'notificacao.ver' } } } }] },
      },
      select: { pushToken: true },
    });
    const { enviados, invalidos } = await this.fcm.enviar(aparelhos.map((a) => a.pushToken!), aviso);
    if (invalidos.length) await this.prisma.dispositivoMovel.updateMany({ where: { pushToken: { in: invalidos } }, data: { pushToken: null } });
    return enviados;
  }
}

/** Serviço de avisos disponível para as notificações sem criar dependência circular com a impressão. */
@Global()
@Module({ providers: [FcmService, DispositivosService], exports: [DispositivosService, FcmService] })
export class DispositivosModule {}

@Controller('app')
export class AppMovelController {
  constructor(
    private readonly dispositivos: DispositivosService,
    private readonly auth: AuthService,
    private readonly listas: ListasService,
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Só do navegador logado (sem @PermitidoNoApp): um celular não vincula outro. */
  @Post('vinculos')
  @HttpCode(200)
  criarVinculo(@UsuarioAtual() usuario: UsuarioRequisicao, @EmpresaAtual() empresaId: string) {
    return this.dispositivos.criarCodigo(usuario.id, empresaId);
  }

  @Post('vincular')
  @Publico()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async vincular(@Body() dto: VincularDto): Promise<VincularAppResposta> {
    const { usuarioId, ...r } = await this.dispositivos.vincular(dto);
    return { ...r, usuario: await this.auth.usuarioLogado(usuarioId) };
  }

  @Get('dispositivos')
  @PermitidoNoApp()
  listar(@UsuarioAtual() usuario: UsuarioRequisicao) {
    return this.dispositivos.listar(usuario.id, usuario.dispositivoId);
  }

  @Delete('dispositivos/:id')
  @PermitidoNoApp()
  @HttpCode(204)
  async desvincular(@UsuarioAtual() usuario: UsuarioRequisicao, @Param('id', ParseUUIDPipe) id: string) {
    await this.dispositivos.desvincular(usuario.id, id, usuario.empresaId);
  }

  @Put('push')
  @PermitidoNoApp()
  @HttpCode(204)
  async push(@UsuarioAtual() usuario: UsuarioRequisicao, @Body() dto: TokenPushDto) {
    if (!usuario.dispositivoId) throw new BadRequestException('Só o aplicativo informa o token de aviso.');
    await this.dispositivos.definirPush(usuario.dispositivoId, dto.token);
  }

  /**
   * Aprovar = mandar imprimir agora, na impressora do modelo. PDF fica de fora: geraria o arquivo
   * e marcaria como impresso sem ninguém ter impresso.
   */
  @Post('lista/aprovar')
  @PermitidoNoApp()
  @HttpCode(200)
  @RequerPermissao('imprimir', 'app.aprovar')
  async aprovar(@EmpresaAtual() empresaId: string, @Body() dto: AprovarDto, @UsuarioAtual() usuario: UsuarioRequisicao): Promise<ImprimirResposta> {
    const lista = await this.listas.deHoje(empresaId);
    if (!lista) throw new BadRequestException('A lista de hoje ainda não foi gerada.');
    const ids = dto.itens.map((i) => i.id);
    const emPdf = await this.prisma.itemLista.findMany({ where: { id: { in: ids }, empresaId, impressora: { linguagem: 'PDF' } }, select: { id: true } });
    const foraIds = new Set(emPdf.map((i) => i.id));
    const itens = dto.itens.filter((i) => !foraIds.has(i.id));
    const avisos = foraIds.size ? [`${foraIds.size} produto(s) saem em PDF: imprima pelo computador.`] : [];
    if (itens.length === 0) return { trabalhos: [], avisos };
    const r = await this.listas.imprimirLista(empresaId, lista.id, { itens }, usuario.id);
    await this.auditoria.registrar({ empresaId, usuarioId: usuario.id, acao: 'app.aprovar', entidade: 'ListaDiaria', entidadeId: lista.id, detalhes: { itens: itens.length, dispositivoId: usuario.dispositivoId ?? null } });
    return { trabalhos: r.trabalhos, avisos: [...avisos, ...r.avisos] };
  }

  /**
   * Avulsa pelo celular: sempre na impressora padrão do modelo. PDF fica de fora, como na lista:
   * o arquivo seria gerado e o trabalho ficaria concluído sem ninguém ter impresso.
   */
  @Post('avulsa/imprimir')
  @PermitidoNoApp()
  @HttpCode(200)
  @RequerPermissao('imprimir')
  async imprimirAvulsa(@EmpresaAtual() empresaId: string, @Body() dto: ImprimirAvulsaDto, @UsuarioAtual() usuario: UsuarioRequisicao): Promise<ImprimirResposta> {
    const modelo = await this.prisma.modeloEtiqueta.findFirst({ where: { id: dto.modeloId, empresaId }, select: { impressora: { select: { linguagem: true } } } });
    if (!modelo) throw new NotFoundException('Modelo não encontrado.');
    if (!modelo.impressora) throw new BadRequestException('Este modelo não tem impressora padrão. Defina no sistema, em Modelos de etiqueta.');
    if (modelo.impressora.linguagem === 'PDF') throw new BadRequestException('Este modelo sai em PDF: imprima pelo computador.');
    const r = await this.listas.imprimirAvulsa(empresaId, { ...dto, impressoraId: undefined }, usuario.id);
    await this.auditoria.registrar({ empresaId, usuarioId: usuario.id, acao: 'app.imprimir_avulsa', entidade: 'ModeloEtiqueta', entidadeId: dto.modeloId, detalhes: { itens: dto.itens.length, dispositivoId: usuario.dispositivoId ?? null } });
    return r;
  }

  @Post('lista/descartar')
  @PermitidoNoApp()
  @HttpCode(200)
  @RequerPermissao('imprimir', 'app.aprovar')
  descartar(@EmpresaAtual() empresaId: string, @Body() dto: DescartarDto, @UsuarioAtual() usuario: UsuarioRequisicao) {
    return this.listas.descartarItens(empresaId, dto.ids, usuario.id);
  }
}

@Module({
  imports: [forwardRef(() => AuthModule), ImpressaoModule],
  controllers: [AppMovelController],
})
export class AppMovelModule {}
