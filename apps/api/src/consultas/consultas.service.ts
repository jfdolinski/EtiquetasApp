import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  avisosDosCampos,
  mensagemFaltando,
  obrigatoriasFaltando,
  type FinalidadeConsulta,
  camposDasColunas,
  compilarSql,
  ehConexaoSql,
  ehParametro,
  ErroPlaceholder,
  extrairPlaceholders,
  PARAMETRO_PLANILHA,
  planoDeBuscaNoBanco,
  PREFIXO_PARAMETRO,
  type CampoDinamico,
  type ConsultaSqlResumo,
  type PreviaConsulta,
  type PreviaPlanilha,
  type ResultadoConsulta,
  type SalvarConsultaResposta,
  type TipoBanco,
  type TipoConexao,
} from '@etiquetas/shared';
import { ConexoesService } from '../agentes/conexoes.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { config } from '../config';
import { sha256 } from '../cripto';
import { CatalogoService } from '../posts/catalogo.service';
import { ehViolacaoUnica } from '../prisma/erros';
import { PrismaService } from '../prisma/prisma.service';
import type { AtualizarConsultaDto, CriarConsultaDto, PreviaConsultaDto, PreviaPlanilhaDto, ValoresParametros } from './dto';

const LIMITE_LINHAS_PREVIA = 50;
const TAMANHO_MAXIMO_PARAMETRO = 1000;

const SELECAO = {
  id: true,
  conexaoId: true,
  nome: true,
  descricao: true,
  finalidade: true,
  sql: true,
  arquivo: true,
  arquivoNome: true,
  aba: true,
  campos: true,
  camposHash: true,
  camposAtualizadosEm: true,
  templateConsultaId: true,
  ativo: true,
  criadoEm: true,
  atualizadoEm: true,
  conexao: { select: { tipo: true } },
} satisfies Prisma.ConsultaSqlSelect;

/** Hash do texto do SQL (cópia de template: detectar ajuste e atualização). */
export function hashSql(sql: string): string {
  return sha256(sql);
}

/** Origem da consulta quando copiada de um template de ERP. */
export interface OrigemTemplate {
  templateConsultaId: string;
  sql: string;
}

type ConsultaSelecionada = Prisma.ConsultaSqlGetPayload<{ select: typeof SELECAO }>;

type ReferenciaObrigatoria = { alias: string; nome: string; alternativos: string[]; obrigatoriaEm: FinalidadeConsulta[] };

/** Hash que amarra os campos lidos ao SQL e à conexão de onde vieram. */
export function hashCampos(conexaoId: string, sql: string): string {
  return sha256(`${conexaoId}\n${sql}`);
}

/** O que os campos dependem: o SQL, ou o arquivo e a aba nas consultas de planilha. */
function fonteDaConsulta(c: { sql: string; arquivo: string | null; aba: string | null }): string {
  return c.arquivo ? `${c.arquivo}\n${c.aba ?? ''}` : c.sql;
}

/** Na conexão de planilhas não há SQL; na de banco, não há arquivo. */
function fonteParaGravar(tipo: TipoConexao, d: { sql?: string; arquivo?: string | null; arquivoNome?: string | null; aba?: string | null }) {
  if (ehConexaoSql(tipo)) {
    validarSql(d.sql ?? '', tipo);
    return { sql: d.sql ?? '', arquivo: null, arquivoNome: null, aba: null };
  }
  if (!d.arquivo) throw new BadRequestException('Escolha o arquivo da planilha.');
  return { sql: '', arquivo: d.arquivo, arquivoNome: d.arquivoNome || d.arquivo, aba: d.aba || null };
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
  private readonly log = new Logger(ConsultasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly conexoes: ConexoesService,
    private readonly catalogo: CatalogoService,
  ) {}

  async listar(empresaId: string): Promise<ConsultaSqlResumo[]> {
    const consultas = await this.prisma.consultaSql.findMany({ where: { empresaId }, orderBy: { nome: 'asc' }, select: SELECAO });
    return consultas.map(resumo);
  }

  async obter(empresaId: string, id: string): Promise<ConsultaSqlResumo> {
    return resumo(await this.buscar(empresaId, id));
  }

  async criar(empresaId: string, dto: CriarConsultaDto, autorId: string, template?: OrigemTemplate): Promise<SalvarConsultaResposta> {
    const tipo = await this.tipoDaConexao(empresaId, dto.conexaoId);
    const fonte = fonteParaGravar(tipo, dto);
    // Cópia de template não é barrada: a empresa ajusta depois e o aviso diz o que falta.
    if (!template) await this.exigirObrigatorias(empresaId, autorId, dto.conexaoId, tipo, fonte.sql, dto.finalidade ?? 'OUTRA');
    try {
      const consulta = await this.prisma.consultaSql.create({
        data: {
          empresaId,
          conexaoId: dto.conexaoId,
          nome: dto.nome.trim(),
          descricao: dto.descricao?.trim() || null,
          finalidade: dto.finalidade,
          ...fonte,
          templateConsultaId: template?.templateConsultaId,
          templateSqlHash: template ? hashSql(template.sql) : undefined,
        },
        select: SELECAO,
      });
      await this.auditoria.registrar({
        empresaId,
        usuarioId: autorId,
        acao: template ? 'consulta.copiar_template' : 'consulta.criar',
        entidade: 'ConsultaSql',
        entidadeId: consulta.id,
        detalhes: { nome: consulta.nome, conexaoId: dto.conexaoId, templateConsultaId: template?.templateConsultaId, sql: fonte.sql.slice(0, 2000), arquivo: fonte.arquivo, aba: fonte.aba },
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
    const fonte = fonteParaGravar(tipo, {
      sql: dto.sql ?? atual.sql,
      arquivo: dto.arquivo ?? atual.arquivo,
      arquivoNome: dto.arquivoNome ?? atual.arquivoNome,
      aba: dto.aba === undefined ? atual.aba : dto.aba,
    });
    // Só quando o que importa mudou: consulta antiga continua podendo trocar de nome ou ser desativada.
    const finalidade = dto.finalidade ?? atual.finalidade;
    if (fonte.sql !== atual.sql || finalidade !== atual.finalidade || conexaoId !== atual.conexaoId) {
      await this.exigirObrigatorias(empresaId, autorId, conexaoId, tipo, fonte.sql, finalidade);
    }

    try {
      const consulta = await this.prisma.consultaSql.update({
        where: { id },
        data: {
          conexaoId,
          nome: dto.nome?.trim(),
          descricao: dto.descricao === undefined ? undefined : dto.descricao.trim() || null,
          finalidade: dto.finalidade,
          ...fonte,
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
    const tipo = sqlDe(await this.tipoDaConexao(empresaId, dto.conexaoId));
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

  /** Lê um arquivo ainda não salvo (editor): abas, colunas e primeiras linhas. */
  async previaPlanilha(empresaId: string, dto: PreviaPlanilhaDto): Promise<PreviaPlanilha> {
    const leitura = await this.conexoes.lerPlanilha(empresaId, dto.conexaoId, {
      arquivo: dto.arquivo,
      aba: dto.aba || null,
      termo: dto.termo || null,
      limiteLinhas: dto.limiteLinhas ?? LIMITE_LINHAS_PREVIA,
    });
    const campos = camposDasColunas(leitura.resultado.colunas);
    return { ...leitura, campos, avisos: avisosDosCampos(campos) };
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
    const resultado = await this.executarSelecionada(empresaId, consulta, usuarioId, parametros, limiteLinhas);
    this.catalogo.avisarConsulta(empresaId, resultado);
    return resultado;
  }

  /**
   * Procura um termo em consulta sem `{param.*}`, filtrando no banco do cliente: não importa o
   * tamanho da tabela. Se não der (colunas não lidas, ou o banco recusar a subconsulta, como
   * `ORDER BY` no SQL Server), lê até `limiteLinhas` como antes: nesse caso `truncado` diz que
   * o resultado pode estar incompleto. Quem chama confere as linhas: o filtro é um pouco mais largo.
   */
  async buscarPorTermo(empresaId: string, id: string, usuarioId: string, termo: string, limiteLinhas: number): Promise<ResultadoConsulta> {
    const consulta = await this.buscar(empresaId, id);
    if (!consulta.ativo) throw new BadRequestException('Esta consulta está desativada.');
    const tipo = consulta.conexao.tipo;
    if (ehConexaoSql(tipo)) {
      // Campos de outro SQL gerariam filtro por coluna que não existe mais.
      const atuais = consulta.camposHash === hashCampos(consulta.conexaoId, fonteDaConsulta(consulta));
      const etapas = atuais ? planoDeBuscaNoBanco(consulta.sql, tipo, (consulta.campos ?? []) as unknown as CampoDinamico[], termo) : [];
      const inicio = Date.now();
      try {
        for (const [i, etapa] of etapas.entries()) {
          const compilado = await this.compilar(empresaId, usuarioId, etapa.sql, tipo, etapa.parametros);
          const r = await this.conexoes.executar(empresaId, consulta.conexaoId, compilado.sql, compilado.parametros, limiteLinhas);
          // Vazio na última etapa é resposta: o produto não está no banco.
          if (r.linhas.length || i === etapas.length - 1) {
            this.registrarExecucao(empresaId, consulta, r.duracaoMs ?? Date.now() - inicio, r.linhas.length, null);
            this.catalogo.avisarConsulta(empresaId, r);
            return r;
          }
        }
      } catch (erro) {
        // Agente offline falharia de novo; o resto pode ser só a subconsulta. Tentativa não conta como erro da consulta.
        if (!(erro instanceof HttpException) || erro instanceof ServiceUnavailableException) throw erro;
        this.log.warn(`Consulta ${consulta.id}: filtro no banco recusado, lendo as linhas (${erro.message.slice(0, 200)})`);
      }
    }
    const resultado = await this.executarSelecionada(empresaId, consulta, usuarioId, {}, limiteLinhas);
    this.catalogo.avisarConsulta(empresaId, resultado, termo);
    return resultado;
  }

  /**
   * Substitui o SQL da consulta pelo do template de origem (descarta ajustes da empresa)
   * e relê os campos.
   */
  async restaurarTemplate(empresaId: string, id: string, autorId: string): Promise<SalvarConsultaResposta> {
    const atual = await this.buscar(empresaId, id);
    if (!atual.templateConsultaId) throw new BadRequestException('Esta consulta não veio de um template de ERP.');
    const template = await this.prisma.templateConsulta.findFirst({
      // O template precisa ser do ERP vinculado à empresa.
      where: { id: atual.templateConsultaId, sistemaErp: { empresas: { some: { id: empresaId } } } },
      select: { sql: true, sistemaErp: { select: { tipoBanco: true } } },
    });
    if (!template) throw new BadRequestException('O template de origem não pertence mais ao ERP da empresa.');
    if (template.sistemaErp.tipoBanco !== atual.conexao.tipo) {
      throw new BadRequestException('A conexão desta consulta é de outro tipo de banco que o do template.');
    }
    validarSql(template.sql, sqlDe(atual.conexao.tipo));
    const consulta = await this.prisma.consultaSql.update({
      where: { id },
      data: { sql: template.sql, templateSqlHash: hashSql(template.sql) },
      select: SELECAO,
    });
    await this.auditoria.registrar({
      empresaId,
      usuarioId: autorId,
      acao: 'consulta.restaurar_template',
      entidade: 'ConsultaSql',
      entidadeId: id,
      detalhes: { sqlAnterior: atual.sql.slice(0, 2000) },
    });
    return this.lerCamposAoSalvar(empresaId, consulta, autorId);
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
    const placeholders = ehConexaoSql(consulta.conexao.tipo) ? extrairPlaceholders(consulta.sql, consulta.conexao.tipo) : [];
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
        camposHash: hashCampos(consulta.conexaoId, fonteDaConsulta(consulta)),
        camposAtualizadosEm: new Date(),
      },
      select: SELECAO,
    });
    return { consulta: resumo(atualizada), avisos: [...avisosDosCampos(campos), ...(await this.avisosDoIndice(campos.map((c) => c.nome), consulta.finalidade))] };
  }

  private async referenciasAtivas() {
    return this.prisma.referenciaCampo.findMany({ where: { ativa: true }, select: { alias: true, nome: true, alternativos: true, obrigatoriaEm: true } });
  }

  private async avisosDoIndice(colunas: string[], finalidade: FinalidadeConsulta): Promise<string[]> {
    const faltando = obrigatoriasFaltando((await this.referenciasAtivas()) as ReferenciaObrigatoria[], colunas, finalidade);
    return faltando.length ? [mensagemFaltando(faltando, finalidade)] : [];
  }

  /**
   * Recusa salvar SQL sem um campo obrigatório do índice. Sem conseguir ler as colunas (agente
   * offline, SQL com erro), deixa salvar: quem avisa é a leitura dos campos logo depois.
   * Planilha não passa aqui: os títulos são do arquivo do cliente, e fica só o aviso.
   */
  private async exigirObrigatorias(empresaId: string, usuarioId: string, conexaoId: string, tipo: TipoConexao, sql: string, finalidade: FinalidadeConsulta) {
    if (!ehConexaoSql(tipo)) return;
    const referencias = (await this.referenciasAtivas()) as ReferenciaObrigatoria[];
    if (!referencias.some((r) => r.obrigatoriaEm.includes(finalidade))) return;
    const nulos = Object.fromEntries(extrairPlaceholders(sql, tipo).filter(ehParametro).map((p) => [p.slice(PREFIXO_PARAMETRO.length), null]));
    let colunas: string[];
    try {
      const compilado = await this.compilar(empresaId, usuarioId, sql, tipo, nulos);
      const r = await this.conexoes.executar(empresaId, conexaoId, compilado.sql, compilado.parametros, 1);
      colunas = r.colunas.map((c) => c.nome);
    } catch (erro) {
      if (erro instanceof HttpException) return;
      throw erro;
    }
    const faltando = obrigatoriasFaltando(referencias, colunas, finalidade);
    if (faltando.length) throw new BadRequestException(mensagemFaltando(faltando, finalidade));
  }

  private async executarSelecionada(
    empresaId: string,
    consulta: ConsultaSelecionada,
    usuarioId: string,
    parametros: ValoresParametros,
    limiteLinhas: number,
  ) {
    const inicio = Date.now();
    try {
      const resultado = await this.executarSemMedir(empresaId, consulta, usuarioId, parametros, limiteLinhas);
      this.registrarExecucao(empresaId, consulta, resultado.duracaoMs ?? Date.now() - inicio, resultado.linhas.length, null);
      return resultado;
    } catch (erro) {
      this.registrarExecucao(empresaId, consulta, Date.now() - inicio, 0, (erro as Error).message);
      throw erro;
    }
  }

  private async executarSemMedir(
    empresaId: string,
    consulta: ConsultaSelecionada,
    usuarioId: string,
    parametros: ValoresParametros,
    limiteLinhas: number,
  ) {
    if (!ehConexaoSql(consulta.conexao.tipo)) {
      const leitura = await this.conexoes.lerPlanilha(empresaId, consulta.conexaoId, {
        arquivo: consulta.arquivo ?? '',
        aba: consulta.aba,
        termo: parametros[PARAMETRO_PLANILHA] ?? null,
        limiteLinhas,
      });
      return leitura.resultado;
    }
    const compilado = await this.compilar(empresaId, usuarioId, consulta.sql, consulta.conexao.tipo, parametros);
    return this.conexoes.executar(empresaId, consulta.conexaoId, compilado.sql, compilado.parametros, limiteLinhas);
  }

  /** Medição para o painel: sem SQL nem parâmetros, e nunca atrapalha a consulta. */
  private registrarExecucao(empresaId: string, consulta: ConsultaSelecionada, duracaoMs: number, linhas: number, erro: string | null) {
    void this.prisma.execucaoConsulta
      ?.create({
        data: { empresaId, consultaId: consulta.id, consultaNome: consulta.nome, duracaoMs: Math.round(duracaoMs), linhas, ok: erro === null, erro: erro?.slice(0, 500) ?? null },
      })
      ?.catch(() => undefined);
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

  private async tipoDaConexao(empresaId: string, conexaoId: string): Promise<TipoConexao> {
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

function sqlDe(tipo: TipoConexao): TipoBanco {
  if (!ehConexaoSql(tipo)) throw new BadRequestException('Esta conexão é de planilhas: não aceita SQL.');
  return tipo;
}

function validarSql(sql: string, tipo: TipoBanco) {
  if (!sql.trim()) throw new BadRequestException('Informe o SQL.');
  try {
    extrairPlaceholders(sql, tipo);
  } catch (erro) {
    if (erro instanceof ErroPlaceholder) throw new BadRequestException(erro.message);
    throw erro;
  }
}

function resumo(c: ConsultaSelecionada): ConsultaSqlResumo {
  // Planilha sempre aceita a busca: é o que a avulsa usa para achar o código.
  let placeholders: string[] = [PREFIXO_PARAMETRO + PARAMETRO_PLANILHA];
  try {
    if (ehConexaoSql(c.conexao.tipo)) placeholders = extrairPlaceholders(c.sql, c.conexao.tipo);
  } catch {
    placeholders = [];
    // SQL salvo antes de uma troca de conexão para outro dialeto: o editor mostra o erro ao testar.
  }
  return {
    id: c.id,
    conexaoId: c.conexaoId,
    nome: c.nome,
    descricao: c.descricao,
    finalidade: c.finalidade,
    sql: c.sql,
    arquivo: c.arquivo,
    arquivoNome: c.arquivoNome,
    aba: c.aba,
    placeholders,
    campos: c.campos as unknown as CampoDinamico[],
    camposDesatualizados: c.camposHash !== hashCampos(c.conexaoId, fonteDaConsulta(c)),
    camposAtualizadosEm: c.camposAtualizadosEm?.toISOString() ?? null,
    templateConsultaId: c.templateConsultaId,
    ativo: c.ativo,
    criadoEm: c.criadoEm.toISOString(),
    atualizadoEm: c.atualizadoEm.toISOString(),
  };
}
