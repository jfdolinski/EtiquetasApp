import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsBoolean, IsInt, IsOptional, IsUUID } from 'class-validator';
import {
  CONFIG_PEDIDOS_ERP_PADRAO,
  DIAS_PEDIDOS_ERP,
  LIMITE_LINHAS_PEDIDOS_ERP,
  linhasParaRegistros,
  mapaDeColunas,
  MAX_CHAMADAS_POR_LEITURA,
  pedidosDasLinhas,
  problemaNaConfigPedidosErp,
  problemaNasColunasErp,
  type CampoDinamico,
  type ConfigPedidosErp,
  type MapaColunasErp,
  type PainelPedidosErp,
  type ParadaChamada,
  type PedidoErp,
  type PedidoErpResumo,
  type RascunhoPedidoErp,
  type SituacaoChamada,
  type SituacaoPedidoErp,
} from '@etiquetas/shared';
import { empresaBloqueada } from '../auth/acesso-empresa';
import { EmpresaAtual, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ConsultasService } from '../consultas/consultas.service';
import { pedeParametros } from '../impressao/agendamentos.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChamadasService } from './chamadas';
import { EntregasEmpresaService } from './empresa';
import { MapasService } from './mapas';

const INTERVALO_RELOGIO_MS = 15_000;
const DIA_MS = 86_400_000;
/** Empresa bloqueada: tenta de novo daqui a uma hora, sem ler o ERP. */
const ESPERA_BLOQUEADA_MS = 3_600_000;

class ConfigPedidosErpDto {
  @IsOptional() @IsUUID('all', { message: 'Consulta inválida.' }) consultaId: string | null;
  @IsBoolean() ativo: boolean;
  @IsInt() intervaloMinutos: number;
  @IsBoolean() chamarAutomatico: boolean;
  @IsBoolean() importarExistentes: boolean;
}

export interface ConsultaParaPedidosErp {
  id: string;
  nome: string;
  colunas: string[];
  pedeParametro: boolean;
}

/**
 * Entregas, etapa 10: pedidos do ERP. Uma consulta da empresa traz os pedidos a entregar; o relógio
 * roda a consulta no intervalo escolhido (em nome de quem salvou, como os catálogos dos Pedidos) e
 * cada número novo vira uma linha em `pedidos_erp_entrega`, única por empresa e número: o mesmo
 * pedido nunca gera duas chamadas, mesmo que a consulta continue trazendo ele por dias.
 */
@Injectable()
export class PedidosErpService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('PedidosErp');
  private relogio?: NodeJS.Timeout;
  private verificando = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly consultas: ConsultasService,
    private readonly chamadas: ChamadasService,
    private readonly empresas: EntregasEmpresaService,
    private readonly mapas: MapasService,
  ) {}

  onApplicationBootstrap() {
    this.relogio = setInterval(() => void this.verificar(), INTERVALO_RELOGIO_MS);
    this.relogio.unref();
  }

  onModuleDestroy() {
    clearInterval(this.relogio);
  }

  // Configuração -----------------------------------------------------------------------------

  async consultasDisponiveis(empresaId: string): Promise<ConsultaParaPedidosErp[]> {
    const lista = await this.prisma.consultaSql.findMany({ where: { empresaId, ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true, sql: true, campos: true, conexao: { select: { tipo: true } } } });
    return lista.map((c) => ({ id: c.id, nome: c.nome, colunas: ((c.campos ?? []) as unknown as CampoDinamico[]).map((x) => x.nome), pedeParametro: pedeParametros(c as never) }));
  }

  async painel(empresaId: string): Promise<PainelPedidosErp> {
    const [c, linhas] = await Promise.all([
      this.prisma.configuracaoPedidosErp.findUnique({ where: { empresaId }, include: { consulta: { select: { nome: true } }, responsavel: { select: { nome: true } } } }),
      this.prisma.pedidoErpEntrega.findMany({ where: { empresaId }, orderBy: { criadoEm: 'desc' }, take: 200 }),
    ]);
    const ids = linhas.flatMap((l) => (l.chamadaId ? [l.chamadaId] : []));
    const chamadas = ids.length ? await this.prisma.chamadaEntrega.findMany({ where: { id: { in: ids }, empresaId }, select: { id: true, numero: true, situacao: true } }) : [];
    const porId = new Map(chamadas.map((x) => [x.id, x]));
    const config: ConfigPedidosErp = c ? { consultaId: c.consultaId, ativo: c.ativo, intervaloMinutos: c.intervaloMinutos, chamarAutomatico: c.chamarAutomatico, importarExistentes: c.importarExistentes } : { ...CONFIG_PEDIDOS_ERP_PADRAO };
    return {
      config,
      consultaNome: c?.consulta?.nome ?? null,
      responsavelNome: c?.responsavel?.nome ?? null,
      colunas: (c?.colunas as unknown as MapaColunasErp | null) ?? null,
      lidoEm: c?.lidoEm?.toISOString() ?? null,
      proximaLeituraEm: c?.ativo ? (c.proximaLeituraEm?.toISOString() ?? null) : null,
      erro: c?.erro ?? null,
      pedidos: linhas.map((l): PedidoErpResumo => {
        const d = l.dados as unknown as PedidoErp;
        const ch = l.chamadaId ? porId.get(l.chamadaId) : undefined;
        return {
          id: l.id,
          codigo: l.codigo,
          tipo: d.tipo,
          cliente: d.cliente,
          telefone: d.telefone,
          endereco: d.endereco,
          ponto: d.ponto,
          observacao: d.observacao,
          serie: d.serie,
          situacao: l.situacao as SituacaoPedidoErp,
          mensagem: l.mensagem,
          chamada: ch ? { id: ch.id, numero: ch.numero, situacao: ch.situacao as SituacaoChamada } : null,
          criadoEm: l.criadoEm.toISOString(),
        };
      }),
    };
  }

  async salvar(empresaId: string, dto: ConfigPedidosErpDto, usuarioId: string): Promise<PainelPedidosErp> {
    const cfg: ConfigPedidosErp = { consultaId: dto.consultaId ?? null, ativo: dto.ativo, intervaloMinutos: dto.intervaloMinutos, chamarAutomatico: dto.chamarAutomatico, importarExistentes: dto.importarExistentes };
    const problema = problemaNaConfigPedidosErp(cfg);
    if (problema) throw new BadRequestException(problema);
    if (cfg.consultaId) {
      const consulta = await this.prisma.consultaSql.findFirst({ where: { id: cfg.consultaId, empresaId, ativo: true }, select: { id: true, sql: true, campos: true, conexao: { select: { tipo: true } } } });
      if (!consulta) throw new BadRequestException('Consulta não encontrada ou desativada.');
      if (pedeParametros(consulta as never)) throw new BadRequestException('Esta consulta pede valores digitados ({param.*}): ela não roda sozinha. Use uma consulta que traga a lista de pedidos.');
      // Colunas guardadas ao salvar o SQL; sem elas (agente desligado), confere na primeira leitura.
      const colunas = ((consulta.campos ?? []) as unknown as CampoDinamico[]).map((x) => x.nome);
      if (colunas.length) {
        const p = problemaNasColunasErp(mapaDeColunas(colunas));
        if (p) throw new BadRequestException(p);
      }
    }
    const antes = await this.prisma.configuracaoPedidosErp.findUnique({ where: { empresaId }, select: { ativo: true, consultaId: true } });
    // Ligou agora (ou trocou a consulta): a primeira leitura decide o que fazer com o que já estava lá.
    const recomeca = cfg.ativo && (!antes?.ativo || antes.consultaId !== cfg.consultaId);
    const data = { ...cfg, responsavelId: usuarioId, proximaLeituraEm: cfg.ativo ? new Date() : null, ...(recomeca ? { primeiraLeitura: true } : {}) };
    await this.prisma.$transaction(async (tx) => {
      await tx.configuracaoPedidosErp.upsert({ where: { empresaId }, create: { empresaId, ...data }, update: data });
      await this.auditoria.registrar({ empresaId, usuarioId, acao: 'entrega.pedidos_erp.configurar', entidade: 'ConfiguracaoPedidosErp', detalhes: cfg as never }, tx);
    });
    return this.painel(empresaId);
  }

  async lerAgora(empresaId: string): Promise<PainelPedidosErp> {
    const c = await this.prisma.configuracaoPedidosErp.findUnique({ where: { empresaId }, select: { ativo: true } });
    if (!c?.ativo) throw new ConflictException('Ligue a leitura dos pedidos antes.');
    await this.ler(empresaId);
    return this.painel(empresaId);
  }

  async ignorar(empresaId: string, id: string, ignorar: boolean, usuarioId: string): Promise<PainelPedidosErp> {
    const { count } = await this.prisma.pedidoErpEntrega.updateMany({ where: { id, empresaId, situacao: ignorar ? 'PENDENTE' : 'IGNORADO' }, data: { situacao: ignorar ? 'IGNORADO' : 'PENDENTE', mensagem: ignorar ? 'Ignorado pela empresa.' : null } });
    if (!count) throw new ConflictException(ignorar ? 'Só dá para ignorar pedido esperando a empresa.' : 'O pedido não está ignorado.');
    await this.auditoria.registrar({ empresaId, usuarioId, acao: ignorar ? 'entrega.pedidos_erp.ignorar' : 'entrega.pedidos_erp.voltar', entidade: 'PedidoErpEntrega', entidadeId: id });
    return this.painel(empresaId);
  }

  /** Para a tela abrir a chamada à mão: o pedido como rascunho (o ponto, se a consulta trouxe). */
  async rascunho(empresaId: string, id: string): Promise<RascunhoPedidoErp> {
    const l = await this.prisma.pedidoErpEntrega.findFirst({ where: { id, empresaId } });
    if (!l) throw new NotFoundException('Pedido do ERP não encontrado.');
    const d = l.dados as unknown as PedidoErp;
    const { base } = await this.empresas.config(empresaId);
    const ponto = d.ponto ?? (await this.geocodificar(d.endereco));
    const cliente: ParadaChamada = { lat: ponto?.lat ?? 0, lon: ponto?.lon ?? 0, endereco: d.endereco, contato: d.cliente, telefone: d.telefone, instrucoes: d.observacao };
    const empresa: ParadaChamada | null = base ? { lat: base.lat, lon: base.lon, endereco: base.endereco || 'Empresa', contato: '', telefone: '', instrucoes: '' } : null;
    const entrega = d.tipo === 'ENTREGA';
    return { codigo: d.codigo, tipo: d.tipo, origem: entrega ? empresa : cliente, destino: entrega ? cliente : empresa, serieEsperada: d.serie, observacao: `Pedido ${d.codigo} do ERP`, pedidoErpId: l.id };
  }

  private async geocodificar(endereco: string) {
    if (endereco.trim().length < 5) return null;
    const achados = await this.mapas.geocodificar(endereco).catch(() => []);
    return achados[0] ? { lat: achados[0].lat, lon: achados[0].lon } : null;
  }

  // Leitura ----------------------------------------------------------------------------------

  /** Reivindica com `updateMany` no horário antigo: uma leitura por vez de cada empresa. */
  async verificar(agora = new Date()) {
    if (this.verificando) return;
    this.verificando = true;
    try {
      const vencidas = await this.prisma.configuracaoPedidosErp.findMany({
        where: { ativo: true, proximaLeituraEm: { lte: agora } },
        orderBy: { proximaLeituraEm: 'asc' },
        take: 20,
        select: { empresaId: true, proximaLeituraEm: true, intervaloMinutos: true, empresa: { select: { ativa: true, statusAssinatura: true } } },
      });
      for (const c of vencidas) {
        const vale = !empresaBloqueada(c.empresa);
        const proxima = new Date(agora.getTime() + (vale ? c.intervaloMinutos * 60_000 : ESPERA_BLOQUEADA_MS));
        const { count } = await this.prisma.configuracaoPedidosErp.updateMany({ where: { empresaId: c.empresaId, proximaLeituraEm: c.proximaLeituraEm }, data: { proximaLeituraEm: proxima } });
        if (count === 1 && vale) await this.ler(c.empresaId);
      }
    } catch (e) {
      this.log.error(`Verificação: ${(e as Error).message}`);
    } finally {
      this.verificando = false;
    }
  }

  /** Falha (agente desligado, coluna que sumiu) só guarda o erro: nada é apagado nem chamado. */
  async ler(empresaId: string): Promise<void> {
    const c = await this.prisma.configuracaoPedidosErp.findUnique({ where: { empresaId }, include: { responsavel: { select: { ativo: true } } } });
    if (!c?.ativo) return;
    try {
      if (!c.consultaId) throw new Error('A consulta dos pedidos foi excluída. Escolha outra.');
      if (!c.responsavelId || !c.responsavel?.ativo) throw new Error('O usuário responsável foi removido ou desativado: salve a configuração de novo.');
      const r = await this.consultas.executar(empresaId, c.consultaId, c.responsavelId, {}, LIMITE_LINHAS_PEDIDOS_ERP);
      const mapa = mapaDeColunas(r.colunas.map((x) => x.nome));
      const problema = problemaNasColunasErp(mapa);
      if (problema) throw new Error(problema);
      const pedidos = pedidosDasLinhas(linhasParaRegistros(r.colunas, r.linhas), mapa);
      const codigos = pedidos.map((p) => p.codigo);
      const ja = new Set((await this.prisma.pedidoErpEntrega.findMany({ where: { empresaId, codigo: { in: codigos } }, select: { codigo: true } })).map((x) => x.codigo));
      const novos = pedidos.filter((p) => !ja.has(p.codigo));
      if (c.primeiraLeitura && !c.importarExistentes) {
        await this.prisma.pedidoErpEntrega.createMany({ data: novos.map((p) => ({ empresaId, codigo: p.codigo, dados: p as never, situacao: 'IGNORADO', mensagem: 'Já estava na consulta quando a leitura foi ligada.' })), skipDuplicates: true });
      } else {
        // Com a chamada automática, só MAX_CHAMADAS_POR_LEITURA por vez: o resto entra na próxima leitura.
        const agora = c.chamarAutomatico ? novos.slice(0, MAX_CHAMADAS_POR_LEITURA) : novos;
        for (const p of agora) await this.novo(empresaId, p, c.chamarAutomatico, c.responsavelId);
      }
      // Faxina: só esquece pedido velho que a consulta não traz mais (senão ele voltaria como novo).
      await this.prisma.pedidoErpEntrega.deleteMany({ where: { empresaId, criadoEm: { lt: new Date(Date.now() - DIAS_PEDIDOS_ERP * DIA_MS) }, codigo: { notIn: codigos } } });
      await this.prisma.configuracaoPedidosErp.update({ where: { empresaId }, data: { lidoEm: new Date(), erro: null, primeiraLeitura: false, colunas: mapa as never } });
    } catch (e) {
      await this.prisma.configuracaoPedidosErp.updateMany({ where: { empresaId }, data: { erro: (e as Error).message.slice(0, 500) } }).catch(() => undefined);
    }
  }

  /** Grava o pedido (a chave única segura o repetido) e, com a chamada automática, abre a chamada. */
  private async novo(empresaId: string, p: PedidoErp, chamar: boolean, autorId: string): Promise<void> {
    let linha: { id: string };
    try {
      linha = await this.prisma.pedidoErpEntrega.create({ data: { empresaId, codigo: p.codigo, dados: p as never, situacao: 'PENDENTE', mensagem: chamar ? null : 'Esperando a empresa chamar o entregador.' }, select: { id: true } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return;
      throw e;
    }
    if (!chamar) return;
    const anotar = (mensagem: string) => this.prisma.pedidoErpEntrega.updateMany({ where: { id: linha.id, situacao: 'PENDENTE' }, data: { mensagem: mensagem.slice(0, 300) } });
    try {
      const r = await this.rascunho(empresaId, linha.id);
      if (!r.origem || !r.destino) return void (await anotar('Marque o ponto de partida em Entregas > Configuração e chame à mão.'));
      const cliente = r.tipo === 'ENTREGA' ? r.destino : r.origem;
      if (cliente.lat === 0 && cliente.lon === 0) return void (await anotar('Endereço não achado no mapa: chame à mão e marque o ponto.'));
      await this.chamadas.criar(empresaId, { tipo: r.tipo, origem: r.origem, destino: r.destino, serieEsperada: r.serieEsperada, observacao: r.observacao, distribuir: true, pedidoErpId: r.pedidoErpId } as never, autorId);
    } catch (e) {
      this.log.warn(`Pedido ${p.codigo} do ERP: ${(e as Error).message}`);
      await anotar(`Entregador não chamado: ${(e as Error).message}`).catch(() => undefined);
    }
  }
}

// Rotas --------------------------------------------------------------------------------------

@Controller('entregas/pedidos-erp')
export class PedidosErpController {
  constructor(private readonly servico: PedidosErpService) {}

  @Get()
  @RequerPermissao('entrega.ver')
  painel(@EmpresaAtual() empresaId: string): Promise<PainelPedidosErp> {
    return this.servico.painel(empresaId);
  }

  @Get('consultas')
  @RequerPermissao('entrega.configurar')
  consultas(@EmpresaAtual() empresaId: string): Promise<ConsultaParaPedidosErp[]> {
    return this.servico.consultasDisponiveis(empresaId);
  }

  @Put()
  @RequerPermissao('entrega.configurar')
  salvar(@EmpresaAtual() empresaId: string, @Body() dto: ConfigPedidosErpDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<PainelPedidosErp> {
    return this.servico.salvar(empresaId, dto, u.id);
  }

  @Post('ler')
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  ler(@EmpresaAtual() empresaId: string): Promise<PainelPedidosErp> {
    return this.servico.lerAgora(empresaId);
  }

  @Get(':id/rascunho')
  @RequerPermissao('entrega.gerenciar')
  rascunho(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.servico.rascunho(empresaId, id);
  }

  @Post(':id/ignorar')
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  ignorar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao): Promise<PainelPedidosErp> {
    return this.servico.ignorar(empresaId, id, true, u.id);
  }

  @Post(':id/voltar')
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  voltar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao): Promise<PainelPedidosErp> {
    return this.servico.ignorar(empresaId, id, false, u.id);
  }
}
