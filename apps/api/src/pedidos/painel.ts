import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  blocosDaFolha,
  CONFIG_PEDIDOS_PADRAO,
  diferencasDaPropostaPedido,
  faixasDeAgendamento,
  folhaEscPos,
  horarioVazio,
  LIMITE_MENSAGEM_PROPOSTA,
  LIMITE_MOTIVO_CANCELAMENTO,
  MODALIDADES_ENTREGA,
  podeMudarSituacao,
  problemaNaProposta,
  rotuloSituacaoPedido,
  SITUACOES_PEDIDO,
  observacaoLimpa,
  situacaoFinal,
  totaisDaProposta,
  totaisDoPedido,
  unidadesDe,
  type BlocoFolha,
  type ConfigPedidos,
  type EnderecoPedido,
  type EstadoPedido,
  type EventoPedido,
  type FaixaAgendamento,
  type FiltroPedidos,
  type FormaPagamento,
  type HorarioFuncionamento,
  type ItemConferido,
  type ModalidadeEntrega,
  type PedidoCompleto,
  type PedidoResumo,
  type PropostaPedido,
  type SituacaoPedido,
  type TrabalhoResumo,
} from '@etiquetas/shared';
import { EmpresaAtual, PermitidoNoApp, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { config } from '../config';
import { agoraNoFuso } from '../consultas/consultas.service';
import { decifrar } from '../cripto';
import { TrabalhosService } from '../impressao/trabalhos.service';
import { PrismaService } from '../prisma/prisma.service';
import { horaLocal } from '../telas/hora';

class MudarSituacaoDto {
  @IsIn(SITUACOES_PEDIDO, { message: 'Situação desconhecida.' })
  situacao: SituacaoPedido;

  @IsOptional()
  @IsString()
  @MaxLength(LIMITE_MOTIVO_CANCELAMENTO)
  motivo?: string;
}

class PropostaDto implements PropostaPedido {
  @IsArray()
  itens: { codigo: string; quantidade: number }[];

  @IsIn(MODALIDADES_ENTREGA, { message: 'Forma de entrega desconhecida.' })
  modalidade: ModalidadeEntrega;

  @IsInt({ message: 'Taxa de entrega inválida.' })
  taxaCentavos: number;

  @IsInt({ message: 'Desconto inválido.' })
  descontoCentavos: number;

  @IsOptional()
  @IsObject()
  agendamento: FaixaAgendamento | null;

  @IsString()
  @MaxLength(LIMITE_MENSAGEM_PROPOSTA)
  mensagem: string;
}

type PropostaGuardada = PropostaPedido & { autorNome: string | null };

const LIMITE_LISTA = 300;

const dataHoraLocal = (d: Date) => {
  const [data, hora] = agoraNoFuso(d, config().fusoHorario).dataHora.split(' ');
  const [a, m, dia] = data.split('-');
  return `${dia}/${m}/${a} ${hora.slice(0, 5)}`;
};

const evento = (texto: string, por: string | null): EventoPedido => ({ em: new Date().toISOString(), texto, por });

const SELECAO = {
  id: true,
  numero: true,
  situacao: true,
  criadoEm: true,
  atualizadoEm: true,
  clienteNome: true,
  clienteTelefone: true,
  endereco: true,
  modalidade: true,
  agendamento: true,
  pagamento: true,
  trocoParaCentavos: true,
  observacao: true,
  itens: true,
  taxaCentavos: true,
  descontoCentavos: true,
  totalCentavos: true,
  codigoCifrado: true,
  proposta: true,
  propostaEm: true,
  respostaProposta: true,
  motivoCancelamento: true,
  historico: true,
  aceitoPorId: true,
  aceitoPor: { select: { nome: true, codigoErp: true } },
} satisfies Prisma.PedidoSelect;

class RespostaItemDto {
  @IsString()
  @MaxLength(100)
  codigo: string;

  @IsString()
  @MaxLength(1000)
  resposta: string;
}

type PedidoLido = Prisma.PedidoGetPayload<{ select: typeof SELECAO }>;

export function estadoDe(p: Pick<PedidoLido, 'itens' | 'modalidade' | 'taxaCentavos' | 'descontoCentavos' | 'agendamento' | 'endereco' | 'trocoParaCentavos'>): EstadoPedido {
  return {
    itens: p.itens as unknown as ItemConferido[],
    modalidade: p.modalidade as ModalidadeEntrega,
    taxaCentavos: p.taxaCentavos,
    descontoCentavos: p.descontoCentavos,
    agendamento: (p.agendamento as unknown as FaixaAgendamento | null) ?? null,
    temEndereco: !!p.endereco,
    trocoParaCentavos: p.trocoParaCentavos,
  };
}

@Injectable()
export class PainelPedidosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly trabalhos: TrabalhosService,
  ) {}

  async listar(empresaId: string, f: FiltroPedidos): Promise<PedidoResumo[]> {
    const where: Prisma.PedidoWhereInput = { empresaId };
    if (f.situacao === 'ABERTOS') where.situacao = { notIn: ['CONCLUIDO', 'CANCELADO'] };
    else if (f.situacao && (SITUACOES_PEDIDO as readonly string[]).includes(f.situacao)) where.situacao = f.situacao;
    const fuso = config().fusoHorario;
    const dia = (d: string, fim: boolean) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(new Date(`${d}T${fim ? '23:59:59.999' : '00:00:00'}Z`).getTime() - deslocamento(fuso, d)) : undefined);
    if (f.de || f.ate) where.criadoEm = { ...(f.de ? { gte: dia(f.de, false) } : {}), ...(f.ate ? { lte: dia(f.ate, true) } : {}) };
    const busca = f.busca?.trim();
    if (busca) {
      const digitos = busca.replace(/\D/g, '');
      where.OR = [{ clienteNome: { contains: busca, mode: 'insensitive' } }, ...(digitos ? [{ clienteTelefone: { contains: digitos } }] : []), ...(/^\d{1,9}$/.test(busca) ? [{ numero: Number(busca) }] : [])];
    }
    const lista = await this.prisma.pedido.findMany({
      where,
      orderBy: { criadoEm: 'desc' },
      take: LIMITE_LISTA,
      select: { id: true, numero: true, situacao: true, criadoEm: true, clienteNome: true, modalidade: true, agendamento: true, totalCentavos: true, itens: true, propostaEm: true },
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
    }));
  }

  private async ler(empresaId: string, id: string): Promise<PedidoLido> {
    const p = await this.prisma.pedido.findFirst({ where: { id, empresaId }, select: SELECAO });
    if (!p) throw new NotFoundException('Pedido não encontrado.');
    return p;
  }

  private async faixas(empresaId: string): Promise<FaixaAgendamento[]> {
    const [c, e] = await Promise.all([
      this.prisma.configuracaoPedidos.findUnique({ where: { empresaId }, select: { config: true } }),
      this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { horarioFuncionamento: true } }),
    ]);
    const cfg: ConfigPedidos = { ...CONFIG_PEDIDOS_PADRAO, ...(c?.config as unknown as ConfigPedidos) };
    const agora = new Date();
    const fuso = config().fusoHorario;
    return faixasDeAgendamento((e?.horarioFuncionamento as HorarioFuncionamento | null) ?? horarioVazio(), agoraNoFuso(agora, fuso).data, horaLocal(agora, fuso), cfg.agendamento);
  }

  async obter(empresaId: string, id: string): Promise<PedidoCompleto> {
    const p = await this.ler(empresaId, id);
    const itens = p.itens as unknown as ItemConferido[];
    const estado = estadoDe(p);
    const empresa = await this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { nomeFantasia: true, razaoSocial: true } });
    const proposta = p.proposta && p.propostaEm ? (p.proposta as unknown as PropostaGuardada) : null;
    return {
      empresa: empresa?.nomeFantasia || empresa?.razaoSocial || '',
      id: p.id,
      numero: p.numero,
      situacao: p.situacao as SituacaoPedido,
      criadoEm: p.criadoEm.toISOString(),
      clienteNome: p.clienteNome,
      clienteTelefone: p.clienteTelefone,
      endereco: (p.endereco as unknown as EnderecoPedido | null) ?? null,
      modalidade: estado.modalidade,
      agendamento: estado.agendamento,
      pagamento: p.pagamento as FormaPagamento,
      trocoParaCentavos: p.trocoParaCentavos,
      observacao: p.observacao,
      itens,
      totalCentavos: p.totalCentavos,
      unidades: unidadesDe(itens),
      totais: totaisDoPedido(itens, p.taxaCentavos, p.trocoParaCentavos, p.descontoCentavos),
      codigoAcompanhamento: decifrar(p.codigoCifrado, config().chaveCriptografia),
      aceitoPorNome: p.aceitoPor?.nome ?? null,
      aguardandoCliente: !!proposta,
      proposta: proposta ? { ...proposta, versao: p.propostaEm!.toISOString(), diferencas: diferencasDaPropostaPedido(estado, proposta), totais: totaisDaProposta(estado, proposta) } : null,
      respostaProposta: (p.respostaProposta as { aceita: boolean; em: string } | null) ?? null,
      motivoCancelamento: p.motivoCancelamento,
      historico: (p.historico as unknown as EventoPedido[]) ?? [],
      faixas: situacaoFinal(p.situacao as SituacaoPedido) ? [] : await this.faixas(empresaId),
    };
  }

  private async nomeDe(usuarioId: string): Promise<string | null> {
    return (await this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: { nome: true } }))?.nome ?? null;
  }

  /** Trava otimista: só grava sobre a versão lida. Dois atendentes no mesmo pedido não se atropelam. */
  private async gravar(p: PedidoLido, empresaId: string, data: Prisma.PedidoUpdateManyMutationInput & { aceitoPorId?: string }) {
    const { count } = await this.prisma.pedido.updateMany({ where: { id: p.id, empresaId, atualizadoEm: p.atualizadoEm }, data });
    if (count === 0) throw new ConflictException('O pedido mudou enquanto você mexia nele. Confira de novo.');
  }

  async mudarSituacao(empresaId: string, id: string, dto: MudarSituacaoDto, usuario: UsuarioRequisicao): Promise<PedidoCompleto> {
    const p = await this.ler(empresaId, id);
    const de = p.situacao as SituacaoPedido;
    if (!podeMudarSituacao(de, dto.situacao)) throw new BadRequestException(situacaoFinal(de) ? 'Este pedido já terminou.' : 'Não dá para pular etapas.');
    if (dto.situacao !== 'CANCELADO' && p.propostaEm) throw new BadRequestException('Há uma alteração esperando o cliente: espere a resposta ou desista dela.');
    const nome = await this.nomeDe(usuario.id);
    const modalidade = p.modalidade as ModalidadeEntrega;
    const motivo = dto.situacao === 'CANCELADO' ? dto.motivo?.trim() || null : null;
    const texto = dto.situacao === 'CANCELADO' ? `Cancelado${motivo ? `: ${motivo}` : ''}` : rotuloSituacaoPedido(dto.situacao, modalidade);
    await this.gravar(p, empresaId, {
      situacao: dto.situacao,
      ...(dto.situacao === 'EM_SEPARACAO' ? { aceitoPorId: usuario.id, aceitoEm: new Date() } : {}),
      ...(dto.situacao === 'CANCELADO' ? { motivoCancelamento: motivo, proposta: Prisma.DbNull, propostaEm: null } : {}),
      historico: [...((p.historico as unknown as EventoPedido[]) ?? []), evento(texto, nome)] as unknown as Prisma.InputJsonValue,
    });
    await this.auditoria.registrar({ empresaId, usuarioId: usuario.id, acao: 'pedido.situacao', entidade: 'Pedido', entidadeId: id, detalhes: { numero: p.numero, de, para: dto.situacao, ...(motivo ? { motivo } : {}) } });
    return this.obter(empresaId, id);
  }

  async propor(empresaId: string, id: string, dto: PropostaDto, usuario: UsuarioRequisicao): Promise<PedidoCompleto> {
    const p = await this.ler(empresaId, id);
    if (situacaoFinal(p.situacao as SituacaoPedido)) throw new BadRequestException('Este pedido já terminou.');
    const proposta: PropostaPedido = {
      itens: (Array.isArray(dto.itens) ? dto.itens : []).map((i) => ({ codigo: String(i?.codigo ?? ''), quantidade: Number(i?.quantidade) })),
      modalidade: dto.modalidade,
      taxaCentavos: dto.taxaCentavos,
      descontoCentavos: dto.descontoCentavos,
      agendamento: dto.modalidade === 'AGENDADA' && dto.agendamento ? { data: String(dto.agendamento.data), inicio: String(dto.agendamento.inicio), fim: String(dto.agendamento.fim) } : null,
      mensagem: dto.mensagem.trim(),
    };
    const estado = estadoDe(p);
    const problema = problemaNaProposta(estado, proposta, await this.faixas(empresaId));
    if (problema) throw new BadRequestException(problema);
    const nome = await this.nomeDe(usuario.id);
    const guardada: PropostaGuardada = { ...proposta, autorNome: nome };
    await this.gravar(p, empresaId, {
      proposta: guardada as unknown as Prisma.InputJsonValue,
      propostaEm: new Date(),
      historico: [...((p.historico as unknown as EventoPedido[]) ?? []), evento(`Alteração enviada ao cliente: ${diferencasDaPropostaPedido(estado, proposta).join('; ')}`, nome)] as unknown as Prisma.InputJsonValue,
    });
    await this.auditoria.registrar({ empresaId, usuarioId: usuario.id, acao: 'pedido.propor', entidade: 'Pedido', entidadeId: id, detalhes: { numero: p.numero, mudancas: diferencasDaPropostaPedido(estado, proposta) } });
    return this.obter(empresaId, id);
  }

  /** Resposta da loja à observação do cliente sobre um produto. Vazia apaga. Aparece no acompanhamento. */
  async responderItem(empresaId: string, id: string, dto: RespostaItemDto, usuario: UsuarioRequisicao): Promise<PedidoCompleto> {
    const p = await this.ler(empresaId, id);
    if (situacaoFinal(p.situacao as SituacaoPedido)) throw new BadRequestException('Este pedido já terminou.');
    const itens = p.itens as unknown as ItemConferido[];
    const item = itens.find((i) => i.codigo === dto.codigo);
    if (!item) throw new BadRequestException('Este produto não está no pedido.');
    const resposta = observacaoLimpa(dto.resposta);
    if ((item.resposta ?? undefined) === resposta) return this.obter(empresaId, id);
    const novos = itens.map((i) => {
      if (i.codigo !== dto.codigo) return i;
      const { resposta: _antiga, ...resto } = i;
      return resposta ? { ...resto, resposta } : resto;
    });
    const nome = await this.nomeDe(usuario.id);
    await this.gravar(p, empresaId, {
      itens: novos as unknown as Prisma.InputJsonValue,
      historico: [...((p.historico as unknown as EventoPedido[]) ?? []), evento(resposta ? `Resposta sobre ${item.nome}: ${resposta}` : `Resposta sobre ${item.nome} apagada`, nome)] as unknown as Prisma.InputJsonValue,
    });
    await this.auditoria.registrar({ empresaId, usuarioId: usuario.id, acao: 'pedido.responder_item', entidade: 'Pedido', entidadeId: id, detalhes: { numero: p.numero, codigo: item.codigo } });
    return this.obter(empresaId, id);
  }

  async desistirDaProposta(empresaId: string, id: string, usuario: UsuarioRequisicao): Promise<PedidoCompleto> {
    const p = await this.ler(empresaId, id);
    if (!p.propostaEm) throw new BadRequestException('Não há alteração esperando o cliente.');
    const nome = await this.nomeDe(usuario.id);
    await this.gravar(p, empresaId, {
      proposta: Prisma.DbNull,
      propostaEm: null,
      historico: [...((p.historico as unknown as EventoPedido[]) ?? []), evento('A loja desistiu da alteração', nome)] as unknown as Prisma.InputJsonValue,
    });
    await this.auditoria.registrar({ empresaId, usuarioId: usuario.id, acao: 'pedido.desistir_proposta', entidade: 'Pedido', entidadeId: id, detalhes: { numero: p.numero } });
    return this.obter(empresaId, id);
  }

  /** A folha de quem aceitou o pedido: é o código dele que o ERP precisa receber. */
  private async dadosDaFolha(empresaId: string, p: PedidoLido) {
    if (p.situacao === 'NOVO') throw new BadRequestException('Aceite o pedido antes de imprimir a folha.');
    if (p.situacao === 'CANCELADO') throw new BadRequestException('Pedido cancelado não tem folha.');
    if (!p.aceitoPor) throw new BadRequestException('Quem aceitou este pedido não está mais no sistema.');
    if (!p.aceitoPor.codigoErp?.trim()) throw new BadRequestException(`Cadastre o Código no ERP de ${p.aceitoPor.nome} em Usuários para imprimir a folha.`);
    const empresa = await this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { nomeFantasia: true, razaoSocial: true } });
    const itens = p.itens as unknown as ItemConferido[];
    return blocosDaFolha({
      empresa: empresa?.nomeFantasia || empresa?.razaoSocial || '',
      numero: p.numero,
      quando: dataHoraLocal(p.criadoEm),
      clienteNome: p.clienteNome,
      clienteTelefone: p.clienteTelefone,
      modalidade: p.modalidade as ModalidadeEntrega,
      agendamento: (p.agendamento as unknown as FaixaAgendamento | null) ?? null,
      endereco: p.modalidade === 'RETIRADA' ? null : ((p.endereco as unknown as EnderecoPedido | null) ?? null),
      pagamento: p.pagamento as FormaPagamento,
      trocoParaCentavos: p.trocoParaCentavos,
      observacao: p.observacao,
      atendente: { codigo: p.aceitoPor.codigoErp.trim(), nome: p.aceitoPor.nome },
      itens,
      totais: totaisDoPedido(itens, p.taxaCentavos, p.trocoParaCentavos, p.descontoCentavos),
    });
  }

  async previaFolha(empresaId: string, id: string): Promise<{ blocos: BlocoFolha[]; avisos: string[]; impressora: string | null }> {
    const p = await this.ler(empresaId, id);
    const folha = await this.dadosDaFolha(empresaId, p);
    const impressora = await this.impressoraDaFolha(empresaId).catch(() => null);
    return { ...folha, impressora: impressora?.nome ?? null };
  }

  private async impressoraDaFolha(empresaId: string) {
    const c = await this.prisma.configuracaoPedidos.findUnique({ where: { empresaId }, select: { config: true } });
    const id = (c?.config as unknown as ConfigPedidos | undefined)?.impressoraFolhaId;
    if (!id) throw new BadRequestException('Escolha a impressora da folha em Pedidos > Configuração.');
    const impressora = await this.prisma.impressora.findFirst({ where: { id, empresaId, ativo: true, linguagem: 'ESCPOS' }, select: { id: true, nome: true, linguagem: true } });
    if (!impressora) throw new BadRequestException('A impressora da folha foi excluída ou desativada: escolha outra em Pedidos > Configuração.');
    return impressora;
  }

  async imprimirFolha(empresaId: string, id: string, usuario: UsuarioRequisicao): Promise<{ trabalho: TrabalhoResumo; avisos: string[] }> {
    const p = await this.ler(empresaId, id);
    const { blocos, avisos } = await this.dadosDaFolha(empresaId, p);
    const impressora = await this.impressoraDaFolha(empresaId);
    const trabalho = await this.trabalhos.criarPronto(empresaId, usuario.id, {
      impressora,
      nome: `Pedido ${p.numero}`,
      conteudo: folhaEscPos(blocos),
      origem: 'PEDIDO',
      quantidade: 1,
      detalhes: { pedido: p.numero },
    });
    const nome = await this.nomeDe(usuario.id);
    await this.prisma.pedido.updateMany({ where: { id, empresaId }, data: { historico: [...((p.historico as unknown as EventoPedido[]) ?? []), evento(`Folha de lançamento enviada para ${impressora.nome}`, nome)] as unknown as Prisma.InputJsonValue } });
    return { trabalho, avisos };
  }
}

/** Diferença do fuso para o UTC naquele dia, em ms (o Brasil não tem horário de verão, mas o servidor pode estar em outro fuso). */
function deslocamento(fuso: string, dia: string): number {
  const meioDia = new Date(`${dia}T12:00:00Z`);
  const [d, h] = agoraNoFuso(meioDia, fuso).dataHora.split(' ');
  return new Date(`${d}T${h}Z`).getTime() - meioDia.getTime();
}

@Controller('pedidos')
export class PainelPedidosController {
  constructor(private readonly painel: PainelPedidosService) {}

  @Get()
  @PermitidoNoApp()
  @RequerPermissao('pedido.ver')
  listar(@EmpresaAtual() empresaId: string, @Query('situacao') situacao?: string, @Query('de') de?: string, @Query('ate') ate?: string, @Query('busca') busca?: string) {
    return this.painel.listar(empresaId, { situacao: situacao as FiltroPedidos['situacao'], de, ate, busca: busca?.slice(0, 80) });
  }

  @Get(':id')
  @PermitidoNoApp()
  @RequerPermissao('pedido.ver')
  obter(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.painel.obter(empresaId, id);
  }

  @Post(':id/situacao')
  @PermitidoNoApp()
  @RequerPermissao('pedido.gerenciar')
  situacao(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MudarSituacaoDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.painel.mudarSituacao(empresaId, id, dto, u);
  }

  @Post(':id/proposta')
  @RequerPermissao('pedido.gerenciar')
  propor(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PropostaDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.painel.propor(empresaId, id, dto, u);
  }

  @Post(':id/itens/resposta')
  @PermitidoNoApp()
  @RequerPermissao('pedido.gerenciar')
  responder(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespostaItemDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.painel.responderItem(empresaId, id, dto, u);
  }

  @Post(':id/proposta/desistir')
  @PermitidoNoApp()
  @RequerPermissao('pedido.gerenciar')
  desistir(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.painel.desistirDaProposta(empresaId, id, u);
  }

  @Get(':id/folha')
  @PermitidoNoApp()
  @RequerPermissao('pedido.ver')
  folha(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.painel.previaFolha(empresaId, id);
  }

  @Post(':id/folha/imprimir')
  @PermitidoNoApp()
  @RequerPermissao('pedido.gerenciar')
  imprimir(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.painel.imprimirFolha(empresaId, id, u);
  }
}
