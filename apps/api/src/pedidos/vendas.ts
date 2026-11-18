import { randomBytes } from 'node:crypto';
import { BadRequestException, Body, Controller, Get, HttpException, HttpStatus, Injectable, Param, Post, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { IsArray, IsInt, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  categoriasDoCatalogo,
  CONFIG_PEDIDOS_PADRAO,
  CONFIG_VENDAS_PADRAO,
  conferirCarrinho,
  contextoDaVenda,
  faixasDeAgendamento,
  horarioVazio,
  lojaAberta,
  MAX_VENDAS_POR_HORA_VENDEDOR,
  modalidadesPermitidas,
  normalizarCelular,
  normalizarCep,
  observacaoLimpa,
  problemaNaVenda,
  situacaoDoCatalogo,
  totaisDoPedido,
  unidadesDe,
  type CatalogoVenda,
  type ConfigPedidos,
  type ConfigVendas,
  type EnderecoPedido,
  type EventoPedido,
  type FaixaAgendamento,
  type FormaPagamento,
  type HorarioFuncionamento,
  type ItemCarrinho,
  type ItemCatalogo,
  type ItemConferido,
  type ModalidadeEntrega,
  type NovaVenda,
  type PedidoResumo,
  type SituacaoPedido,
  type VendaCriada,
} from '@etiquetas/shared';
import { EmpresaAtual, PermitidoNoApp, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { config } from '../config';
import { cifrar, sha256 } from '../cripto';
import { PrismaService } from '../prisma/prisma.service';
import { CepService } from './cep';
import { ChamadasService } from '../entregas/chamadas';
import { catalogoComReservas, enderecoLimpo, momento, recusaPorMudanca } from './loja';

class NovaVendaDto implements NovaVenda {
  @IsArray()
  itens: ItemCarrinho[];

  @IsString()
  @MaxLength(200)
  nome: string;

  @IsString()
  @MaxLength(40)
  telefone: string;

  @IsString()
  modalidade: ModalidadeEntrega;

  @IsOptional()
  @IsObject()
  endereco: EnderecoPedido | null;

  @IsOptional()
  @IsObject()
  agendamento: FaixaAgendamento | null;

  @IsString()
  pagamento: FormaPagamento;

  @IsOptional()
  @IsInt({ message: 'Valor do troco inválido.' })
  trocoParaCentavos: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observacao: string;

  @IsOptional()
  @IsInt({ message: 'Desconto inválido.' })
  descontoCentavos: number;
}

const SELECAO = {
  ativo: true,
  config: true,
  itens: true,
  dadosEm: true,
  validadeMinutos: true,
  quantidadeItens: true,
  empresa: { select: { razaoSocial: true, nomeFantasia: true, horarioFuncionamento: true } },
} satisfies Prisma.ConfiguracaoPedidosSelect;

const LIMITE_MINHAS = 50;

/**
 * O vendedor lança o pedido pelo aplicativo, logado: mesma cópia dos produtos, mesmas reservas e a mesma
 * numeração do link. O pedido nasce aceito por ele (Em separação), então a folha sai com o código dele.
 */
@Injectable()
export class VendasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly ceps: CepService,
    private readonly chamadas: ChamadasService,
  ) {}

  private async loja(empresaId: string, agora: Date) {
    const l = await this.prisma.configuracaoPedidos.findUnique({ where: { empresaId }, select: SELECAO });
    if (!l) throw new BadRequestException('Os pedidos ainda não foram configurados nesta empresa.');
    const cfg: ConfigPedidos = { ...CONFIG_PEDIDOS_PADRAO, ...(l.config as unknown as ConfigPedidos) };
    const vendas: ConfigVendas = { ...CONFIG_VENDAS_PADRAO, ...(cfg.vendas ?? {}) };
    if (!vendas.ativo) throw new BadRequestException('As vendas pelo aplicativo estão desligadas. Quem configura os pedidos liga em Pedidos > Configuração, no site.');
    if (situacaoDoCatalogo(l, agora) !== 'NO_AR') throw new ServiceUnavailableException('O catálogo de produtos está desligado ou desatualizado: confira em Pedidos > Configuração, no site.');
    const horario = (l.empresa.horarioFuncionamento as HorarioFuncionamento | null) ?? horarioVazio();
    const { hoje, hora, diaSemana } = momento(agora);
    const aberta = lojaAberta(horario, diaSemana, hora);
    const faixas = cfg.modalidades.AGENDADA.ativa ? faixasDeAgendamento(horario, hoje, hora, cfg.agendamento) : [];
    const ctx = contextoDaVenda({ modalidades: cfg.modalidades, aberta, faixas, pedidoMinimoCentavos: cfg.pedidoMinimoCentavos }, vendas);
    return { l, cfg, vendas, hoje, aberta, ctx };
  }

  async catalogo(empresaId: string, agora = new Date()): Promise<CatalogoVenda> {
    const { l, cfg, vendas, hoje, aberta, ctx } = await this.loja(empresaId, agora);
    const itens = await catalogoComReservas(this.prisma, empresaId, l.itens as unknown as ItemCatalogo[]);
    const permitidas = modalidadesPermitidas(cfg.modalidades, ctx.aberta).filter((m) => m !== 'AGENDADA' || ctx.faixas.length > 0);
    return {
      empresa: l.empresa.nomeFantasia || l.empresa.razaoSocial,
      aberta,
      hoje,
      modalidades: permitidas.map((m) => ({ modalidade: m, precoCentavos: cfg.modalidades[m].precoCentavos })),
      enderecoRetirada: permitidas.includes('RETIRADA') ? cfg.enderecoRetirada : null,
      faixas: permitidas.includes('AGENDADA') ? ctx.faixas : [],
      pedidoMinimoCentavos: ctx.pedidoMinimoCentavos,
      descontoMaximoPercentual: vendas.descontoMaximoPercentual,
      itens,
      categorias: categoriasDoCatalogo(itens),
      dadosEm: l.dadosEm!.toISOString(),
    };
  }

  async cep(cep: string) {
    const normalizado = normalizarCep(cep);
    if (!normalizado) throw new BadRequestException('CEP inválido.');
    return this.ceps.consultar(normalizado);
  }

  async criar(empresaId: string, dto: NovaVendaDto, usuario: UsuarioRequisicao, agora = new Date()): Promise<VendaCriada> {
    const { l, cfg, vendas, ctx } = await this.loja(empresaId, agora);
    // O limite vem antes de qualquer conta: um botão repetido não consulta estoque de novo.
    const recentes = await this.prisma.pedido.count({ where: { empresaId, vendedorId: usuario.id, criadoEm: { gte: new Date(agora.getTime() - 3600_000) } } });
    if (recentes >= MAX_VENDAS_POR_HORA_VENDEDOR) throw new HttpException(`Você já lançou ${MAX_VENDAS_POR_HORA_VENDEDOR} vendas na última hora. Espere um pouco ou fale com a loja.`, HttpStatus.TOO_MANY_REQUESTS);
    const carrinho: ItemCarrinho[] = (Array.isArray(dto.itens) ? dto.itens : []).map((i) => {
      const observacao = observacaoLimpa((i as { observacao?: unknown })?.observacao);
      return { codigo: String(i?.codigo ?? ''), quantidade: Number(i?.quantidade), precoCentavos: Number(i?.precoCentavos), ...(observacao ? { observacao } : {}) };
    });
    const catalogo = () => catalogoComReservas(this.prisma, empresaId, l.itens as unknown as ItemCatalogo[]);
    const { itens, mudancas } = conferirCarrinho(carrinho, await catalogo());
    if (mudancas.length) recusaPorMudanca(mudancas, itens);
    const venda: NovaVenda = {
      ...dto,
      itens: carrinho,
      endereco: dto.endereco ? enderecoLimpo(dto.endereco) : null,
      agendamento: dto.agendamento ?? null,
      trocoParaCentavos: dto.trocoParaCentavos ?? null,
      observacao: dto.observacao ?? '',
      descontoCentavos: dto.descontoCentavos ?? 0,
    };
    const problema = problemaNaVenda(venda, itens, ctx, vendas);
    if (problema) throw new BadRequestException(problema);

    const taxa = cfg.modalidades[venda.modalidade].precoCentavos;
    const troco = venda.pagamento === 'DINHEIRO' ? venda.trocoParaCentavos : null;
    const totais = totaisDoPedido(itens, taxa, troco, venda.descontoCentavos);
    const vendedor = await this.prisma.usuario.findUnique({ where: { id: usuario.id }, select: { nome: true } });
    const historico: EventoPedido[] = [{ em: agora.toISOString(), texto: 'Venda lançada no aplicativo', por: vendedor?.nome ?? null }];
    const codigo = randomBytes(16).toString('base64url');
    const { id, numero } = await this.prisma.$transaction(async (tx) => {
      // Mesma ordem do link: a linha da configuração presa dá o número e protege a última unidade.
      const { proximoNumero } = await tx.configuracaoPedidos.update({ where: { empresaId }, data: { proximoNumero: { increment: 1 } }, select: { proximoNumero: true } });
      const n = proximoNumero - 1;
      const conferido = conferirCarrinho(carrinho, await catalogoComReservas(tx, empresaId, l.itens as unknown as ItemCatalogo[]));
      if (conferido.mudancas.length) recusaPorMudanca(conferido.mudancas, conferido.itens);
      const criado = await tx.pedido.create({
        data: {
          empresaId,
          numero: n,
          codigoHash: sha256(codigo),
          codigoCifrado: cifrar(codigo, config().chaveCriptografia),
          situacao: 'EM_SEPARACAO',
          clienteNome: venda.nome.trim(),
          clienteTelefone: normalizarCelular(venda.telefone)!,
          endereco: venda.modalidade === 'RETIRADA' ? Prisma.DbNull : (venda.endereco as unknown as Prisma.InputJsonValue),
          modalidade: venda.modalidade,
          agendamento: venda.modalidade === 'AGENDADA' ? (venda.agendamento as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          pagamento: venda.pagamento,
          trocoParaCentavos: troco,
          observacao: venda.observacao.trim(),
          itens: itens as unknown as Prisma.InputJsonValue,
          subtotalCentavos: totais.subtotalCentavos,
          taxaCentavos: totais.taxaCentavos,
          descontoCentavos: totais.descontoCentavos,
          totalCentavos: totais.totalCentavos,
          aceitoPorId: usuario.id,
          aceitoEm: agora,
          historico: historico as unknown as Prisma.InputJsonValue,
          origem: 'VENDEDOR',
          vendedorId: usuario.id,
          origemHash: sha256(`${empresaId}:vendedor:${usuario.id}`),
        },
        select: { id: true },
      });
      await this.auditoria.registrar({ empresaId, usuarioId: usuario.id, acao: 'pedido.vender', entidade: 'Pedido', entidadeId: criado.id, detalhes: { numero: n, totalCentavos: totais.totalCentavos, descontoCentavos: totais.descontoCentavos, modalidade: venda.modalidade } }, tx);
      return { id: criado.id, numero: n };
    });
    if (venda.modalidade !== 'RETIRADA') await this.chamadas.chamarParaPedido(empresaId, id, usuario.id).catch(() => undefined);
    return { id, numero, codigo };
  }

  /** As últimas vendas do próprio vendedor: quem só vende não vê os pedidos dos outros. */
  async minhas(empresaId: string, usuarioId: string): Promise<PedidoResumo[]> {
    const lista = await this.prisma.pedido.findMany({
      where: { empresaId, vendedorId: usuarioId },
      orderBy: { criadoEm: 'desc' },
      take: LIMITE_MINHAS,
      select: { id: true, numero: true, situacao: true, criadoEm: true, clienteNome: true, modalidade: true, agendamento: true, totalCentavos: true, itens: true, propostaEm: true, vendedor: { select: { nome: true } } },
    });
    return lista.map((p) => ({
      id: p.id,
      numero: p.numero,
      situacao: p.situacao as SituacaoPedido,
      criadoEm: p.criadoEm.toISOString(),
      clienteNome: p.clienteNome,
      modalidade: p.modalidade as ModalidadeEntrega,
      agendamento: (p.agendamento as unknown as FaixaAgendamento | null) ?? null,
      totalCentavos: p.totalCentavos,
      unidades: unidadesDe(p.itens as unknown as ItemConferido[]),
      aguardandoCliente: !!p.propostaEm,
      vendedorNome: p.vendedor?.nome ?? null,
    }));
  }
}

@Controller('pedidos/venda')
export class VendasController {
  constructor(private readonly vendas: VendasService) {}

  @Get('catalogo')
  @PermitidoNoApp()
  @RequerPermissao('pedido.vender')
  catalogo(@EmpresaAtual() empresaId: string) {
    return this.vendas.catalogo(empresaId);
  }

  @Get('minhas')
  @PermitidoNoApp()
  @RequerPermissao('pedido.vender')
  minhas(@EmpresaAtual() empresaId: string, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.vendas.minhas(empresaId, u.id);
  }

  @Get('cep/:cep')
  @PermitidoNoApp()
  @RequerPermissao('pedido.vender')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  cep(@Param('cep') cep: string) {
    return this.vendas.cep(cep);
  }

  @Post()
  @PermitidoNoApp()
  @RequerPermissao('pedido.vender')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  criar(@EmpresaAtual() empresaId: string, @Body() dto: NovaVendaDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.vendas.criar(empresaId, dto, u);
  }
}
