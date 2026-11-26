import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  CATEGORIAS_SUPORTE,
  LIMITE_ASSUNTO_SUPORTE,
  LIMITE_TEXTO_SUPORTE,
  MAX_CHAMADOS_ABERTOS,
  primeiroNome,
  problemaNaMensagemDeSuporte,
  problemaNoChamado,
  situacaoDepoisDaMensagem,
  SITUACOES_SUPORTE,
  type CategoriaSuporte,
  type ChamadoSuporteDetalhe,
  type ChamadoSuporteResumo,
  type OrigemSuporte,
  type SituacaoSuporte,
} from '@etiquetas/shared';
import { Prisma } from '@prisma/client';
import { ApenasSuperAdmin, EmpresaAtual, Publico, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { config } from '../config';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { EntregadorAtual, EntregadorGuard } from './guarda';
import { dataUrl, imagemDoDataUrl } from './imagens';

class NovoChamadoDto {
  @IsIn(CATEGORIAS_SUPORTE, { message: 'Escolha o assunto.' }) categoria: CategoriaSuporte;
  @IsString() @MaxLength(LIMITE_ASSUNTO_SUPORTE) assunto: string;
  @IsString() @MaxLength(LIMITE_TEXTO_SUPORTE) texto: string;
  @IsOptional() @IsString() @MaxLength(7_200_000) imagem?: string | null;
}

class MensagemDto {
  @IsString() @MaxLength(LIMITE_TEXTO_SUPORTE) texto: string;
  @IsOptional() @IsString() @MaxLength(7_200_000) imagem?: string | null;
}

class FiltroDto {
  @IsOptional() @IsIn([...SITUACOES_SUPORTE, 'PENDENTES', 'TODOS']) situacao?: SituacaoSuporte | 'PENDENTES' | 'TODOS';
}

/** De quem é o chamado, visto de cada lado. */
type Dono = { empresaId: string } | { entregadorId: string } | { suporte: true };

const INCLUIR = { empresa: { select: { nomeFantasia: true, razaoSocial: true } } } as const;
type ChamadoDoBanco = Prisma.ChamadoSuporteGetPayload<{ include: typeof INCLUIR }>;

/**
 * Suporte da plataforma (Entregas, etapa 14): a empresa (permissão `suporte.abrir`, todos da empresa
 * veem os chamados dela) e o entregador (app) abrem; só o super-admin responde e resolve. Responder
 * reabre um resolvido. Lido por lado (`lido_autor_em`, `lido_suporte_em`).
 */
@Injectable()
export class SuporteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  private onde(d: Dono): Prisma.ChamadoSuporteWhereInput {
    if ('empresaId' in d) return { origem: 'EMPRESA', empresaId: d.empresaId };
    if ('entregadorId' in d) return { origem: 'ENTREGADOR', entregadorId: d.entregadorId };
    return {};
  }

  /** Mensagens do outro lado depois da última leitura deste lado. */
  private async naoLidas(lista: ChamadoDoBanco[], deSuporte: boolean): Promise<Map<string, number>> {
    if (!lista.length) return new Map();
    const msgs = await this.prisma.mensagemSuporte.findMany({ where: { chamadoId: { in: lista.map((c) => c.id) }, deSuporte: !deSuporte }, select: { chamadoId: true, criadoEm: true } });
    const lido = new Map(lista.map((c) => [c.id, (deSuporte ? c.lidoSuporteEm : c.lidoAutorEm)?.getTime() ?? 0]));
    const n = new Map<string, number>();
    for (const m of msgs) if (m.criadoEm.getTime() > (lido.get(m.chamadoId) ?? 0)) n.set(m.chamadoId, (n.get(m.chamadoId) ?? 0) + 1);
    return n;
  }

  private resumo(c: ChamadoDoBanco, naoLidas: Map<string, number>): ChamadoSuporteResumo {
    return {
      id: c.id,
      numero: c.numero,
      origem: c.origem as OrigemSuporte,
      autor: c.autorNome,
      empresa: c.empresa ? c.empresa.nomeFantasia || c.empresa.razaoSocial : null,
      categoria: c.categoria as CategoriaSuporte,
      assunto: c.assunto,
      situacao: c.situacao as SituacaoSuporte,
      criadoEm: c.criadoEm.toISOString(),
      atualizadoEm: c.atualizadoEm.toISOString(),
      naoLidas: naoLidas.get(c.id) ?? 0,
    };
  }

  async listar(d: Dono, situacao: FiltroDto['situacao'] = 'TODOS'): Promise<ChamadoSuporteResumo[]> {
    const filtro: Prisma.ChamadoSuporteWhereInput = situacao === 'PENDENTES' ? { situacao: 'ABERTO' } : situacao && situacao !== 'TODOS' ? { situacao } : {};
    const lista = await this.prisma.chamadoSuporte.findMany({ where: { ...this.onde(d), ...filtro }, orderBy: { atualizadoEm: 'desc' }, take: 200, include: INCLUIR });
    const n = await this.naoLidas(lista, 'suporte' in d);
    return lista.map((c) => this.resumo(c, n));
  }

  async naoLidasTotal(d: Dono): Promise<{ quantidade: number; abertos?: number }> {
    const lista = await this.prisma.chamadoSuporte.findMany({ where: { ...this.onde(d), atualizadoEm: { gte: new Date(Date.now() - 90 * 86_400_000) } }, include: INCLUIR, take: 500 });
    const n = await this.naoLidas(lista, 'suporte' in d);
    const quantidade = [...n.values()].reduce((s, x) => s + x, 0);
    return 'suporte' in d ? { quantidade, abertos: lista.filter((c) => c.situacao === 'ABERTO').length } : { quantidade };
  }

  async obter(d: Dono, id: string): Promise<ChamadoSuporteDetalhe> {
    const c = await this.prisma.chamadoSuporte.findFirst({ where: { id, ...this.onde(d) }, include: { ...INCLUIR, mensagens: { orderBy: { criadoEm: 'asc' }, select: { id: true, deSuporte: true, autorNome: true, texto: true, imagemMime: true, criadoEm: true } }, usuario: { select: { email: true } }, entregador: { select: { email: true, celular: true } } } });
    if (!c) throw new NotFoundException('Chamado não encontrado.');
    const n = await this.naoLidas([c], 'suporte' in d);
    await this.prisma.chamadoSuporte.updateMany({ where: { id }, data: 'suporte' in d ? { lidoSuporteEm: new Date() } : { lidoAutorEm: new Date() } });
    return {
      ...this.resumo(c, n),
      mensagens: c.mensagens.map((m) => ({ id: m.id, deSuporte: m.deSuporte, autor: m.autorNome, texto: m.texto, temImagem: !!m.imagemMime, criadoEm: m.criadoEm.toISOString() })),
      ...('suporte' in d ? { contato: { email: c.usuario?.email ?? c.entregador?.email ?? null, telefone: c.entregador?.celular ?? null } } : {}),
    };
  }

  async imagem(d: Dono, chamadoId: string, mensagemId: string): Promise<{ dados: string }> {
    const m = await this.prisma.mensagemSuporte.findFirst({ where: { id: mensagemId, chamadoId, chamado: this.onde(d) }, select: { imagemMime: true, imagem: true } });
    if (!m?.imagem || !m.imagemMime) throw new NotFoundException('Imagem não encontrada.');
    return { dados: dataUrl(m.imagemMime, m.imagem) };
  }

  async abrir(autor: { origem: OrigemSuporte; empresaId: string | null; usuarioId: string | null; entregadorId: string | null; nome: string }, dto: NovoChamadoDto): Promise<ChamadoSuporteDetalhe> {
    const problema = problemaNoChamado(dto);
    if (problema) throw new BadRequestException(problema);
    const imagem = dto.imagem ? imagemDoDataUrl(dto.imagem, 'A imagem') : null;
    const dono: Dono = autor.origem === 'EMPRESA' ? { empresaId: autor.empresaId! } : { entregadorId: autor.entregadorId! };
    const abertos = await this.prisma.chamadoSuporte.count({ where: { ...this.onde(dono), situacao: { not: 'RESOLVIDO' } } });
    if (abertos >= MAX_CHAMADOS_ABERTOS) throw new ConflictException(`Já há ${MAX_CHAMADOS_ABERTOS} chamados em aberto: continue a conversa num deles.`);
    const c = await this.prisma.chamadoSuporte.create({
      data: {
        origem: autor.origem,
        empresaId: autor.empresaId,
        usuarioId: autor.usuarioId,
        entregadorId: autor.entregadorId,
        autorNome: autor.nome,
        categoria: dto.categoria,
        assunto: dto.assunto.trim(),
        lidoAutorEm: new Date(),
        mensagens: { create: { deSuporte: false, autorNome: autor.nome, texto: dto.texto.trim(), imagemMime: imagem?.mime ?? null, imagem: imagem?.bytes ?? null } },
      },
    });
    return this.obter(dono, c.id);
  }

  async responder(d: Dono, id: string, dto: MensagemDto, nome: string): Promise<ChamadoSuporteDetalhe> {
    const problema = problemaNaMensagemDeSuporte(dto.texto);
    if (problema) throw new BadRequestException(problema);
    const imagem = dto.imagem ? imagemDoDataUrl(dto.imagem, 'A imagem') : null;
    const deSuporte = 'suporte' in d;
    const c = await this.prisma.chamadoSuporte.findFirst({ where: { id, ...this.onde(d) }, include: { usuario: { select: { email: true } }, entregador: { select: { email: true } } } });
    if (!c) throw new NotFoundException('Chamado não encontrado.');
    const agora = new Date();
    await this.prisma.$transaction([
      this.prisma.mensagemSuporte.create({ data: { chamadoId: id, deSuporte, autorNome: nome, texto: dto.texto.trim(), imagemMime: imagem?.mime ?? null, imagem: imagem?.bytes ?? null } }),
      this.prisma.chamadoSuporte.update({ where: { id }, data: { situacao: situacaoDepoisDaMensagem(deSuporte), resolvidoEm: null, ...(deSuporte ? { lidoSuporteEm: agora } : { lidoAutorEm: agora }) } }),
    ]);
    if (deSuporte) void this.avisarAutor(c, `Sua solicitação nº ${c.numero} foi respondida`);
    return this.obter(d, id);
  }

  async resolver(d: Dono, id: string): Promise<ChamadoSuporteDetalhe> {
    const c = await this.prisma.chamadoSuporte.findFirst({ where: { id, ...this.onde(d) }, include: { usuario: { select: { email: true } }, entregador: { select: { email: true } } } });
    if (!c) throw new NotFoundException('Chamado não encontrado.');
    if (c.situacao === 'RESOLVIDO') throw new ConflictException('O chamado já está resolvido.');
    await this.prisma.chamadoSuporte.update({ where: { id }, data: { situacao: 'RESOLVIDO', resolvidoEm: new Date() } });
    if ('suporte' in d) void this.avisarAutor(c, `Sua solicitação nº ${c.numero} foi marcada como resolvida`);
    return this.obter(d, id);
  }

  /** E-mail para quem abriu (sem SMTP, nada sai; quem chama não depende disso). */
  private async avisarAutor(c: { origem: string; numero: number; assunto: string; usuario: { email: string } | null; entregador: { email: string } | null }, titulo: string) {
    const para = c.usuario?.email ?? c.entregador?.email;
    if (!para) return;
    const onde = c.origem === 'ENTREGADOR' ? 'Abra o app Flow Entregas, guia Avisos › Suporte, para ver a resposta.' : config().urlPublica ? `Veja a resposta em ${config().urlPublica}/suporte` : 'Entre no Flow, menu Suporte, para ver a resposta.';
    await this.email.enviar(para, titulo, `${titulo}: "${c.assunto}".\n\n${onde}\n\nFlow`).catch(() => false);
  }
}

// Empresa (site) ---------------------------------------------------------------------------

@Controller('suporte')
export class SuporteEmpresaController {
  constructor(
    private readonly suporte: SuporteService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequerPermissao('suporte.abrir')
  listar(@EmpresaAtual() empresaId: string): Promise<ChamadoSuporteResumo[]> {
    return this.suporte.listar({ empresaId });
  }

  @Get('nao-lidas')
  @RequerPermissao('suporte.abrir')
  naoLidas(@EmpresaAtual() empresaId: string): Promise<{ quantidade: number }> {
    return this.suporte.naoLidasTotal({ empresaId });
  }

  @Post()
  @HttpCode(200)
  @RequerPermissao('suporte.abrir')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async abrir(@EmpresaAtual() empresaId: string, @UsuarioAtual() u: UsuarioRequisicao, @Body() dto: NovoChamadoDto): Promise<ChamadoSuporteDetalhe> {
    const usuario = await this.prisma.usuario.findUniqueOrThrow({ where: { id: u.id }, select: { nome: true } });
    return this.suporte.abrir({ origem: 'EMPRESA', empresaId, usuarioId: u.id, entregadorId: null, nome: usuario.nome }, dto);
  }

  @Get(':id')
  @RequerPermissao('suporte.abrir')
  obter(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string): Promise<ChamadoSuporteDetalhe> {
    return this.suporte.obter({ empresaId }, id);
  }

  @Get(':id/imagens/:mensagem')
  @RequerPermissao('suporte.abrir')
  imagem(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Param('mensagem', ParseUUIDPipe) m: string): Promise<{ dados: string }> {
    return this.suporte.imagem({ empresaId }, id, m);
  }

  @Post(':id/mensagens')
  @HttpCode(200)
  @RequerPermissao('suporte.abrir')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  async responder(@EmpresaAtual() empresaId: string, @UsuarioAtual() u: UsuarioRequisicao, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MensagemDto): Promise<ChamadoSuporteDetalhe> {
    const usuario = await this.prisma.usuario.findUniqueOrThrow({ where: { id: u.id }, select: { nome: true } });
    return this.suporte.responder({ empresaId }, id, dto, usuario.nome);
  }

  @Post(':id/resolver')
  @HttpCode(200)
  @RequerPermissao('suporte.abrir')
  resolver(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string): Promise<ChamadoSuporteDetalhe> {
    return this.suporte.resolver({ empresaId }, id);
  }
}

// Entregador (app) -------------------------------------------------------------------------

@Publico()
@UseGuards(EntregadorGuard)
@Controller('entregador/suporte')
export class SuporteEntregadorController {
  constructor(
    private readonly suporte: SuporteService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  listar(@EntregadorAtual() e: { id: string }): Promise<ChamadoSuporteResumo[]> {
    return this.suporte.listar({ entregadorId: e.id });
  }

  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async abrir(@EntregadorAtual() e: { id: string }, @Body() dto: NovoChamadoDto): Promise<ChamadoSuporteDetalhe> {
    const ent = await this.prisma.entregador.findUniqueOrThrow({ where: { id: e.id }, select: { nome: true } });
    return this.suporte.abrir({ origem: 'ENTREGADOR', empresaId: null, usuarioId: null, entregadorId: e.id, nome: ent.nome }, dto);
  }

  @Get(':id')
  obter(@EntregadorAtual() e: { id: string }, @Param('id', ParseUUIDPipe) id: string): Promise<ChamadoSuporteDetalhe> {
    return this.suporte.obter({ entregadorId: e.id }, id);
  }

  @Get(':id/imagens/:mensagem')
  imagem(@EntregadorAtual() e: { id: string }, @Param('id', ParseUUIDPipe) id: string, @Param('mensagem', ParseUUIDPipe) m: string): Promise<{ dados: string }> {
    return this.suporte.imagem({ entregadorId: e.id }, id, m);
  }

  @Post(':id/mensagens')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  async responder(@EntregadorAtual() e: { id: string }, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MensagemDto): Promise<ChamadoSuporteDetalhe> {
    const ent = await this.prisma.entregador.findUniqueOrThrow({ where: { id: e.id }, select: { nome: true } });
    return this.suporte.responder({ entregadorId: e.id }, id, dto, ent.nome);
  }

  @Post(':id/resolver')
  @HttpCode(200)
  resolver(@EntregadorAtual() e: { id: string }, @Param('id', ParseUUIDPipe) id: string): Promise<ChamadoSuporteDetalhe> {
    return this.suporte.resolver({ entregadorId: e.id }, id);
  }
}

// Super-admin ------------------------------------------------------------------------------

@ApenasSuperAdmin()
@Controller('plataforma/suporte')
export class SuporteAdminController {
  constructor(
    private readonly suporte: SuporteService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  listar(@Query() f: FiltroDto): Promise<ChamadoSuporteResumo[]> {
    return this.suporte.listar({ suporte: true }, f.situacao ?? 'TODOS');
  }

  @Get('nao-lidas')
  naoLidas(): Promise<{ quantidade: number; abertos?: number }> {
    return this.suporte.naoLidasTotal({ suporte: true });
  }

  @Get(':id')
  obter(@Param('id', ParseUUIDPipe) id: string): Promise<ChamadoSuporteDetalhe> {
    return this.suporte.obter({ suporte: true }, id);
  }

  @Get(':id/imagens/:mensagem')
  imagem(@Param('id', ParseUUIDPipe) id: string, @Param('mensagem', ParseUUIDPipe) m: string): Promise<{ dados: string }> {
    return this.suporte.imagem({ suporte: true }, id, m);
  }

  @Post(':id/mensagens')
  @HttpCode(200)
  async responder(@UsuarioAtual() u: UsuarioRequisicao, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MensagemDto): Promise<ChamadoSuporteDetalhe> {
    const usuario = await this.prisma.usuario.findUniqueOrThrow({ where: { id: u.id }, select: { nome: true } });
    // O entregador e a empresa veem "Suporte Flow (Fulano)": o primeiro nome de quem respondeu.
    return this.suporte.responder({ suporte: true }, id, dto, `Suporte Flow (${primeiroNome(usuario.nome)})`);
  }

  @Post(':id/resolver')
  @HttpCode(200)
  resolver(@Param('id', ParseUUIDPipe) id: string): Promise<ChamadoSuporteDetalhe> {
    return this.suporte.resolver({ suporte: true }, id);
  }
}

