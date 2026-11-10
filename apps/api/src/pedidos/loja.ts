import { randomBytes } from 'node:crypto';
import { BadRequestException, Body, ConflictException, Controller, Get, HttpException, HttpStatus, Injectable, NotFoundException, Param, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { IsArray, IsBoolean, IsDateString, IsInt, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  categoriasDoCatalogo,
  clientePodeCancelar,
  clientePodeConfirmar,
  LIMITE_MOTIVO_CANCELAMENTO,
  diferencasDaPropostaPedido,
  itensDaProposta,
  totaisDaProposta,
  type EventoPedido,
  type PropostaPedido,
  type PropostaPublica,
  CONFIG_PEDIDOS_PADRAO,
  conferirCarrinho,
  faixasDeAgendamento,
  horarioVazio,
  lojaAberta,
  modalidadesPermitidas,
  normalizarCelular,
  normalizarCep,
  problemaNoPedido,
  situacaoDoCatalogo,
  textoProximaAbertura,
  totaisDoPedido,
  type CatalogoPublico,
  type ConfigPedidos,
  type EnderecoPedido,
  type FaixaAgendamento,
  type FormaPagamento,
  type HorarioFuncionamento,
  type ItemCarrinho,
  type ItemCatalogo,
  type ItemConferido,
  type ModalidadeEntrega,
  type NovoPedido,
  type PedidoCriado,
  type PedidoPublico,
  type RecusaPorMudanca,
  type SituacaoPedido,
} from '@etiquetas/shared';
import { empresaBloqueada } from '../auth/acesso-empresa';
import { Publico } from '../auth/decorators';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { config } from '../config';
import { agoraNoFuso } from '../consultas/consultas.service';
import { cifrar, sha256 } from '../cripto';
import { PrismaService } from '../prisma/prisma.service';
import { horaLocal } from '../telas/hora';
import { CepService } from './cep';
import { estadoDe } from './painel';

/** Um mesmo aparelho, numa mesma loja, por hora: acima disso é brincadeira ou robô. */
export const MAX_PEDIDOS_POR_ORIGEM_HORA = 10;
const CODIGO = /^[A-Za-z0-9_-]{8,64}$/;

class NovoPedidoDto implements NovoPedido {
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
}

class CancelarPeloClienteDto {
  @IsOptional()
  @IsString()
  @MaxLength(LIMITE_MOTIVO_CANCELAMENTO)
  motivo?: string;
}

class RespostaPropostaDto {
  @IsDateString({}, { message: 'Abra o pedido de novo.' })
  versao: string;

  @IsBoolean()
  aceita: boolean;
}

const t = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Só os campos conhecidos, aparados: o que o navegador mandar a mais não vai para o banco. */
function enderecoLimpo(e: EnderecoPedido): EnderecoPedido {
  return { cep: normalizarCep(e.cep) ?? '', rua: t(e.rua, 120), numero: e.semNumero ? '' : t(e.numero, 10), semNumero: e.semNumero === true, complemento: t(e.complemento, 80), bairro: t(e.bairro, 80), cidade: t(e.cidade, 80), uf: t(e.uf, 2).toUpperCase() };
}

function momento(agora: Date) {
  const fuso = config().fusoHorario;
  const hoje = agoraNoFuso(agora, fuso).data;
  return { hoje, hora: horaLocal(agora, fuso), diaSemana: new Date(`${hoje}T12:00:00Z`).getUTCDay() };
}

const SELECAO_LOJA = {
  empresaId: true,
  ativo: true,
  config: true,
  itens: true,
  dadosEm: true,
  validadeMinutos: true,
  quantidadeItens: true,
  empresa: { select: { razaoSocial: true, nomeFantasia: true, ativa: true, statusAssinatura: true, horarioFuncionamento: true } },
} satisfies Prisma.ConfiguracaoPedidosSelect;

type Loja = Prisma.ConfiguracaoPedidosGetPayload<{ select: typeof SELECAO_LOJA }>;

@Injectable()
export class LojaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly ceps: CepService,
  ) {}

  /** O link que não existe e o catálogo fora do ar respondem diferente: o primeiro pode ser um link digitado errado. */
  private async loja(codigo: string, agora: Date) {
    const l = CODIGO.test(codigo) ? await this.prisma.configuracaoPedidos.findUnique({ where: { codigoLink: codigo }, select: SELECAO_LOJA }) : null;
    if (!l) throw new NotFoundException('Este link de pedidos não existe. Peça o link certo para a loja.');
    if (empresaBloqueada(l.empresa) || situacaoDoCatalogo(l, agora) !== 'NO_AR') throw new ServiceUnavailableException('O catálogo desta loja está indisponível no momento. Tente mais tarde.');
    return l;
  }

  private contexto(l: Loja, agora: Date) {
    const cfg: ConfigPedidos = { ...CONFIG_PEDIDOS_PADRAO, ...(l.config as unknown as ConfigPedidos) };
    const horario = (l.empresa.horarioFuncionamento as HorarioFuncionamento | null) ?? horarioVazio();
    const { hoje, hora, diaSemana } = momento(agora);
    const aberta = lojaAberta(horario, diaSemana, hora);
    const faixas = cfg.modalidades.AGENDADA.ativa ? faixasDeAgendamento(horario, hoje, hora, cfg.agendamento) : [];
    return { cfg, horario, hoje, hora, diaSemana, aberta, faixas };
  }

  async catalogo(codigo: string, agora = new Date()): Promise<CatalogoPublico> {
    const l = await this.loja(codigo, agora);
    const { cfg, horario, hoje, hora, diaSemana, aberta, faixas } = this.contexto(l, agora);
    // O código de barras só serve para a foto e para a folha da loja.
    const itens = (l.itens as unknown as ItemCatalogo[]).map(({ codigoBarras: _cb, ...i }) => i);
    // Agendada sem nenhuma faixa livre seria uma opção que não dá para escolher.
    const permitidas = modalidadesPermitidas(cfg.modalidades, aberta).filter((m) => m !== 'AGENDADA' || faixas.length > 0);
    return {
      empresa: l.empresa.nomeFantasia || l.empresa.razaoSocial,
      mensagem: cfg.mensagem,
      aberta,
      abreEm: aberta ? null : textoProximaAbertura(horario, diaSemana, hora),
      hoje,
      modalidades: permitidas.map((m) => ({ modalidade: m, precoCentavos: cfg.modalidades[m].precoCentavos })),
      enderecoRetirada: permitidas.includes('RETIRADA') ? cfg.enderecoRetirada : null,
      faixas: permitidas.includes('AGENDADA') ? faixas : [],
      pedidoMinimoCentavos: cfg.pedidoMinimoCentavos,
      itens,
      categorias: categoriasDoCatalogo(itens),
      dadosEm: l.dadosEm!.toISOString(),
    };
  }

  async cep(codigo: string, cep: string) {
    await this.loja(codigo, new Date());
    const normalizado = normalizarCep(cep);
    if (!normalizado) throw new BadRequestException('CEP inválido.');
    return this.ceps.consultar(normalizado);
  }

  async criar(codigo: string, dto: NovoPedidoDto, ip: string, agora = new Date()): Promise<PedidoCriado> {
    const l = await this.loja(codigo, agora);
    const { cfg, aberta, faixas } = this.contexto(l, agora);
    const carrinho: ItemCarrinho[] = (Array.isArray(dto.itens) ? dto.itens : []).map((i) => ({ codigo: String(i?.codigo ?? ''), quantidade: Number(i?.quantidade), precoCentavos: Number(i?.precoCentavos) }));
    const { itens, mudancas } = conferirCarrinho(carrinho, l.itens as unknown as ItemCatalogo[]);
    if (mudancas.length) {
      const corpo: RecusaPorMudanca & { message: string; statusCode: number } = { statusCode: 409, message: 'Alguns produtos mudaram desde que você os escolheu. Confira e envie de novo.', mudancas, itens };
      throw new ConflictException(corpo);
    }
    const pedido: NovoPedido = { ...dto, itens: carrinho, endereco: dto.endereco ? enderecoLimpo(dto.endereco) : null, agendamento: dto.agendamento ?? null, trocoParaCentavos: dto.trocoParaCentavos ?? null, observacao: dto.observacao ?? '' };
    const problema = problemaNoPedido(pedido, itens, { modalidades: cfg.modalidades, aberta, faixas, pedidoMinimoCentavos: cfg.pedidoMinimoCentavos });
    if (problema) throw new BadRequestException(problema);

    const origemHash = sha256(`${l.empresaId}:${ip}`);
    const recentes = await this.prisma.pedido.count({ where: { empresaId: l.empresaId, origemHash, criadoEm: { gte: new Date(agora.getTime() - 3600_000) } } });
    if (recentes >= MAX_PEDIDOS_POR_ORIGEM_HORA) throw new HttpException('Muitos pedidos seguidos deste aparelho. Fale com a loja ou tente mais tarde.', HttpStatus.TOO_MANY_REQUESTS);

    const taxa = cfg.modalidades[pedido.modalidade].precoCentavos;
    const troco = pedido.pagamento === 'DINHEIRO' ? pedido.trocoParaCentavos : null;
    const totais = totaisDoPedido(itens, taxa, troco);
    const codigoAcompanhamento = randomBytes(16).toString('base64url');
    const numero = await this.prisma.$transaction(async (tx) => {
      // A linha da configuração fica presa até o fim: dois pedidos ao mesmo tempo não pegam o mesmo número.
      const { proximoNumero } = await tx.configuracaoPedidos.update({ where: { empresaId: l.empresaId }, data: { proximoNumero: { increment: 1 } }, select: { proximoNumero: true } });
      const n = proximoNumero - 1;
      const criado = await tx.pedido.create({
        data: {
          empresaId: l.empresaId,
          numero: n,
          codigoHash: sha256(codigoAcompanhamento),
          codigoCifrado: cifrar(codigoAcompanhamento, config().chaveCriptografia),
          clienteNome: pedido.nome.trim(),
          clienteTelefone: normalizarCelular(pedido.telefone)!,
          endereco: pedido.modalidade === 'RETIRADA' ? Prisma.DbNull : (pedido.endereco as unknown as Prisma.InputJsonValue),
          modalidade: pedido.modalidade,
          agendamento: pedido.modalidade === 'AGENDADA' ? (pedido.agendamento as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          pagamento: pedido.pagamento,
          trocoParaCentavos: troco,
          observacao: pedido.observacao.trim(),
          itens: itens as unknown as Prisma.InputJsonValue,
          subtotalCentavos: totais.subtotalCentavos,
          taxaCentavos: totais.taxaCentavos,
          totalCentavos: totais.totalCentavos,
          origemHash,
        },
        select: { id: true },
      });
      await this.auditoria.registrar({ empresaId: l.empresaId, usuarioId: null, acao: 'pedido.criar', entidade: 'Pedido', entidadeId: criado.id, detalhes: { numero: n, totalCentavos: totais.totalCentavos, modalidade: pedido.modalidade } }, tx);
      return n;
    });
    return { numero, codigo: codigoAcompanhamento };
  }

  async acompanhar(codigo: string): Promise<PedidoPublico> {
    const p = CODIGO.test(codigo)
      ? await this.prisma.pedido.findUnique({
          where: { codigoHash: sha256(codigo) },
          include: { empresa: { select: { razaoSocial: true, nomeFantasia: true, configuracaoPedidos: { select: { config: true } } } } },
        })
      : null;
    if (!p) throw new NotFoundException('Pedido não encontrado. Confira o link.');
    const itens = p.itens as unknown as ItemConferido[];
    const cfg = p.empresa.configuracaoPedidos?.config as unknown as ConfigPedidos | undefined;
    return {
      empresa: p.empresa.nomeFantasia || p.empresa.razaoSocial,
      numero: p.numero,
      situacao: p.situacao as SituacaoPedido,
      criadoEm: p.criadoEm.toISOString(),
      nome: p.clienteNome,
      telefone: p.clienteTelefone,
      modalidade: p.modalidade as ModalidadeEntrega,
      endereco: p.modalidade === 'RETIRADA' ? null : ((p.endereco as unknown as EnderecoPedido | null) ?? null),
      enderecoRetirada: p.modalidade === 'RETIRADA' ? (cfg?.enderecoRetirada ?? null) : null,
      agendamento: (p.agendamento as unknown as FaixaAgendamento | null) ?? null,
      pagamento: p.pagamento as FormaPagamento,
      trocoParaCentavos: p.trocoParaCentavos,
      observacao: p.observacao,
      itens,
      totais: totaisDoPedido(itens, p.taxaCentavos, p.trocoParaCentavos, p.descontoCentavos),
      proposta: this.propostaPublica(p),
      motivoCancelamento: p.motivoCancelamento,
    };
  }

  private propostaPublica(p: { proposta: Prisma.JsonValue; propostaEm: Date | null; itens: Prisma.JsonValue; modalidade: string; taxaCentavos: number; descontoCentavos: number; agendamento: Prisma.JsonValue; endereco: Prisma.JsonValue; trocoParaCentavos: number | null }): PropostaPublica | null {
    if (!p.proposta || !p.propostaEm) return null;
    const proposta = p.proposta as unknown as PropostaPedido;
    const estado = estadoDe(p as never);
    return {
      versao: p.propostaEm.toISOString(),
      mensagem: proposta.mensagem,
      diferencas: diferencasDaPropostaPedido(estado, proposta),
      itens: itensDaProposta(estado.itens, proposta),
      modalidade: proposta.modalidade,
      agendamento: proposta.agendamento,
      totais: totaisDaProposta(estado, proposta),
    };
  }

  /**
   * O cliente responde à alteração que a loja propôs. A versão é a data da proposta: se a loja mandou
   * outra no meio do caminho, a resposta não vale para ela.
   */
  async responder(codigo: string, versao: string, aceita: boolean): Promise<PedidoPublico> {
    const p = CODIGO.test(codigo) ? await this.prisma.pedido.findUnique({ where: { codigoHash: sha256(codigo) } }) : null;
    if (!p) throw new NotFoundException('Pedido não encontrado. Confira o link.');
    if (!p.proposta || !p.propostaEm) throw new BadRequestException('Não há alteração esperando a sua resposta.');
    if (p.propostaEm.toISOString() !== versao) throw new ConflictException('A loja mudou a alteração enquanto você decidia. Confira de novo.');
    const proposta = p.proposta as unknown as PropostaPedido;
    const estado = estadoDe(p as never);
    const historico = [...((p.historico as unknown as EventoPedido[]) ?? []), { em: new Date().toISOString(), texto: aceita ? 'O cliente aceitou a alteração' : 'O cliente recusou a alteração', por: null }];
    const resposta = { aceita, em: new Date().toISOString() };
    const mudar = aceita
      ? (() => {
          const itens = itensDaProposta(estado.itens, proposta);
          const totais = totaisDaProposta(estado, proposta);
          return {
            itens: itens as unknown as Prisma.InputJsonValue,
            modalidade: proposta.modalidade,
            agendamento: proposta.modalidade === 'AGENDADA' ? (proposta.agendamento as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
            subtotalCentavos: totais.subtotalCentavos,
            taxaCentavos: totais.taxaCentavos,
            descontoCentavos: totais.descontoCentavos,
            totalCentavos: totais.totalCentavos,
          };
        })()
      : {};
    const { count } = await this.prisma.pedido.updateMany({
      where: { id: p.id, propostaEm: p.propostaEm },
      data: { ...mudar, proposta: Prisma.DbNull, propostaEm: null, respostaProposta: resposta, historico: historico as unknown as Prisma.InputJsonValue },
    });
    if (count === 0) throw new ConflictException('A loja mudou a alteração enquanto você decidia. Confira de novo.');
    await this.auditoria.registrar({ empresaId: p.empresaId, usuarioId: null, acao: aceita ? 'pedido.proposta_aceita' : 'pedido.proposta_recusada', entidade: 'Pedido', entidadeId: p.id, detalhes: { numero: p.numero } });
    return this.acompanhar(codigo);
  }

  /**
   * O cliente desiste (recebido ou em separação) ou confirma que recebeu (depois de sair para entrega).
   * Só grava se a situação ainda é a que ele viu permitir: se a loja avançou no meio do caminho, recusa.
   */
  async decisaoDoCliente(codigo: string, acao: 'cancelar' | 'confirmar', motivo?: string): Promise<PedidoPublico> {
    const p = CODIGO.test(codigo) ? await this.prisma.pedido.findUnique({ where: { codigoHash: sha256(codigo) }, select: { id: true, empresaId: true, numero: true, situacao: true, historico: true } }) : null;
    if (!p) throw new NotFoundException('Pedido não encontrado. Confira o link.');
    const situacao = p.situacao as SituacaoPedido;
    const cancelar = acao === 'cancelar';
    if (cancelar ? !clientePodeCancelar(situacao) : !clientePodeConfirmar(situacao)) {
      throw new ConflictException(cancelar ? 'O pedido já saiu para entrega ou terminou: para cancelar, fale com a loja.' : 'O pedido ainda não saiu para entrega.');
    }
    const texto = motivo?.trim().slice(0, LIMITE_MOTIVO_CANCELAMENTO) || null;
    const historico = [...((p.historico as unknown as EventoPedido[]) ?? []), { em: new Date().toISOString(), texto: cancelar ? `Cancelado pelo cliente${texto ? `: ${texto}` : ''}` : 'O cliente confirmou o recebimento', por: null }];
    const { count } = await this.prisma.pedido.updateMany({
      where: { id: p.id, situacao },
      data: cancelar
        ? { situacao: 'CANCELADO', motivoCancelamento: texto ? `Cancelado pelo cliente: ${texto}` : 'Cancelado pelo cliente', proposta: Prisma.DbNull, propostaEm: null, historico: historico as unknown as Prisma.InputJsonValue }
        : { situacao: 'CONCLUIDO', historico: historico as unknown as Prisma.InputJsonValue },
    });
    if (count === 0) throw new ConflictException('A loja mudou o pedido enquanto você decidia. Confira de novo.');
    await this.auditoria.registrar({ empresaId: p.empresaId, usuarioId: null, acao: cancelar ? 'pedido.cancelado_cliente' : 'pedido.recebido_cliente', entidade: 'Pedido', entidadeId: p.id, detalhes: { numero: p.numero, de: situacao, ...(texto ? { motivo: texto } : {}) } });
    return this.acompanhar(codigo);
  }
}

/** Tudo público: o cliente da loja não tem login. O que protege é o código aleatório de cada link. */
@Controller('loja')
export class LojaController {
  constructor(private readonly loja: LojaService) {}

  @Get('pedido/:codigo')
  @Publico()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  acompanhar(@Param('codigo') codigo: string) {
    return this.loja.acompanhar(codigo);
  }

  @Post('pedido/:codigo/resposta')
  @Publico()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  responder(@Param('codigo') codigo: string, @Body() dto: RespostaPropostaDto) {
    return this.loja.responder(codigo, dto.versao, dto.aceita);
  }

  @Post('pedido/:codigo/cancelar')
  @Publico()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  cancelar(@Param('codigo') codigo: string, @Body() dto: CancelarPeloClienteDto) {
    return this.loja.decisaoDoCliente(codigo, 'cancelar', dto.motivo);
  }

  @Post('pedido/:codigo/recebido')
  @Publico()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  recebido(@Param('codigo') codigo: string) {
    return this.loja.decisaoDoCliente(codigo, 'confirmar');
  }

  @Get(':codigo')
  @Publico()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  catalogo(@Param('codigo') codigo: string) {
    return this.loja.catalogo(codigo);
  }

  @Get(':codigo/cep/:cep')
  @Publico()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  cep(@Param('codigo') codigo: string, @Param('cep') cep: string) {
    return this.loja.cep(codigo, cep);
  }

  @Post(':codigo/pedidos')
  @Publico()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  criar(@Param('codigo') codigo: string, @Body() dto: NovoPedidoDto, @Req() req: Request) {
    return this.loja.criar(codigo, dto, req.ip ?? '');
  }
}
