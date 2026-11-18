import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, Post } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';
import {
  MAX_PEDIDOS_JUNTOS,
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
import { EmpresaAtual, RequerPermissao } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { EntregasEmpresaService } from './empresa';
import { FechamentoService } from './fechamento';
import { PedidosErpService } from './pedidos-erp';

class JuntarDto {
  @IsArray() @ArrayMaxSize(MAX_PEDIDOS_JUNTOS) @IsUUID('all', { each: true }) pedidoIds: string[];
  @IsArray() @ArrayMaxSize(MAX_PEDIDOS_JUNTOS) @IsUUID('all', { each: true }) pedidoErpIds: string[];
}

type Item = ParadaChamada & { pedidoId: string | null; pedidoErpId: string | null; rotulo: string };

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

  async rascunho(empresaId: string, dto: JuntarDto): Promise<RascunhoJuntos> {
    const problema = problemaNosPedidosJuntos(dto.pedidoIds.length + dto.pedidoErpIds.length);
    if (problema) throw new BadRequestException(problema);
    const { base } = await this.empresas.config(empresaId);
    if (!base) throw new ConflictException('Marque o ponto de partida em Entregas > Configuração antes.');
    const itens: Item[] = [];
    for (const id of dto.pedidoIds) {
      const r = await this.fechamento.rascunhoDoPedido(empresaId, id);
      if (r.chamadaAtiva) throw new ConflictException(`O pedido nº ${r.numero} já está na chamada nº ${r.chamadaAtiva.numero}.`);
      itens.push({ ...r.destino, pedidoId: id, pedidoErpId: null, rotulo: `Pedido nº ${r.numero}` });
    }
    for (const id of dto.pedidoErpIds) {
      const r = await this.pedidosErp.rascunho(empresaId, id);
      if (r.tipo !== 'ENTREGA' || !r.destino) throw new BadRequestException(`O pedido ${r.codigo} do ERP não é de entrega.`);
      itens.push({ ...r.destino, pedidoId: null, pedidoErpId: id, rotulo: `Pedido ${r.codigo} do ERP` });
    }
    // Os que têm ponto, pelo menor caminho; os sem ponto vão no fim, para a empresa marcar no mapa.
    const comPonto = itens.filter((i) => i.lat !== 0 || i.lon !== 0);
    const semPonto = itens.filter((i) => i.lat === 0 && i.lon === 0);
    const ordenados = [...ordemMaisCurta(base, comPonto).map((i) => comPonto[i]), ...semPonto];
    const [primeiro, ...resto] = ordenados;
    const limpa = ({ rotulo: _r, pedidoId: _p, pedidoErpId: _e, ...p }: Item): ParadaChamada => p;
    return {
      origem: { lat: base.lat, lon: base.lon, endereco: base.endereco || 'Empresa', contato: '', telefone: '', instrucoes: '' },
      destino: limpa(primeiro),
      pedidoId: primeiro.pedidoId,
      pedidoErpId: primeiro.pedidoErpId,
      paradasExtras: resto.map((i) => ({ ...limpa(i), pedidoId: i.pedidoId, pedidoErpId: i.pedidoErpId })),
      observacao: `Pedidos juntos: ${ordenados.map((i) => i.rotulo).join(', ')}`.slice(0, 500),
      semPonto: semPonto.map((i) => i.rotulo),
    };
  }
}

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
