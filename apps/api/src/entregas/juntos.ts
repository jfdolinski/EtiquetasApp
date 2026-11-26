import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import {
  MAX_PEDIDOS_JUNTOS,
  MAX_PEDIDOS_ROTEIRIZAR,
  metrosEstimados,
  problemaNaRoteirizacao,
  roteirizar,
  type PedidoDoRoteiro,
  type ResultadoRoteiro,
  type RoteiroProposto,
  ordemMaisCurta,
  pedidoPodeChamarEntregador,
  problemaNosPedidosJuntos,
  SITUACOES_EM_ANDAMENTO,
  type EnderecoPedido,
  type ModalidadeEntrega,
  type ParadaChamada,
  type PedidoErp,
  type PedidoParaJuntar,
  type RascunhoJuntos,
  type SituacaoPedido,
} from '@etiquetas/shared';
import { EmpresaAtual, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { ChamadasService } from './chamadas';
import { PrismaService } from '../prisma/prisma.service';
import { EntregasEmpresaService } from './empresa';
import { FechamentoService } from './fechamento';
import { PedidosErpService } from './pedidos-erp';

class JuntarDto {
  @IsArray() @ArrayMaxSize(MAX_PEDIDOS_JUNTOS) @IsUUID('all', { each: true }) pedidoIds: string[];
  @IsArray() @ArrayMaxSize(MAX_PEDIDOS_JUNTOS) @IsUUID('all', { each: true }) pedidoErpIds: string[];
}

class RoteirizarDto {
  @IsArray() @ArrayMaxSize(MAX_PEDIDOS_ROTEIRIZAR) @IsUUID('all', { each: true }) pedidoIds: string[];
  @IsArray() @ArrayMaxSize(MAX_PEDIDOS_ROTEIRIZAR) @IsUUID('all', { each: true }) pedidoErpIds: string[];
  @IsInt() @Min(1) @Max(MAX_PEDIDOS_JUNTOS) porChamada: number;
}

class GrupoDto {
  @IsArray() @ArrayMaxSize(MAX_PEDIDOS_JUNTOS) @IsUUID('all', { each: true }) pedidoIds: string[];
  @IsArray() @ArrayMaxSize(MAX_PEDIDOS_JUNTOS) @IsUUID('all', { each: true }) pedidoErpIds: string[];
}

class AbrirRoteiroDto {
  @IsArray() @ArrayMaxSize(MAX_PEDIDOS_ROTEIRIZAR) @ValidateNested({ each: true }) @Type(() => GrupoDto) grupos: GrupoDto[];
  @IsBoolean() distribuir: boolean;
}

type Item = ParadaChamada & { pedidoId: string | null; pedidoErpId: string | null; rotulo: string; cliente: string };

/**
 * Entregas, etapa 11: vários pedidos (do Flow e do ERP) numa chamada só, um por parada, na ordem do
 * menor caminho a partir da base. Só monta o rascunho: a chamada nasce pela `NovaChamadaModal`, e o
 * `ChamadasService.criar` confere e reivindica cada pedido.
 */
@Injectable()
export class JuntosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly empresas: EntregasEmpresaService,
    private readonly fechamento: FechamentoService,
    private readonly pedidosErp: PedidosErpService,
    private readonly chamadas: ChamadasService,
  ) {}

  /** Com entrega e sem chamada em andamento (nem como parada de outra). */
  async disponiveis(empresaId: string): Promise<PedidoParaJuntar[]> {
    const ativas = { in: ['ABERTA', ...SITUACOES_EM_ANDAMENTO] };
    const [flow, erp] = await Promise.all([
      this.prisma.pedido.findMany({
        where: { empresaId, situacao: { in: ['EM_SEPARACAO', 'PRONTO'] }, modalidade: { not: 'RETIRADA' }, chamadasEntrega: { none: { situacao: ativas } } },
        orderBy: { criadoEm: 'asc' },
        take: 100,
        select: { id: true, numero: true, situacao: true, modalidade: true, endereco: true, clienteNome: true },
      }),
      this.prisma.pedidoErpEntrega.findMany({ where: { empresaId, situacao: 'PENDENTE' }, orderBy: { criadoEm: 'asc' }, take: 100 }),
    ]);
    const emParadas = new Set(
      (await this.prisma.paradaExtraChamada.findMany({ where: { pedidoId: { in: flow.map((p) => p.id) }, chamada: { empresaId, situacao: ativas } }, select: { pedidoId: true } })).map((p) => p.pedidoId),
    );
    const doFlow = flow
      .filter((p) => !emParadas.has(p.id) && pedidoPodeChamarEntregador({ modalidade: p.modalidade as ModalidadeEntrega, situacao: p.situacao as SituacaoPedido, endereco: p.endereco as unknown as EnderecoPedido | null }))
      .map((p): PedidoParaJuntar => {
        const e = p.endereco as unknown as EnderecoPedido;
        return { origem: 'FLOW', id: p.id, rotulo: `Pedido nº ${p.numero}`, cliente: p.clienteNome, endereco: [e.rua, e.semNumero ? 's/n' : e.numero, e.bairro].filter(Boolean).join(', '), temPonto: !!e.localizacao };
      });
    const doErp = erp
      .map((l) => ({ l, d: l.dados as unknown as PedidoErp }))
      .filter(({ d }) => d.tipo === 'ENTREGA')
      .map(({ l, d }): PedidoParaJuntar => ({ origem: 'ERP', id: l.id, rotulo: `Pedido ${d.codigo} do ERP`, cliente: d.cliente, endereco: d.endereco, temPonto: !!d.ponto }));
    return [...doFlow, ...doErp];
  }

  private async base(empresaId: string) {
    const { base } = await this.empresas.config(empresaId);
    if (!base) throw new ConflictException('Marque o ponto de partida em Entregas > Configuração antes.');
    return base;
  }

  /** Cada pedido como parada, conferido (com entrega, sem chamada). Sem ponto = lat e lon 0. */
  private async itens(empresaId: string, pedidoIds: string[], pedidoErpIds: string[]): Promise<Item[]> {
    const itens: Item[] = [];
    for (const id of pedidoIds) {
      const r = await this.fechamento.rascunhoDoPedido(empresaId, id);
      if (r.chamadaAtiva) throw new ConflictException(`O pedido nº ${r.numero} já está na chamada nº ${r.chamadaAtiva.numero}.`);
      itens.push({ ...r.destino, pedidoId: id, pedidoErpId: null, rotulo: `Pedido nº ${r.numero}`, cliente: r.destino.contato });
    }
    for (const id of pedidoErpIds) {
      const r = await this.pedidosErp.rascunho(empresaId, id);
      if (r.tipo !== 'ENTREGA' || !r.destino) throw new BadRequestException(`O pedido ${r.codigo} do ERP não é de entrega.`);
      itens.push({ ...r.destino, pedidoId: null, pedidoErpId: id, rotulo: `Pedido ${r.codigo} do ERP`, cliente: r.destino.contato });
    }
    return itens;
  }

  /** Base → pedidos com ponto pelo menor caminho; os sem ponto no fim, para a empresa marcar no mapa. */
  private montar(base: { lat: number; lon: number; endereco?: string | null }, itens: Item[]): RascunhoJuntos {
    const comPonto = itens.filter((i) => temPonto(i));
    const semPonto = itens.filter((i) => !temPonto(i));
    const ordenados = [...ordemMaisCurta(base, comPonto).map((i) => comPonto[i]), ...semPonto];
    const [primeiro, ...resto] = ordenados;
    const limpa = ({ rotulo: _r, pedidoId: _p, pedidoErpId: _e, cliente: _c, ...p }: Item): ParadaChamada => p;
    return {
      origem: { lat: base.lat, lon: base.lon, endereco: base.endereco || 'Empresa', contato: '', telefone: '', instrucoes: '' },
      destino: limpa(primeiro),
      pedidoId: primeiro.pedidoId,
      pedidoErpId: primeiro.pedidoErpId,
      paradasExtras: resto.map((i) => ({ ...limpa(i), pedidoId: i.pedidoId, pedidoErpId: i.pedidoErpId })),
      observacao: (ordenados.length > 1 ? `Pedidos juntos: ${ordenados.map((i) => i.rotulo).join(', ')}` : ordenados[0].rotulo).slice(0, 500),
      semPonto: semPonto.map((i) => i.rotulo),
    };
  }

  async rascunho(empresaId: string, dto: JuntarDto): Promise<RascunhoJuntos> {
    const problema = problemaNosPedidosJuntos(dto.pedidoIds.length + dto.pedidoErpIds.length);
    if (problema) throw new BadRequestException(problema);
    const base = await this.base(empresaId);
    return this.montar(base, await this.itens(empresaId, dto.pedidoIds, dto.pedidoErpIds));
  }

  /**
   * Etapa 14: divide muitos pedidos em chamadas por direção a partir da base (`roteirizar`), até
   * `porChamada` em cada. Só propõe: nada é gravado até `abrir`.
   */
  async roteirizar(empresaId: string, dto: RoteirizarDto): Promise<RoteiroProposto> {
    const problema = problemaNaRoteirizacao(dto.pedidoIds.length + dto.pedidoErpIds.length, dto.porChamada);
    if (problema) throw new BadRequestException(problema);
    if (new Set(dto.pedidoIds).size !== dto.pedidoIds.length || new Set(dto.pedidoErpIds).size !== dto.pedidoErpIds.length) throw new BadRequestException('O mesmo pedido aparece duas vezes.');
    const base = await this.base(empresaId);
    const itens = await this.itens(empresaId, dto.pedidoIds, dto.pedidoErpIds);
    const doRoteiro = (i: Item): PedidoDoRoteiro => ({ origem: i.pedidoId ? 'FLOW' : 'ERP', id: (i.pedidoId ?? i.pedidoErpId)!, rotulo: i.rotulo, cliente: i.cliente, endereco: i.endereco });
    const comPonto = itens.filter((i) => temPonto(i));
    const grupos = roteirizar(base, comPonto, dto.porChamada).map((g) => {
      const pontos = g.map((k) => comPonto[k]);
      return { pedidos: pontos.map(doRoteiro), metrosEstimados: metrosEstimados(base, pontos) };
    });
    return { grupos, semPonto: itens.filter((i) => !temPonto(i)).map(doRoteiro) };
  }

  /** Abre uma chamada por grupo (cada uma conferida de novo); um grupo com problema não impede os outros. */
  async abrir(empresaId: string, dto: AbrirRoteiroDto, autorId: string): Promise<ResultadoRoteiro> {
    const total = dto.grupos.reduce((s, g) => s + g.pedidoIds.length + g.pedidoErpIds.length, 0);
    const problema = problemaNaRoteirizacao(total, MAX_PEDIDOS_JUNTOS);
    if (problema) throw new BadRequestException(problema);
    if (dto.grupos.some((g) => g.pedidoIds.length + g.pedidoErpIds.length > MAX_PEDIDOS_JUNTOS)) throw new BadRequestException(`Cada chamada leva até ${MAX_PEDIDOS_JUNTOS} pedidos.`);
    const base = await this.base(empresaId);
    const resultado: ResultadoRoteiro = { abertas: [], erros: [] };
    for (const g of dto.grupos) {
      const quantos = g.pedidoIds.length + g.pedidoErpIds.length;
      if (!quantos) continue;
      let rotulos = `${quantos} pedido(s)`;
      try {
        const itens = await this.itens(empresaId, g.pedidoIds, g.pedidoErpIds);
        rotulos = itens.map((i) => i.rotulo).join(', ');
        const semPonto = itens.filter((i) => !temPonto(i));
        if (semPonto.length) throw new ConflictException(`Sem ponto no mapa: ${semPonto.map((i) => i.rotulo).join(', ')}.`);
        const r = this.montar(base, itens);
        const c = await this.chamadas.criar(
          empresaId,
          { tipo: 'ENTREGA', origem: r.origem, destino: r.destino, serieEsperada: null, observacao: r.observacao, distribuir: dto.distribuir, pedidoId: r.pedidoId, pedidoErpId: r.pedidoErpId, paradasExtras: r.paradasExtras } as never,
          autorId,
        );
        resultado.abertas.push({ id: c.id, numero: c.numero, pedidos: quantos });
      } catch (e) {
        resultado.erros.push({ pedidos: rotulos, erro: (e as Error).message });
      }
    }
    return resultado;
  }
}

const temPonto = (p: { lat: number; lon: number }) => p.lat !== 0 || p.lon !== 0;

@Controller('entregas/juntar')
export class JuntosController {
  constructor(private readonly juntos: JuntosService) {}

  @Get('pedidos')
  @RequerPermissao('entrega.gerenciar')
  pedidos(@EmpresaAtual() empresaId: string): Promise<PedidoParaJuntar[]> {
    return this.juntos.disponiveis(empresaId);
  }

  @Post()
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  rascunho(@EmpresaAtual() empresaId: string, @Body() dto: JuntarDto): Promise<RascunhoJuntos> {
    return this.juntos.rascunho(empresaId, dto);
  }
}

@Controller('entregas/roteirizar')
export class RoteirizarController {
  constructor(private readonly juntos: JuntosService) {}

  @Post()
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  propor(@EmpresaAtual() empresaId: string, @Body() dto: RoteirizarDto): Promise<RoteiroProposto> {
    return this.juntos.roteirizar(empresaId, dto);
  }

  @Post('abrir')
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  abrir(@EmpresaAtual() empresaId: string, @Body() dto: AbrirRoteiroDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<ResultadoRoteiro> {
    return this.juntos.abrir(empresaId, dto, u.id);
  }
}
