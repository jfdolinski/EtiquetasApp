import { randomBytes } from 'node:crypto';
import { BadRequestException, Body, Controller, Get, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Post, Put } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsUUID } from 'class-validator';
import {
  CONFIG_PEDIDOS_PADRAO,
  horarioVazio,
  itensDoCatalogo,
  linhasParaRegistros,
  MODALIDADES_ENTREGA,
  problemaNaConfigPedidos,
  problemaNoHorario,
  problemaNosPrazosPedidos,
  registroBanido,
  situacaoDoCatalogo,
  type CampoDinamico,
  type ColunasCatalogo,
  type ConfigPedidos,
  type ConfiguracaoPedidosResumo,
  type ConsultaParaPedidos,
  type HorarioFuncionamento,
  type ItemCatalogo,
  type ItemConteudoTela,
  type PreviaCatalogo,
} from '@etiquetas/shared';
import { empresaBloqueada } from '../auth/acesso-empresa';
import { EmpresaAtual, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { BanidosService } from '../banidos/banidos.service';
import { ConsultasService } from '../consultas/consultas.service';
import { pedeParametros } from '../impressao/agendamentos.service';
import { PrismaService } from '../prisma/prisma.service';
import { FotosProdutoTelaService } from '../telas/fotos';

const INTERVALO_VERIFICACAO_MS = 30_000;
const MAX_POR_VERIFICACAO = 20;
/** Empresa bloqueada não consulta o banco dela; volta a tentar de tempos em tempos. */
const ESPERA_BLOQUEADA_MS = 10 * 60_000;
/** A consulta pode trazer mais linhas que produtos: sem estoque, sem preço, repetidos. */
const LIMITE_LINHAS_CATALOGO = 20_000;
const ITENS_NA_PREVIA = 30;

class SalvarConfiguracaoPedidosDto {
  @IsBoolean()
  ativo: boolean;

  @IsUUID('all', { message: 'Escolha a consulta.' })
  consultaId: string;

  @IsObject()
  config: ConfigPedidos;

  @IsInt()
  intervaloMinutos: number;

  @IsInt()
  validadeMinutos: number;

  @IsArray()
  horario: HorarioFuncionamento;
}

class PreviaCatalogoDto {
  @IsUUID('all', { message: 'Escolha a consulta.' })
  consultaId: string;

  @IsOptional()
  @IsObject()
  colunas?: Partial<ColunasCatalogo>;
}

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const coluna = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);

/** Só os campos conhecidos: o JSON do navegador não decide o que fica guardado. */
function configLimpa(c: Partial<ConfigPedidos>): ConfigPedidos {
  const modalidades = Object.fromEntries(
    MODALIDADES_ENTREGA.map((m) => {
      const x = (c.modalidades ?? {})[m] as Partial<ConfigPedidos['modalidades'][typeof m]> | undefined;
      return [m, { ativa: x?.ativa === true, precoCentavos: x?.precoCentavos as number }];
    }),
  ) as ConfigPedidos['modalidades'];
  return {
    colunaCodigo: coluna(c.colunaCodigo) ?? '',
    colunaNome: coluna(c.colunaNome) ?? '',
    colunaPreco: coluna(c.colunaPreco) ?? '',
    colunaPrecoDe: coluna(c.colunaPrecoDe),
    colunaUnidade: coluna(c.colunaUnidade),
    colunaCategoria: coluna(c.colunaCategoria),
    colunaEstoque: coluna(c.colunaEstoque),
    colunaCodigoBarras: coluna(c.colunaCodigoBarras),
    comFotos: c.comFotos === true,
    pedidoMinimoCentavos: c.pedidoMinimoCentavos === null || c.pedidoMinimoCentavos === undefined ? null : (c.pedidoMinimoCentavos as number),
    modalidades,
    mensagem: texto(c.mensagem, 1000),
    enderecoRetirada: texto(c.enderecoRetirada, 1000),
  };
}

const horarioLimpo = (h: HorarioFuncionamento): HorarioFuncionamento => h.map((dia) => dia.map((p) => ({ inicio: p.inicio, fim: p.fim })));

/** Curto o bastante para digitar, longo o bastante para não adivinhar: 72 bits. */
const novoCodigoLink = () => randomBytes(9).toString('base64url');

@Injectable()
export class ConfiguracaoPedidosService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('CatalogoPedidos');
  private relogio?: NodeJS.Timeout;
  private verificando = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly consultas: ConsultasService,
    private readonly banidos: BanidosService,
    private readonly fotos: FotosProdutoTelaService,
  ) {}

  onApplicationBootstrap() {
    this.relogio = setInterval(() => void this.verificar(), INTERVALO_VERIFICACAO_MS);
    this.relogio.unref();
  }

  onModuleDestroy() {
    clearInterval(this.relogio);
  }

  // Configuração ---------------------------------------------------------------------------

  async obter(empresaId: string, agora = new Date()): Promise<ConfiguracaoPedidosResumo> {
    const [c, empresa] = await Promise.all([
      this.prisma.configuracaoPedidos.findUnique({
        where: { empresaId },
        select: { codigoLink: true, ativo: true, consultaId: true, config: true, intervaloMinutos: true, validadeMinutos: true, quantidadeItens: true, dadosEm: true, erro: true, consulta: { select: { nome: true } }, responsavel: { select: { nome: true } } },
      }),
      this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { horarioFuncionamento: true } }),
    ]);
    const horario = (empresa?.horarioFuncionamento as HorarioFuncionamento | null) ?? horarioVazio();
    if (!c) {
      return { codigoLink: null, ativo: false, consultaId: null, consultaNome: null, config: CONFIG_PEDIDOS_PADRAO, intervaloMinutos: 15, validadeMinutos: 120, horario, situacao: 'DESLIGADO', quantidadeItens: 0, dadosEm: null, erro: null, responsavelNome: null };
    }
    return {
      codigoLink: c.codigoLink,
      ativo: c.ativo,
      consultaId: c.consultaId,
      consultaNome: c.consulta?.nome ?? null,
      config: { ...CONFIG_PEDIDOS_PADRAO, ...(c.config as unknown as ConfigPedidos) },
      intervaloMinutos: c.intervaloMinutos,
      validadeMinutos: c.validadeMinutos,
      horario,
      situacao: situacaoDoCatalogo(c, agora),
      quantidadeItens: c.quantidadeItens,
      dadosEm: c.dadosEm?.toISOString() ?? null,
      erro: c.erro,
      responsavelNome: c.responsavel?.nome ?? null,
    };
  }

  async consultasDisponiveis(empresaId: string): Promise<ConsultaParaPedidos[]> {
    const lista = await this.prisma.consultaSql.findMany({
      where: { empresaId, ativo: true },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true, sql: true, campos: true, conexao: { select: { tipo: true } } },
    });
    return lista.map((c) => ({ id: c.id, nome: c.nome, colunas: ((c.campos ?? []) as unknown as CampoDinamico[]).map((x) => x.nome), pedeParametro: pedeParametros(c as never) }));
  }

  private async consultaUtil(empresaId: string, consultaId: string) {
    const consulta = await this.prisma.consultaSql.findFirst({ where: { id: consultaId, empresaId, ativo: true }, select: { id: true, sql: true, campos: true, conexao: { select: { tipo: true } } } });
    if (!consulta) throw new BadRequestException('Consulta não encontrada ou desativada.');
    if (pedeParametros(consulta as never)) throw new BadRequestException('Esta consulta pede valores digitados ({param.*}), como uma busca: ela não roda sozinha. Use uma consulta que traga a lista de produtos.');
    return consulta;
  }

  async salvar(empresaId: string, dto: SalvarConfiguracaoPedidosDto, usuarioId: string): Promise<ConfiguracaoPedidosResumo> {
    const config = configLimpa(dto.config ?? {});
    const problema = problemaNaConfigPedidos(config) ?? problemaNosPrazosPedidos(dto.intervaloMinutos, dto.validadeMinutos) ?? problemaNoHorario(dto.horario);
    if (problema) throw new BadRequestException(problema);
    const consulta = await this.consultaUtil(empresaId, dto.consultaId);
    // Sem colunas lidas (agente desligado ao salvar a consulta) não dá para conferir: a atualização avisa.
    const colunas = ((consulta.campos ?? []) as unknown as CampoDinamico[]).map((c) => c.nome.toLowerCase());
    if (colunas.length) {
      for (const col of [config.colunaCodigo, config.colunaNome, config.colunaPreco, config.colunaPrecoDe, config.colunaUnidade, config.colunaCategoria, config.colunaEstoque, config.colunaCodigoBarras]) {
        if (col && !colunas.includes(col.toLowerCase())) throw new BadRequestException(`A consulta não tem a coluna “${col}”.`);
      }
    }
    const horario = horarioLimpo(dto.horario);
    const dados = {
      ativo: dto.ativo,
      consultaId: dto.consultaId,
      config: config as unknown as Prisma.InputJsonValue,
      intervaloMinutos: dto.intervaloMinutos,
      validadeMinutos: dto.validadeMinutos,
      responsavelId: usuarioId,
      // Ligado, atualiza já: mudou a consulta ou as colunas, a cópia antiga não vale mais.
      proximaAtualizacaoEm: dto.ativo ? new Date(Date.now() + dto.intervaloMinutos * 60_000) : null,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.configuracaoPedidos.upsert({ where: { empresaId }, create: { empresaId, codigoLink: novoCodigoLink(), ...dados }, update: dados });
      await tx.empresa.update({ where: { id: empresaId }, data: { horarioFuncionamento: horario as unknown as Prisma.InputJsonValue } });
      await this.auditoria.registrar({ empresaId, usuarioId, acao: 'pedido.configurar', entidade: 'ConfiguracaoPedidos', entidadeId: empresaId, detalhes: { ativo: dto.ativo, consultaId: dto.consultaId } }, tx);
    });
    if (dto.ativo) await this.atualizarDados(empresaId);
    return this.obter(empresaId);
  }

  /** O link antigo deixa de abrir na hora: serve para quando ele foi parar onde não devia. */
  async novoLink(empresaId: string, usuarioId: string): Promise<ConfiguracaoPedidosResumo> {
    const { count } = await this.prisma.configuracaoPedidos.updateMany({ where: { empresaId }, data: { codigoLink: novoCodigoLink() } });
    if (count === 0) throw new BadRequestException('Salve a configuração antes de gerar o link.');
    await this.auditoria.registrar({ empresaId, usuarioId, acao: 'pedido.novo_link', entidade: 'ConfiguracaoPedidos', entidadeId: empresaId });
    return this.obter(empresaId);
  }

  async atualizarAgora(empresaId: string): Promise<ConfiguracaoPedidosResumo> {
    const c = await this.prisma.configuracaoPedidos.findUnique({ where: { empresaId }, select: { ativo: true } });
    if (!c?.ativo) throw new BadRequestException('Ligue o catálogo para atualizar os produtos.');
    await this.atualizarDados(empresaId);
    return this.obter(empresaId);
  }

  async previa(empresaId: string, dto: PreviaCatalogoDto, usuarioId: string): Promise<PreviaCatalogo> {
    await this.consultaUtil(empresaId, dto.consultaId);
    const r = await this.consultas.executar(empresaId, dto.consultaId, usuarioId, {}, LIMITE_LINHAS_CATALOGO);
    const banidos = await this.banidos.conjunto(empresaId);
    const todos = linhasParaRegistros(r.colunas, r.linhas);
    const registros = todos.filter((x) => !registroBanido(x, banidos));
    const colunas = r.colunas.map((c) => c.nome);
    const col = configLimpa((dto.colunas ?? {}) as Partial<ConfigPedidos>);
    const pronto = col.colunaCodigo && col.colunaNome && col.colunaPreco;
    const resultado = pronto ? itensDoCatalogo(registros, col) : { itens: [], descartados: 0, semEstoque: 0, repetidos: 0, cortados: 0 };
    return { ...resultado, itens: resultado.itens.slice(0, ITENS_NA_PREVIA), total: resultado.itens.length, colunas, banidos: todos.length - registros.length };
  }

  // Cópia dos produtos ---------------------------------------------------------------------

  /** Reivindica com `updateMany` no horário antigo: uma atualização por vez de cada catálogo. */
  async verificar(agora = new Date()) {
    if (this.verificando) return;
    this.verificando = true;
    try {
      const vencidos = await this.prisma.configuracaoPedidos.findMany({
        where: { ativo: true, proximaAtualizacaoEm: { lte: agora } },
        orderBy: { proximaAtualizacaoEm: 'asc' },
        take: MAX_POR_VERIFICACAO,
        select: { empresaId: true, proximaAtualizacaoEm: true, intervaloMinutos: true, empresa: { select: { ativa: true, statusAssinatura: true } } },
      });
      for (const c of vencidos) {
        const vale = !empresaBloqueada(c.empresa);
        const proxima = new Date(agora.getTime() + (vale ? c.intervaloMinutos * 60_000 : ESPERA_BLOQUEADA_MS));
        const { count } = await this.prisma.configuracaoPedidos.updateMany({ where: { empresaId: c.empresaId, proximaAtualizacaoEm: c.proximaAtualizacaoEm }, data: { proximaAtualizacaoEm: proxima } });
        if (count === 1 && vale) void this.atualizarDados(c.empresaId);
      }
    } catch (e) {
      this.log.error(`Verificação: ${(e as Error).message}`);
    } finally {
      this.verificando = false;
    }
  }

  /** Falhou: guarda o motivo e mantém a cópia anterior, que sai do ar ao vencer. */
  async atualizarDados(empresaId: string): Promise<void> {
    const c = await this.prisma.configuracaoPedidos.findUnique({ where: { empresaId }, select: { consultaId: true, config: true, responsavelId: true, responsavel: { select: { ativo: true } } } });
    if (!c) return;
    try {
      if (!c.consultaId) throw new Error('A consulta do catálogo foi excluída. Escolha outra.');
      if (!c.responsavelId || !c.responsavel?.ativo) throw new Error('O usuário responsável foi removido ou desativado: salve a configuração de novo.');
      const r = await this.consultas.executar(empresaId, c.consultaId, c.responsavelId, {}, LIMITE_LINHAS_CATALOGO);
      const banidos = await this.banidos.conjunto(empresaId);
      const registros = linhasParaRegistros(r.colunas, r.linhas).filter((x) => !registroBanido(x, banidos));
      const cfg = { ...CONFIG_PEDIDOS_PADRAO, ...(c.config as unknown as ConfigPedidos) };
      const { itens } = itensDoCatalogo(registros, cfg);
      // Sem nada aproveitável não é "produtos novos": apagar o catálogo por um erro de coluna seria pior que esperar a validade.
      if (itens.length === 0) throw new Error('A consulta não trouxe nenhum produto com código, nome, preço e estoque.');
      // O preço nunca espera a foto: entra com as já guardadas, e as outras chegam depois.
      const { itens: comFotos, faltam } = cfg.comFotos ? await this.comFotos(empresaId, itens) : { itens, faltam: [] as string[] };
      const dadosEm = new Date();
      await this.prisma.configuracaoPedidos.update({ where: { empresaId }, data: { itens: comFotos as unknown as Prisma.InputJsonValue, quantidadeItens: itens.length, dadosEm, erro: null } });
      if (faltam.length) void this.completarFotos(empresaId, faltam, dadosEm);
    } catch (e) {
      await this.prisma.configuracaoPedidos.updateMany({ where: { empresaId }, data: { erro: (e as Error).message.slice(0, 500) } }).catch(() => undefined);
    }
  }

  /** As fotos das telas: mesma guarda por código de barras, então cada busca no catálogo vale para os dois. */
  private async comFotos(empresaId: string, itens: ItemCatalogo[]) {
    const comoTela = itens.map((i): ItemConteudoTela => ({ nome: '', preco: '', ...(i.codigoBarras ? { codigo: i.codigoBarras } : {}) }));
    const { itens: achadas, faltam } = await this.fotos.aplicar(empresaId, comoTela);
    const novos = itens.map(({ foto: _antiga, ...i }, n): ItemCatalogo => (achadas[n].foto ? { ...i, foto: achadas[n].foto } : i));
    return { itens: novos, faltam };
  }

  /** Em segundo plano. Só grava se a cópia ainda é a mesma, e sem renovar `dadosEm`: foto não torna o preço mais novo. */
  async completarFotos(empresaId: string, codigos: string[], dadosEm: Date): Promise<void> {
    try {
      await this.fotos.buscar(empresaId, codigos);
      const atual = await this.prisma.configuracaoPedidos.findUnique({ where: { empresaId }, select: { itens: true, dadosEm: true } });
      if (!atual || atual.dadosEm?.getTime() !== dadosEm.getTime()) return;
      const antes = atual.itens as unknown as ItemCatalogo[];
      const { itens } = await this.comFotos(empresaId, antes);
      if (itens.every((item, i) => item.foto === antes[i].foto)) return;
      await this.prisma.configuracaoPedidos.updateMany({ where: { empresaId, dadosEm }, data: { itens: itens as unknown as Prisma.InputJsonValue } });
    } catch (e) {
      this.log.warn(`Fotos do catálogo ${empresaId}: ${(e as Error).message}`);
    }
  }
}

@Controller('pedidos/configuracao')
export class ConfiguracaoPedidosController {
  constructor(private readonly servico: ConfiguracaoPedidosService) {}

  @Get()
  @RequerPermissao('pedido.configurar')
  obter(@EmpresaAtual() empresaId: string) {
    return this.servico.obter(empresaId);
  }

  /** Sem exigir `sql.ver`: quem configura o catálogo escolhe a consulta sem ver o SQL. */
  @Get('consultas')
  @RequerPermissao('pedido.configurar')
  consultas(@EmpresaAtual() empresaId: string) {
    return this.servico.consultasDisponiveis(empresaId);
  }

  @Put()
  @RequerPermissao('pedido.configurar')
  salvar(@EmpresaAtual() empresaId: string, @Body() dto: SalvarConfiguracaoPedidosDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.servico.salvar(empresaId, dto, u.id);
  }

  @Post('previa')
  @RequerPermissao('pedido.configurar')
  previa(@EmpresaAtual() empresaId: string, @Body() dto: PreviaCatalogoDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.servico.previa(empresaId, dto, u.id);
  }

  @Post('novo-link')
  @RequerPermissao('pedido.configurar')
  novoLink(@EmpresaAtual() empresaId: string, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.servico.novoLink(empresaId, u.id);
  }

  @Post('atualizar')
  @RequerPermissao('pedido.configurar')
  atualizar(@EmpresaAtual() empresaId: string) {
    return this.servico.atualizarAgora(empresaId);
  }
}
