import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import type { BannerPublicitario, BannerVigente } from '@etiquetas/shared';
import { ApenasSuperAdmin, PermitidoNoApp, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { hojeNoFuso } from '../cobranca/mensagens-cobranca.service';
import { PrismaService } from '../prisma/prisma.service';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const MENSAGEM_DATA = 'Informe a data no formato AAAA-MM-DD.';
/** 1 MB de arquivo vira cerca de 1,4 MB em base64. */
const MAX_IMAGEM = 1_400_000;
/** SVG fica de fora: pode carregar script. */
const IMAGEM = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
/** Só http(s): "javascript:" num link executaria código na sessão de quem clica. */
const LINK = /^https?:\/\/\S+$/i;

class CriarBannerDto {
  @IsString()
  @MinLength(2, { message: 'Informe o anunciante.' })
  @MaxLength(120)
  anunciante: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  contato?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  texto?: string;

  @IsOptional()
  @IsString()
  imagem?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  link?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  valorMensal?: number;

  @Matches(DATA, { message: MENSAGEM_DATA })
  inicio: string;

  @IsOptional()
  @Matches(DATA, { message: MENSAGEM_DATA })
  fim?: string | null;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

class AtualizarBannerDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Informe o anunciante.' })
  @MaxLength(120)
  anunciante?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  contato?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  texto?: string;

  @IsOptional()
  @IsString()
  imagem?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  link?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  valorMensal?: number;

  @IsOptional()
  @Matches(DATA, { message: MENSAGEM_DATA })
  inicio?: string;

  @IsOptional()
  @Matches(DATA, { message: MENSAGEM_DATA })
  fim?: string | null;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

type Registro = { id: string; anunciante: string; contato: string; texto: string; imagem: string | null; link: string | null; valorMensal: { toString(): string }; inicio: Date; fim: Date | null; ativo: boolean; exibicoes: number; cliques: number };

function resumo(b: Registro): BannerPublicitario {
  return { ...b, valorMensal: Number(b.valorMensal), inicio: iso(b.inicio), fim: b.fim && iso(b.fim) };
}

function validar(b: { texto: string; imagem: string | null; link: string | null; inicio: string; fim: string | null }) {
  if (!b.texto && !b.imagem) throw new BadRequestException('Informe a imagem ou o texto do banner.');
  if (b.imagem && (b.imagem.length > MAX_IMAGEM || !IMAGEM.test(b.imagem))) throw new BadRequestException('A imagem precisa ser PNG, JPEG, WebP ou GIF de até 1 MB.');
  if (b.link && !LINK.test(b.link)) throw new BadRequestException('O link precisa começar com http:// ou https://.');
  if (b.fim && b.fim < b.inicio) throw new BadRequestException('O fim não pode ser antes do início.');
}

/** Espaço de propaganda vendido nas telas. Dado da plataforma (sem `empresa_id`): só o super-admin altera. */
@Injectable()
export class BannersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async vigentes(): Promise<BannerVigente[]> {
    const hoje = dia(hojeNoFuso());
    return this.prisma.bannerPublicitario.findMany({
      where: { ativo: true, inicio: { lte: hoje }, OR: [{ fim: null }, { fim: { gte: hoje } }] },
      orderBy: { criadoEm: 'asc' },
      select: { id: true, anunciante: true, texto: true, imagem: true, link: true },
    });
  }

  async listar(): Promise<BannerPublicitario[]> {
    const lista = await this.prisma.bannerPublicitario.findMany({ orderBy: { criadoEm: 'desc' } });
    return lista.map(resumo);
  }

  async criar(dto: CriarBannerDto, autorId: string): Promise<BannerPublicitario> {
    const dados = { anunciante: dto.anunciante.trim(), contato: dto.contato?.trim() ?? '', texto: dto.texto?.trim() ?? '', imagem: dto.imagem || null, link: dto.link?.trim() || null, inicio: dto.inicio, fim: dto.fim || null };
    validar(dados);
    const b = await this.prisma.bannerPublicitario.create({
      data: { ...dados, valorMensal: dto.valorMensal ?? 0, ativo: dto.ativo ?? true, inicio: dia(dados.inicio), fim: dados.fim ? dia(dados.fim) : null },
    });
    await this.auditoria.registrar({ empresaId: null, usuarioId: autorId, acao: 'banner.criar', entidade: 'BannerPublicitario', entidadeId: b.id, detalhes: { anunciante: b.anunciante, inicio: dados.inicio, fim: dados.fim } });
    return resumo(b);
  }

  async atualizar(id: string, dto: AtualizarBannerDto, autorId: string): Promise<BannerPublicitario> {
    const atual = await this.prisma.bannerPublicitario.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException('Banner não encontrado.');
    const dados = {
      anunciante: dto.anunciante?.trim() ?? atual.anunciante,
      contato: dto.contato?.trim() ?? atual.contato,
      texto: dto.texto?.trim() ?? atual.texto,
      imagem: dto.imagem === undefined ? atual.imagem : dto.imagem || null,
      link: dto.link === undefined ? atual.link : dto.link?.trim() || null,
      inicio: dto.inicio ?? iso(atual.inicio),
      fim: dto.fim === undefined ? atual.fim && iso(atual.fim) : dto.fim || null,
    };
    validar(dados);
    const b = await this.prisma.bannerPublicitario.update({
      where: { id },
      data: { ...dados, valorMensal: dto.valorMensal, ativo: dto.ativo, inicio: dia(dados.inicio), fim: dados.fim ? dia(dados.fim) : null },
    });
    // A imagem não vai para a auditoria: pesa até 1 MB.
    const { imagem: _imagem, ...detalhes } = dto;
    await this.auditoria.registrar({ empresaId: null, usuarioId: autorId, acao: 'banner.editar', entidade: 'BannerPublicitario', entidadeId: id, detalhes: { ...detalhes } });
    return resumo(b);
  }

  async excluir(id: string, autorId: string) {
    const atual = await this.prisma.bannerPublicitario.findUnique({ where: { id }, select: { anunciante: true, exibicoes: true, cliques: true } });
    if (!atual) throw new NotFoundException('Banner não encontrado.');
    await this.prisma.bannerPublicitario.delete({ where: { id } });
    await this.auditoria.registrar({ empresaId: null, usuarioId: autorId, acao: 'banner.excluir', entidade: 'BannerPublicitario', entidadeId: id, detalhes: { ...atual } });
  }

  async contar(id: string, campo: 'exibicoes' | 'cliques') {
    await this.prisma.bannerPublicitario.updateMany({ where: { id, ativo: true }, data: { [campo]: { increment: 1 } } });
  }
}

@Controller('banners')
export class BannersController {
  constructor(private readonly banners: BannersService) {}

  /** Qualquer usuário logado: o espaço aparece para todos, no site e no aplicativo. */
  @Get('vigentes')
  @PermitidoNoApp()
  vigentes() {
    return this.banners.vigentes();
  }

  @Get()
  @ApenasSuperAdmin()
  listar() {
    return this.banners.listar();
  }

  @Post()
  @ApenasSuperAdmin()
  criar(@Body() dto: CriarBannerDto, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.banners.criar(dto, autor.id);
  }

  @Patch(':id')
  @ApenasSuperAdmin()
  atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarBannerDto, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.banners.atualizar(id, dto, autor.id);
  }

  @Delete(':id')
  @ApenasSuperAdmin()
  @HttpCode(204)
  async excluir(@Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() autor: UsuarioRequisicao) {
    await this.banners.excluir(id, autor.id);
  }

  /** O super-admin conferindo o próprio cadastro não infla os números vendidos ao anunciante. */
  @Post(':id/exibicao')
  @PermitidoNoApp()
  @HttpCode(204)
  async exibicao(@Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() usuario: UsuarioRequisicao) {
    if (!usuario.superAdmin) await this.banners.contar(id, 'exibicoes');
  }

  @Post(':id/clique')
  @PermitidoNoApp()
  @HttpCode(204)
  async clique(@Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() usuario: UsuarioRequisicao) {
    if (!usuario.superAdmin) await this.banners.contar(id, 'cliques');
  }
}

@Module({
  controllers: [BannersController],
  providers: [BannersService],
})
export class BannersModule {}
