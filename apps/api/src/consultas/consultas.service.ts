import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  avisosDosCampos,
  camposDasColunas,
  compilarSql,
  ehParametro,
  ErroPlaceholder,
  extrairPlaceholders,
  PREFIXO_PARAMETRO,
  type CampoDinamico,
  type ConsultaSqlResumo,
  type PreviaConsulta,
  type ResultadoConsulta,
  type SalvarConsultaResposta,
  type TipoBanco,
} from '@etiquetas/shared';
import { ConexoesService } from '../agentes/conexoes.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { config } from '../config';
import { sha256 } from '../cripto';
import { ehViolacaoUnica } from '../prisma/erros';
import { PrismaService } from '../prisma/prisma.service';
import type { AtualizarConsultaDto, CriarConsultaDto, PreviaConsultaDto, ValoresParametros } from './dto';

const LIMITE_LINHAS_PREVIA = 50;
const TAMANHO_MAXIMO_PARAMETRO = 1000;

const SELECAO = {
  id: true,
  conexaoId: true,
  nome: true,
  descricao: true,
  finalidade: true,
  sql: true,
  campos: true,
  camposHash: true,
  camposAtualizadosEm: true,
  ativo: true,
  criadoEm: true,
  atualizadoEm: true,
  conexao: { select: { tipo: true } },
} satisfies Prisma.ConsultaSqlSelect;

type ConsultaSelecionada = Prisma.ConsultaSqlGetPayload<{ select: typeof SELECAO }>;

/** Hash que amarra os campos lidos ao SQL e à conexão de onde vieram. */
export function hashCampos(conexaoId: string, sql: string): string {
  return sha256(`${conexaoId}\n${sql}`);
}

/** Data e hora "de parede" no fuso informado. */
export function agoraNoFuso(agora: Date, fuso: string): { data: string; dataHora: string } {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: fuso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(agora)
      .map((p) => [p.type, p.value]),
  );
  const data = `${partes.year}-${partes.month}-${partes.day}`;
  return { data, dataHora: `${data} ${partes.hour}:${partes.minute}:${partes.second}` };
}

/** Consultas SQL da empresa. Todo método recebe `empresaId` e filtra por ele. */
@Injectable()
export class ConsultasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly conexoes: ConexoesService,
  ) {}

  async listar(empresaId: string): Promise<ConsultaSqlResumo[]> {
    const consultas = await this.prisma.consultaSql.findMany({ where: { empresaId }, orderBy: { nome: 'asc' }, select: SELECAO });
    return consultas.map(resumo);
  }

  async obter(empresaId: string, id: string): Promise<ConsultaSqlResumo> {
    return resumo(await this.buscar(empresaId, id));
  }

  async criar(empresaId: string, dto: CriarConsultaDto, autorId: string): Promise<SalvarConsultaResposta> {
    const tipo = await this.tipoDaConexao(empresaId, dto.conexaoId);
    validarSql(dto.sql, tipo);
    try {
      const consulta = await this.prisma.consultaSql.create({
        data: {
          empresaId,
          conexaoId: dto.conexaoId,
          nome: dto.nome.trim(),
          descricao: dto.descricao?.trim() || null,
          finalidade: dto.finalidade,
          sql: dto.sql,
        },
        select: SELECAO,
      });
      await this.auditoria.registrar({
        empresaId,
        usuarioId: autorId,
        acao: 'consulta.criar',
        entidade: 'ConsultaSql',
        entidadeId: consulta.id,
        detalhes: { nome: consulta.nome, conexaoId: dto.conexaoId, sql: dto.sql.slice(0, 2000) },
      });
      return this.lerCamposAoSalvar(empresaId, consulta, autorId);
    } catch (erro) {
      if (ehViolacaoUnica(erro)) throw new ConflictException('Já existe uma consulta com este nome.');
      throw erro;
    }
  }

  async atualizar(empresaId: string, id: string, dto: AtualizarConsultaDto, autorId: string): Promise<SalvarConsultaResposta> {
    const atual = await this.buscar(empresaId, id);
    const conexaoId = dto.conexaoId ?? atual.conexaoId;
    const tipo = dto.conexaoId && dto.conexaoId !== atual.conexaoId ? await this.tipoDaConexao(empresaId, dto.conexaoId) : atual.conexao.tipo;
    const sql = dto.sql ?? atual.sql;
    validarSql(sql, tipo);

    try {
      const consulta = await this.prisma.consultaSql.update({
        where: { id },
        data: {
          conexaoId,
          nome: dto.nome?.trim(),
          descricao: dto.descricao === undefined ? undefined : dto.descricao.trim() || null,
          finalidade: dto.finalidade,
          sql,
          ativo: dto.ativo,
        },
        select: SELECAO,
      });
      await this.auditoria.registrar({
        empresaId,
        usuarioId: autorId,
        acao: 'consulta.editar',
        entidade: 'ConsultaSql',
        entidadeId: id,
        detalhes: { ...dto, sql: dto.sql?.slice(0, 2000) },
      });
      return this.lerCamposAoSalvar(empresaId, consulta, autorId);
    } catch (erro) {
      if (ehViolacaoUnica(erro)) throw new ConflictException('Já existe uma consulta com este nome.');
      throw erro;
    }
  }

  async excluir(empresaId: string, id: string, autorId: string) {
    const atual = await this.buscar(empresaId, id);
    await this.prisma.consultaSql.delete({ where: { id } });
    await this.auditoria.registrar({
      empresaId,
      usuarioId: autorId,
      acao: 'consulta.excluir',
      entidade: 'ConsultaSql',
      entidadeId: id,
      detalhes: { nome: atual.nome },
    });
  }

  /** Executa um SQL ainda não salvo (editor), com os valores de `{param.*}` informados. */
  async previa(empresaId: string, dto: PreviaConsultaDto, usuarioId: string): Promise<PreviaConsulta> {
    const tipo = await this.tipoDaConexao(empresaId, dto.conexaoId);
    const compilado = await this.compilar(empresaId, usuarioId, dto.sql, tipo, dto.parametros ?? {});
    await this.auditoria.registrar({
      empresaId,
      usuarioId,
      acao: 'consulta.previa',
      entidade: 'ConexaoBanco',
      entidadeId: dto.conexaoId,
      detalhes: { sql: dto.sql.slice(0, 2000) },
    });
    const resultado = await this.conexoes.executar(
      empresaId,
      dto.conexaoId,
      compilado.sql,
      compilado.parametros,
      dto.limiteLinhas ?? LIMITE_LINHAS_PREVIA,
    );
    const campos = camposDasColunas(resultado.colunas);
    return {
      resultado,
      campos,
      avisos: avisosDosCampos(campos),
      sqlExecutado: compilado.sql,
      parametros: compilado.parametros,
      placeholders: compilado.placeholders,
    };
  }

  /**
   * Executa uma consulta salva. Usado pela leitura dos campos e, na Fase 5, pela lista
   * do dia e pela busca avulsa.
   */
  async executar(
    empresaId: string,
    id: string,
    usuarioId: string,
    parametros: ValoresParametros,
    limiteLinhas: number,
  ): Promise<ResultadoConsulta> {
    const consulta = await this.buscar(empresaId, id);
    if (!consulta.ativo) throw new BadRequestException('Esta consulta está desativada.');
    return this.executarSelecionada(empresaId, consulta, usuarioId, parametros, limiteLinhas);
  }

  /** Relê as colunas da consulta (ex.: depois que o agente voltou a ficar online). */
  async atualizarCampos(empresaId: string, id: string, autorId: string): Promise<SalvarConsultaResposta> {
    const consulta = await this.buscar(empresaId, id);
    return this.lerCamposAoSalvar(empresaId, consulta, autorId, true);
  }

  /**
   * Lê as colunas executando a consulta com limite de 1 linha e `{param.*}` nulos (as
   * colunas vêm mesmo sem linhas). Se o agente estiver offline ou o SQL falhar, a
   * consulta fica salva com os campos marcados como desatualizados.
   */
  private async lerCamposAoSalvar(
    empresaId: string,
    consulta: ConsultaSelecionada,
    autorId: string,
    propagarErro = false,
  ): Promise<SalvarConsultaResposta> {
    const placeholders = extrairPlaceholders(consulta.sql, consulta.conexao.tipo);
    const nulos = Object.fromEntries(placeholders.filter(ehParametro).map((p) => [p.slice(PREFIXO_PARAMETRO.length), null]));

    let resultado: ResultadoConsulta;
    try {
      resultado = await this.executarSelecionada(empresaId, consulta, autorId, nulos, 1);
    } catch (erro) {
      if (propagarErro || !(erro instanceof HttpException)) throw erro;
      return {
        consulta: resumo(consulta),
        avisos: [`Consulta salva, mas os campos não foram atualizados: ${erro.message}`],
      };
    }

    const campos = camposDasColunas(resultado.colunas);
    const atualizada = await this.prisma.consultaSql.update({
      where: { id: consulta.id },
      data: {
        campos: campos as unknown as Prisma.InputJsonArray,
        camposHash: hashCampos(consulta.conexaoId, consulta.sql),
        camposAtualizadosEm: new Date(),
      },
      select: SELECAO,
    });
    return { consulta: resumo(atualizada), avisos: avisosDosCampos(campos) };
  }

  private async executarSelecionada(
    empresaId: string,
    consulta: ConsultaSelecionada,
    usuarioId: string,
    parametros: ValoresParametros,
    limiteLinhas: number,
  ) {
    const compilado = await this.compilar(empresaId, usuarioId, consulta.sql, consulta.conexao.tipo, parametros);
    return this.conexoes.executar(empresaId, consulta.conexaoId, compilado.sql, compilado.parametros, limiteLinhas);
  }

  /** Monta os valores dos placeholders a partir do banco próprio e compila o SQL. */
  private async compilar(empresaId: string, usuarioId: string, sql: string, tipo: TipoBanco, parametros: ValoresParametros) {
    const [empresa, usuario] = await Promise.all([
      this.prisma.empresa.findUniqueOrThrow({ where: { id: empresaId }, select: { cnpj: true, codigoErp: true, razaoSocial: true } }),
      this.prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId }, select: { id: true, email: true } }),
    ]);
    const { data, dataHora } = agoraNoFuso(new Date(), config().fusoHorario);

    const valores: Record<string, unknown> = {
      'empresa.cnpj': empresa.cnpj,
      'empresa.codigo_erp': empresa.codigoErp,
      'empresa.razao_social': empresa.razaoSocial,
      'usuario.id': usuario.id,
      'usuario.email': usuario.email,
      data_hoje: data,
      data_hora_agora: dataHora,
    };
    for (const [nome, valor] of Object.entries(parametros)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nome)) throw new BadRequestException(`Nome de parâmetro inválido: ${nome}`);
      if (valor !== null && typeof valor !== 'string') throw new BadRequestException(`O valor de {param.${nome}} deve ser texto.`);
      if (valor && valor.length > TAMANHO_MAXIMO_PARAMETRO) throw new BadRequestException(`O valor de {param.${nome}} é longo demais.`);
      valores[PREFIXO_PARAMETRO + nome.toLowerCase()] = valor;
    }

    try {
      return compilarSql(sql, tipo, valores);
    } catch (erro) {
      if (erro instanceof ErroPlaceholder) throw new BadRequestException(erro.message);
      throw erro;
    }
  }

  private async tipoDaConexao(empresaId: string, conexaoId: string): Promise<TipoBanco> {
    try {
      return await this.conexoes.tipo(empresaId, conexaoId);
    } catch (erro) {
      if (erro instanceof NotFoundException) throw new BadRequestException('Conexão inválida para esta empresa.');
      throw erro;
    }
  }

  private async buscar(empresaId: string, id: string) {
    const consulta = await this.prisma.consultaSql.findFirst({ where: { id, empresaId }, select: SELECAO });
    if (!consulta) throw new NotFoundException('Consulta não encontrada.');
    return consulta;
  }
}

function validarSql(sql: string, tipo: TipoBanco) {
  try {
    extrairPlaceholders(sql, tipo);
  } catch (erro) {
    if (erro instanceof ErroPlaceholder) throw new BadRequestException(erro.message);
    throw erro;
  }
}

function resumo(c: ConsultaSelecionada): ConsultaSqlResumo {
  let placeholders: string[] = [];
  try {
    placeholders = extrairPlaceholders(c.sql, c.conexao.tipo);
  } catch {
    // SQL salvo antes de uma troca de conexão para outro dialeto: o editor mostra o erro ao testar.
  }
  return {
    id: c.id,
    conexaoId: c.conexaoId,
    nome: c.nome,
    descricao: c.descricao,
    finalidade: c.finalidade,
    sql: c.sql,
    placeholders,
    campos: c.campos as unknown as CampoDinamico[],
    camposDesatualizados: c.camposHash !== hashCampos(c.conexaoId, c.sql),
    camposAtualizadosEm: c.camposAtualizadosEm?.toISOString() ?? null,
    ativo: c.ativo,
    criadoEm: c.criadoEm.toISOString(),
    atualizadoEm: c.atualizadoEm.toISOString(),
  };
}
