import {
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ConexaoBancoResumo, OpcoesConexao, ResultadoConsulta, ResultadoTesteConexao } from '@etiquetas/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { config } from '../config';
import { cifrar } from '../cripto';
import { ehViolacaoUnica } from '../prisma/erros';
import { PrismaService } from '../prisma/prisma.service';
import { AgentesGateway } from './agentes.gateway';
import type { AtualizarConexaoDto, ConsultarDto, CriarConexaoDto } from './dto';
import type { DadosConsultar, DadosTestarConexao } from './protocolo';
import { AgenteDesconectado, ErroDoAgente, TempoEsgotadoAgente } from './sessao-agente';

const TEMPO_LIMITE_PADRAO_S = 30;
const LIMITE_LINHAS_TESTE = 100;

const SELECAO = {
  id: true,
  agenteId: true,
  nome: true,
  tipo: true,
  host: true,
  porta: true,
  banco: true,
  usuario: true,
  senhaCifrada: true,
  opcoes: true,
  ativo: true,
  criadoEm: true,
} satisfies Prisma.ConexaoBancoSelect;

type ConexaoSelecionada = Prisma.ConexaoBancoGetPayload<{ select: typeof SELECAO }>;

/** Conexões com os bancos dos ERPs. Todo método recebe `empresaId` e filtra por ele. */
@Injectable()
export class ConexoesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly gateway: AgentesGateway,
  ) {}

  async listar(empresaId: string): Promise<ConexaoBancoResumo[]> {
    const conexoes = await this.prisma.conexaoBanco.findMany({ where: { empresaId }, orderBy: { nome: 'asc' }, select: SELECAO });
    return conexoes.map(resumo);
  }

  async criar(empresaId: string, dto: CriarConexaoDto, autorId: string): Promise<ConexaoBancoResumo> {
    await this.exigirAgenteDaEmpresa(empresaId, dto.agenteId);
    const { senha, opcoes, ...resto } = dto;
    try {
      const conexao = await this.prisma.conexaoBanco.create({
        data: {
          ...resto,
          empresaId,
          nome: dto.nome.trim(),
          host: dto.host.trim(),
          senhaCifrada: senha ? cifrar(senha, config().chaveCriptografia) : null,
          opcoes: limparOpcoes(opcoes),
        },
        select: SELECAO,
      });
      await this.auditoria.registrar({
        empresaId,
        usuarioId: autorId,
        acao: 'conexao.criar',
        entidade: 'ConexaoBanco',
        entidadeId: conexao.id,
        detalhes: { ...resto, opcoes: limparOpcoes(opcoes) },
      });
      void this.gateway.enviarConfiguracao(conexao.agenteId);
      return resumo(conexao);
    } catch (erro) {
      if (ehViolacaoUnica(erro)) throw new ConflictException('Já existe uma conexão com este nome.');
      throw erro;
    }
  }

  async atualizar(empresaId: string, id: string, dto: AtualizarConexaoDto, autorId: string): Promise<ConexaoBancoResumo> {
    const atual = await this.buscar(empresaId, id);
    if (dto.agenteId && dto.agenteId !== atual.agenteId) await this.exigirAgenteDaEmpresa(empresaId, dto.agenteId);

    const { senha, opcoes, ...resto } = dto;
    try {
      const conexao = await this.prisma.conexaoBanco.update({
        where: { id },
        data: {
          ...resto,
          nome: dto.nome?.trim(),
          host: dto.host?.trim(),
          senhaCifrada: senha === undefined ? undefined : senha ? cifrar(senha, config().chaveCriptografia) : null,
          opcoes: opcoes ? limparOpcoes(opcoes) : undefined,
        },
        select: SELECAO,
      });
      await this.auditoria.registrar({
        empresaId,
        usuarioId: autorId,
        acao: 'conexao.editar',
        entidade: 'ConexaoBanco',
        entidadeId: id,
        detalhes: { ...resto, opcoes: opcoes ? limparOpcoes(opcoes) : undefined, senhaAlterada: senha !== undefined },
      });
      void this.gateway.enviarConfiguracao(conexao.agenteId);
      if (conexao.agenteId !== atual.agenteId) void this.gateway.enviarConfiguracao(atual.agenteId);
      return resumo(conexao);
    } catch (erro) {
      if (ehViolacaoUnica(erro)) throw new ConflictException('Já existe uma conexão com este nome.');
      throw erro;
    }
  }

  async excluir(empresaId: string, id: string, autorId: string) {
    const atual = await this.buscar(empresaId, id);
    await this.prisma.conexaoBanco.delete({ where: { id } });
    await this.auditoria.registrar({
      empresaId,
      usuarioId: autorId,
      acao: 'conexao.excluir',
      entidade: 'ConexaoBanco',
      entidadeId: id,
      detalhes: { nome: atual.nome },
    });
    void this.gateway.enviarConfiguracao(atual.agenteId);
  }

  async testar(empresaId: string, id: string): Promise<ResultadoTesteConexao> {
    const conexao = await this.buscar(empresaId, id);
    return this.viaAgente(conexao, 'testar_conexao', { conexaoId: id } satisfies DadosTestarConexao, 20_000);
  }

  /** Executa um SQL de teste (somente leitura) no banco do cliente, via agente. */
  async consultar(empresaId: string, id: string, dto: ConsultarDto, autorId: string): Promise<ResultadoConsulta> {
    const conexao = await this.buscar(empresaId, id);
    const tempoLimiteSegundos = (conexao.opcoes as OpcoesConexao).tempoLimiteSegundos ?? TEMPO_LIMITE_PADRAO_S;
    const dados: DadosConsultar = {
      conexaoId: id,
      sql: dto.sql,
      parametros: [],
      limiteLinhas: dto.limiteLinhas ?? LIMITE_LINHAS_TESTE,
      tempoLimiteSegundos,
    };
    await this.auditoria.registrar({
      empresaId,
      usuarioId: autorId,
      acao: 'conexao.consultar',
      entidade: 'ConexaoBanco',
      entidadeId: id,
      detalhes: { sql: dto.sql.slice(0, 2000) },
    });
    // Margem para o agente devolver o erro de tempo esgotado do próprio banco.
    return this.viaAgente(conexao, 'consultar', dados, (tempoLimiteSegundos + 10) * 1000);
  }

  private async viaAgente<T>(conexao: ConexaoSelecionada, tipo: string, dados: unknown, tempoLimiteMs: number): Promise<T> {
    if (!conexao.ativo) throw new BadRequestException('Esta conexão está desativada.');
    try {
      return await this.gateway.sessao(conexao.agenteId).requisitar<T>(tipo, dados, tempoLimiteMs);
    } catch (erro) {
      if (erro instanceof AgenteDesconectado) {
        throw new ServiceUnavailableException('O agente desta conexão está offline. Verifique se ele está em execução.');
      }
      if (erro instanceof TempoEsgotadoAgente) throw new GatewayTimeoutException(erro.message);
      if (erro instanceof ErroDoAgente) throw new UnprocessableEntityException(erro.message);
      throw erro;
    }
  }

  private async buscar(empresaId: string, id: string) {
    const conexao = await this.prisma.conexaoBanco.findFirst({ where: { id, empresaId }, select: SELECAO });
    if (!conexao) throw new NotFoundException('Conexão não encontrada.');
    return conexao;
  }

  private async exigirAgenteDaEmpresa(empresaId: string, agenteId: string) {
    const agente = await this.prisma.agente.findFirst({ where: { id: agenteId, empresaId }, select: { id: true } });
    if (!agente) throw new BadRequestException('Agente inválido para esta empresa.');
  }
}

function limparOpcoes(opcoes: OpcoesConexao | undefined): Prisma.InputJsonObject {
  const limpas: Record<string, string | number> = {};
  if (opcoes?.ssl) limpas.ssl = opcoes.ssl;
  if (opcoes?.instancia?.trim()) limpas.instancia = opcoes.instancia.trim();
  if (opcoes?.tempoLimiteSegundos) limpas.tempoLimiteSegundos = opcoes.tempoLimiteSegundos;
  return limpas;
}

function resumo(c: ConexaoSelecionada): ConexaoBancoResumo {
  const { senhaCifrada, criadoEm, opcoes, ...resto } = c;
  return { ...resto, temSenha: Boolean(senhaCifrada), opcoes: opcoes as OpcoesConexao, criadoEm: criadoEm.toISOString() };
}
