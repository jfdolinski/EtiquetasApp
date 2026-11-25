import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import * as bwipjs from 'bwip-js';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import {
  csvDoRelatorio,
  diaNoFuso,
  podeConversar,
  primeiroNome,
  problemaNaMensagem,
  resumoDoEndereco,
  resumoDoRelatorio,
  ROTULO_SITUACAO_CHAMADA,
  ROTULO_TIPO_CHAMADA,
  TEXTO_TERMO_CUSTODIA,
  totalDaChamada,
  VERSAO_TERMO_CUSTODIA,
  type LinhaRelatorio,
  type MensagemChamada,
  type ParadaChamada,
  type ResumoRelatorio,
  type SituacaoChamada,
  type TipoChamada,
} from '@etiquetas/shared';
import { EmpresaAtual, Publico, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { ChamadasService } from './chamadas';
import { EntregadorAtual, EntregadorGuard } from './guarda';

const DIA_MS = 86_400_000;
const MAX_DIAS_RELATORIO = 366;
/** Etiqueta de 100 × 70 mm, o tamanho comum das térmicas de etiqueta. */
const ETIQUETA: [number, number] = [283.46, 198.43];
const limpo = (t: string) => t.replace(/[^\x20-\x7E -ÿ]/g, '').trim();

class MensagemDto {
  @IsString() @MaxLength(600) texto: string;
}

class PeriodoDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data inicial inválida.' }) de?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data final inválida.' }) ate?: string;
}

/** Entregas, etapa 12: etiqueta de coleta em PDF, conversa na chamada, relatório e termo de custódia. */
@Injectable()
export class BalcaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly chamadas: ChamadasService,
  ) {}

  // Etiqueta de coleta ----------------------------------------------------------------------

  async etiquetaPdf(empresaId: string, chamadaId: string): Promise<Uint8Array> {
    const e = await this.chamadas.marcarEtiquetaImpressa(empresaId, chamadaId);
    const doc = await PDFDocument.create();
    doc.setTitle(`Etiqueta de coleta ${e.numero}`);
    const pagina = doc.addPage(ETIQUETA);
    const [L, A] = ETIQUETA;
    const normal = await doc.embedFont(StandardFonts.Helvetica);
    const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
    const m = 12;
    pagina.drawText(limpo(e.empresa).slice(0, 40), { x: m, y: A - m - 10, size: 10, font: negrito });
    pagina.drawText(`Chamada ${e.numero}`, { x: L - m - negrito.widthOfTextAtSize(`Chamada ${e.numero}`, 14), y: A - m - 12, size: 14, font: negrito });
    const destino = e.tipo === 'ENTREGA' ? e.destino : e.origem;
    const linha2 = limpo(`${ROTULO_TIPO_CHAMADA[e.tipo]} - ${resumoDoEndereco(destino.endereco) || destino.endereco}`).slice(0, 52);
    pagina.drawText(linha2, { x: m, y: A - m - 26, size: 9, font: normal });
    if (e.paradas) pagina.drawText(`${e.paradas + 1} entregas`, { x: m, y: A - m - 38, size: 9, font: normal });
    if (e.agendadaPara) {
      const quando = new Intl.DateTimeFormat('pt-BR', { timeZone: config().fusoHorario, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(e.agendadaPara);
      pagina.drawText(limpo(`Coleta agendada: ${quando}`), { x: L / 2, y: A - m - 38, size: 9, font: negrito });
    }
    const png = await bwipjs.toBuffer({ bcid: 'code128', text: e.codigo, scale: 3, height: 14, includetext: false });
    const img = await doc.embedPng(png);
    const largura = L - 2 * m;
    const altura = 70;
    pagina.drawImage(img, { x: m, y: 40, width: largura, height: altura });
    pagina.drawText(e.codigo, { x: (L - negrito.widthOfTextAtSize(e.codigo, 13)) / 2, y: 22, size: 13, font: negrito });
    pagina.drawText('Leia no app Flow Entregas: Pegar no balcão ou na coleta.', { x: m, y: 8, size: 7, font: normal, color: rgb(0.35, 0.4, 0.45) });
    return doc.save();
  }

  // Conversa --------------------------------------------------------------------------------

  private async chamadaDaConversa(filtro: { empresaId?: string; entregadorId?: string }, chamadaId: string) {
    const c = await this.prisma.chamadaEntrega.findFirst({ where: { id: chamadaId, ...filtro }, select: { id: true, situacao: true, entregadorId: true, concluidaEm: true, canceladaEm: true } });
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    return c;
  }

  private async mensagens(chamadaId: string): Promise<MensagemChamada[]> {
    const lista = await this.prisma.mensagemChamadaEntrega.findMany({ where: { chamadaId }, orderBy: { criadoEm: 'asc' }, take: 300 });
    return lista.map((m) => ({ id: m.id, autor: m.autor as MensagemChamada['autor'], nome: m.nome, texto: m.texto, em: m.criadoEm.toISOString() }));
  }

  /** Ler marca como lido o lado de quem leu. */
  async conversa(lado: 'empresa' | 'entregador', filtro: { empresaId?: string; entregadorId?: string }, chamadaId: string): Promise<{ mensagens: MensagemChamada[]; podeEscrever: boolean }> {
    const c = await this.chamadaDaConversa(filtro, chamadaId);
    await this.prisma.chamadaEntrega.update({ where: { id: c.id }, data: lado === 'empresa' ? { mensagensLidasEmpresaEm: new Date() } : { mensagensLidasEntregadorEm: new Date() } });
    return { mensagens: await this.mensagens(c.id), podeEscrever: podeConversar({ situacao: c.situacao as SituacaoChamada, temEntregador: !!c.entregadorId, concluidaEm: c.concluidaEm, canceladaEm: c.canceladaEm }, new Date()) };
  }

  async escrever(lado: 'empresa' | 'entregador', filtro: { empresaId?: string; entregadorId?: string }, chamadaId: string, texto: string, autor: { usuarioId: string | null; nome: string }) {
    const problema = problemaNaMensagem(texto);
    if (problema) throw new BadRequestException(problema);
    const c = await this.chamadaDaConversa(filtro, chamadaId);
    if (!podeConversar({ situacao: c.situacao as SituacaoChamada, temEntregador: !!c.entregadorId, concluidaEm: c.concluidaEm, canceladaEm: c.canceladaEm }, new Date()))
      throw new ConflictException('A conversa fica aberta enquanto a chamada tem entregador e até 24 horas depois de terminar.');
    if (autor.usuarioId && !autor.nome) autor = { ...autor, nome: (await this.prisma.usuario.findUnique({ where: { id: autor.usuarioId }, select: { nome: true } }))?.nome ?? '' };
    const agora = new Date();
    await this.prisma.$transaction([
      this.prisma.mensagemChamadaEntrega.create({ data: { chamadaId: c.id, autor: lado, usuarioId: autor.usuarioId, nome: primeiroNome(autor.nome).slice(0, 40) || (lado === 'empresa' ? 'Empresa' : 'Entregador'), texto: texto.trim() } }),
      // Quem escreve leu o que veio antes.
      this.prisma.chamadaEntrega.update({ where: { id: c.id }, data: lado === 'empresa' ? { mensagensLidasEmpresaEm: agora } : { mensagensLidasEntregadorEm: agora } }),
    ]);
    return this.conversa(lado, filtro, chamadaId);
  }

  // Relatório -------------------------------------------------------------------------------

  private periodo(dto: PeriodoDto): { de: Date; ate: Date } {
    const fuso = config().fusoHorario;
    const hoje = diaNoFuso(new Date(), fuso);
    const ate = dto.ate ?? hoje;
    const de = dto.de ?? new Date(new Date(`${ate}T12:00:00Z`).getTime() - 29 * DIA_MS).toISOString().slice(0, 10);
    // Dia inteiro no fuso do sistema: do começo de "de" ao fim de "ate".
    const inicio = new Date(`${de}T00:00:00Z`);
    const fim = new Date(`${ate}T00:00:00Z`);
    const deslocamento = (d: Date) => {
      const local = new Date(d.toLocaleString('en-US', { timeZone: fuso }));
      const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
      return utc.getTime() - local.getTime();
    };
    const de0 = new Date(inicio.getTime() + deslocamento(inicio));
    const ate0 = new Date(fim.getTime() + DIA_MS + deslocamento(fim));
    if (!(de0 < ate0)) throw new BadRequestException('A data inicial precisa ser antes da final.');
    if (ate0.getTime() - de0.getTime() > MAX_DIAS_RELATORIO * DIA_MS) throw new BadRequestException(`O relatório vai até ${MAX_DIAS_RELATORIO} dias.`);
    return { de: de0, ate: ate0 };
  }

  async linhas(empresaId: string, dto: PeriodoDto): Promise<(LinhaRelatorio & { dia: string })[]> {
    const { de, ate } = this.periodo(dto);
    const fuso = config().fusoHorario;
    const lista = await this.prisma.chamadaEntrega.findMany({
      where: { empresaId, criadoEm: { gte: de, lt: ate } },
      orderBy: { criadoEm: 'asc' },
      take: 20_000,
      select: { numero: true, tipo: true, situacao: true, criadoEm: true, aceitaEm: true, concluidaEm: true, destino: true, origem: true, volumes: true, valorCentavos: true, extraCentavos: true, ocorrencia: true, devolucao: true, avaliacaoNota: true, cancelamentoPago: true, entregador: { select: { nome: true } } },
    });
    return lista.map((c) => {
      const destino = (c.tipo === 'ENTREGA' ? c.destino : c.origem) as unknown as ParadaChamada;
      // Cancelada sem taxa não custou nada à empresa.
      const valor = c.situacao === 'CANCELADA' && !c.cancelamentoPago ? 0 : c.situacao === 'CONCLUIDA' || c.cancelamentoPago ? totalDaChamada(c) : 0;
      return {
        numero: c.numero,
        tipo: c.tipo as TipoChamada,
        situacao: c.situacao as SituacaoChamada,
        criadoEm: c.criadoEm.toISOString(),
        aceitaEm: c.aceitaEm?.toISOString() ?? null,
        concluidaEm: c.concluidaEm?.toISOString() ?? null,
        entregador: c.entregador?.nome ?? null,
        destino: destino?.endereco ?? '',
        volumes: c.volumes,
        valorCentavos: valor,
        ocorrencia: !!c.ocorrencia,
        devolvida: !!c.devolucao,
        avaliacao: c.avaliacaoNota,
        dia: diaNoFuso(c.criadoEm, fuso),
      };
    });
  }

  async relatorio(empresaId: string, dto: PeriodoDto): Promise<{ de: string; ate: string; resumo: ResumoRelatorio }> {
    const linhas = await this.linhas(empresaId, dto);
    const fuso = config().fusoHorario;
    const { de, ate } = this.periodo(dto);
    return { de: diaNoFuso(de, fuso), ate: diaNoFuso(new Date(ate.getTime() - 1), fuso), resumo: resumoDoRelatorio(linhas) };
  }

  async csv(empresaId: string, dto: PeriodoDto): Promise<string> {
    const fuso = config().fusoHorario;
    const fmt = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
    return csvDoRelatorio(await this.linhas(empresaId, dto), ROTULO_TIPO_CHAMADA, ROTULO_SITUACAO_CHAMADA, fmt);
  }

  // Termo de custódia -----------------------------------------------------------------------

  async aceitarTermo(entregadorId: string): Promise<{ versao: number; em: string }> {
    const em = new Date();
    await this.prisma.entregador.update({ where: { id: entregadorId }, data: { termoCustodiaVersao: VERSAO_TERMO_CUSTODIA, termoCustodiaEm: em } });
    await this.auditoria.registrar({ empresaId: null, usuarioId: null, acao: 'entregador.termo_custodia', entidade: 'Entregador', entidadeId: entregadorId, detalhes: { versao: VERSAO_TERMO_CUSTODIA } });
    return { versao: VERSAO_TERMO_CUSTODIA, em: em.toISOString() };
  }
}

// Rotas da empresa ---------------------------------------------------------------------------

@Controller('entregas')
export class BalcaoEmpresaController {
  constructor(private readonly servico: BalcaoService) {}

  @Get('chamadas/:id/etiqueta.pdf')
  @RequerPermissao('entrega.gerenciar')
  async etiqueta(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const bytes = await this.servico.etiquetaPdf(empresaId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="etiqueta-coleta.pdf"');
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(bytes));
  }

  @Get('chamadas/:id/mensagens')
  @RequerPermissao('entrega.ver')
  mensagens(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.servico.conversa('empresa', { empresaId }, id);
  }

  @Post('chamadas/:id/mensagens')
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  escrever(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MensagemDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.servico.escrever('empresa', { empresaId }, id, dto.texto, { usuarioId: u.id, nome: '' });
  }

  @Get('relatorio')
  @RequerPermissao('entrega.ver')
  relatorio(@EmpresaAtual() empresaId: string, @Query() dto: PeriodoDto) {
    return this.servico.relatorio(empresaId, dto);
  }

  @Get('relatorio.csv')
  @RequerPermissao('entrega.ver')
  async csv(@EmpresaAtual() empresaId: string, @Query() dto: PeriodoDto, @Res() res: Response) {
    const texto = await this.servico.csv(empresaId, dto);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="entregas.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.end(texto);
  }
}

// Rotas do app do entregador ----------------------------------------------------------------

@Publico()
@UseGuards(EntregadorGuard)
@Controller('entregador')
export class BalcaoEntregadorController {
  constructor(
    private readonly servico: BalcaoService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('termo-custodia')
  termo() {
    return { versao: VERSAO_TERMO_CUSTODIA, texto: TEXTO_TERMO_CUSTODIA };
  }

  @Post('termo-custodia')
  @HttpCode(200)
  aceitar(@EntregadorAtual() e: { id: string }) {
    return this.servico.aceitarTermo(e.id);
  }

  @Get('chamadas/:id/mensagens')
  mensagens(@EntregadorAtual() e: { id: string }, @Param('id', ParseUUIDPipe) id: string) {
    return this.servico.conversa('entregador', { entregadorId: e.id }, id);
  }

  @Post('chamadas/:id/mensagens')
  @HttpCode(200)
  async escrever(@EntregadorAtual() e: { id: string }, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MensagemDto) {
    const { nome } = await this.prisma.entregador.findUniqueOrThrow({ where: { id: e.id }, select: { nome: true } });
    return this.servico.escrever('entregador', { entregadorId: e.id }, id, dto.texto, { usuarioId: null, nome });
  }
}

