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
import {
  colunasDaTabela,
  ehConexaoSql,
  ErroPlanilha,
  filtrarTabela,
  lerChaveDrive,
  pastaDriveDoLink,
  tabelaDeLinhas,
  type ArquivoPlanilha,
  type ConexaoBancoResumo,
  type LeituraPlanilha,
  type OpcoesConexao,
  type ResultadoConsulta,
  type ResultadoTesteConexao,
  type TabelaPlanilha,
  type TipoConexao,
} from '@etiquetas/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { config } from '../config';
import { cifrar, decifrar } from '../cripto';
import { ehViolacaoUnica } from '../prisma/erros';
import { PrismaService } from '../prisma/prisma.service';
import { AgentesGateway } from './agentes.gateway';
import type { AtualizarConexaoDto, ConsultarDto, CriarConexaoDto } from './dto';
import { GoogleDriveService } from './google-drive.service';
import type { DadosConsultar, DadosLerArquivo, DadosListarArquivos, DadosTestarConexao, ResultadoLerArquivo, ResultadoListarArquivos } from './protocolo';
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
    private readonly drive: GoogleDriveService,
  ) {}

  async listar(empresaId: string): Promise<ConexaoBancoResumo[]> {
    const conexoes = await this.prisma.conexaoBanco.findMany({ where: { empresaId }, orderBy: { nome: 'asc' }, select: SELECAO });
    return conexoes.map(resumo);
  }

  async criar(empresaId: string, dto: CriarConexaoDto, autorId: string): Promise<ConexaoBancoResumo> {
    if (dto.tipo !== 'GOOGLE_DRIVE') await this.exigirAgenteDaEmpresa(empresaId, dto.agenteId!);
    const { senha, opcoes, ...entrada } = dto;
    const resto = camposDoTipo(dto.tipo, entrada, senha);
    try {
      const conexao = await this.prisma.conexaoBanco.create({
        data: {
          ...resto,
          empresaId,
          nome: dto.nome.trim(),
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
      if (conexao.agenteId) void this.gateway.enviarConfiguracao(conexao.agenteId);
      return resumo(conexao);
    } catch (erro) {
      if (ehViolacaoUnica(erro)) throw new ConflictException('Já existe uma conexão com este nome.');
      throw erro;
    }
  }

  async atualizar(empresaId: string, id: string, dto: AtualizarConexaoDto, autorId: string): Promise<ConexaoBancoResumo> {
    const atual = await this.buscar(empresaId, id);
    // As consultas dependem do tipo: banco tem SQL, planilha tem arquivo. Para mudar, crie outra conexão.
    if (dto.tipo && dto.tipo !== atual.tipo && !(ehConexaoSql(dto.tipo) && ehConexaoSql(atual.tipo))) {
      throw new BadRequestException('Não é possível trocar entre banco e planilhas: crie outra conexão.');
    }
    if (dto.agenteId && dto.agenteId !== atual.agenteId && atual.tipo !== 'GOOGLE_DRIVE') await this.exigirAgenteDaEmpresa(empresaId, dto.agenteId);

    const { senha, opcoes, ...entrada } = dto;
    const resto = ehConexaoSql(atual.tipo) ? entrada : parcialPlanilha(atual.tipo, entrada, senha);
    if (atual.tipo === 'GOOGLE_DRIVE' && senha === '') throw new BadRequestException('A conexão com o Google Drive precisa da chave.');
    try {
      const conexao = await this.prisma.conexaoBanco.update({
        where: { id },
        data: {
          ...resto,
          nome: dto.nome?.trim(),
          host: ehConexaoSql(atual.tipo) ? dto.host?.trim() : undefined,
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
      if (conexao.agenteId) void this.gateway.enviarConfiguracao(conexao.agenteId);
      if (atual.agenteId && conexao.agenteId !== atual.agenteId) void this.gateway.enviarConfiguracao(atual.agenteId);
      return resumo(conexao);
    } catch (erro) {
      if (ehViolacaoUnica(erro)) throw new ConflictException('Já existe uma conexão com este nome.');
      throw erro;
    }
  }

  async excluir(empresaId: string, id: string, autorId: string) {
    const atual = await this.buscar(empresaId, id);
    const emUso = await this.prisma.consultaSql.count({ where: { empresaId, conexaoId: id } });
    if (emUso > 0) {
      throw new ConflictException(`Esta conexão é usada por ${emUso} consulta(s). Mude-as de conexão ou exclua-as antes.`);
    }
    await this.prisma.conexaoBanco.delete({ where: { id } });
    await this.auditoria.registrar({
      empresaId,
      usuarioId: autorId,
      acao: 'conexao.excluir',
      entidade: 'ConexaoBanco',
      entidadeId: id,
      detalhes: { nome: atual.nome },
    });
    if (atual.agenteId) void this.gateway.enviarConfiguracao(atual.agenteId);
  }

  async testar(empresaId: string, id: string): Promise<ResultadoTesteConexao> {
    const conexao = await this.buscar(empresaId, id);
    if (conexao.tipo === 'GOOGLE_DRIVE') {
      const inicio = Date.now();
      const arquivos = await this.drive.listar(this.chaveDrive(conexao), conexao.banco);
      return { ok: true, versaoServidor: `${arquivos.length} planilha(s) na pasta do Drive`, duracaoMs: Date.now() - inicio };
    }
    return this.viaAgente(conexao, 'testar_conexao', { conexaoId: id } satisfies DadosTestarConexao, 20_000);
  }

  /** Executa um SQL de teste (somente leitura) no banco do cliente, via agente. */
  async consultar(empresaId: string, id: string, dto: ConsultarDto, autorId: string): Promise<ResultadoConsulta> {
    const conexao = await this.buscar(empresaId, id);
    if (!ehConexaoSql(conexao.tipo)) throw new BadRequestException('Esta conexão é de planilhas: não aceita SQL.');
    await this.auditoria.registrar({
      empresaId,
      usuarioId: autorId,
      acao: 'conexao.consultar',
      entidade: 'ConexaoBanco',
      entidadeId: id,
      detalhes: { sql: dto.sql.slice(0, 2000) },
    });
    return this.executar(empresaId, id, dto.sql, [], dto.limiteLinhas ?? LIMITE_LINHAS_TESTE);
  }

  /** Planilhas disponíveis numa conexão PASTA ou GOOGLE_DRIVE. */
  async listarArquivos(empresaId: string, id: string): Promise<ArquivoPlanilha[]> {
    const conexao = await this.buscar(empresaId, id);
    if (conexao.tipo === 'GOOGLE_DRIVE') {
      if (!conexao.ativo) throw new BadRequestException('Esta conexão está desativada.');
      return this.drive.listar(this.chaveDrive(conexao), conexao.banco);
    }
    if (conexao.tipo !== 'PASTA') throw new BadRequestException('Esta conexão é de banco de dados, não de planilhas.');
    const r = await this.viaAgente<ResultadoListarArquivos>(conexao, 'listar_arquivos', { conexaoId: id } satisfies DadosListarArquivos, 30_000);
    return r.arquivos.map((a) => ({ id: a.caminho, nome: a.caminho, tamanho: a.tamanho, modificadoEm: a.modificadoEm }));
  }

  /**
   * Lê um arquivo de uma conexão de planilhas, no formato de resultado de consulta. `termo` é o
   * `{param.busca}`: filtra pelo código exato ou por parte do texto.
   */
  async lerPlanilha(
    empresaId: string,
    id: string,
    pedido: { arquivo: string; aba: string | null; termo: string | null; limiteLinhas: number },
  ): Promise<LeituraPlanilha> {
    const inicio = Date.now();
    const conexao = await this.buscar(empresaId, id);
    if (!conexao.ativo) throw new BadRequestException('Esta conexão está desativada.');
    if (conexao.tipo === 'GOOGLE_DRIVE') {
      const abas = await this.drive.ler(id, this.chaveDrive(conexao), conexao.banco, pedido.arquivo);
      const nomes = [...abas.keys()];
      const aba = pedido.aba ?? nomes[0];
      const tabela = abas.get(aba);
      if (!tabela) throw new BadRequestException(`A aba "${aba}" não existe neste arquivo.`);
      const linhas = filtrarTabela(tabela, pedido.termo);
      return { abas: nomes, aba, resultado: resultadoDaTabela(tabela, linhas, pedido.limiteLinhas, inicio) };
    }
    if (conexao.tipo !== 'PASTA') throw new BadRequestException('Esta conexão é de banco de dados, não de planilhas.');
    const dados: DadosLerArquivo = { conexaoId: id, caminho: pedido.arquivo, aba: pedido.aba ?? '', termo: pedido.termo ?? '', limiteLinhas: pedido.limiteLinhas };
    const r = await this.viaAgente<ResultadoLerArquivo>(conexao, 'ler_arquivo', dados, 60_000);
    let tabela: TabelaPlanilha;
    try {
      tabela = tabelaDeLinhas(r.linhas);
    } catch (erro) {
      if (erro instanceof ErroPlanilha) throw new BadRequestException(erro.message);
      throw erro;
    }
    return {
      abas: r.abas,
      aba: r.aba,
      resultado: { colunas: colunasDaTabela(tabela), linhas: tabela.linhas, truncado: r.truncado, duracaoMs: Date.now() - inicio },
    };
  }

  /** Tipo da conexão (para compilar os placeholders na sintaxe certa ou ler planilha). */
  async tipo(empresaId: string, id: string): Promise<TipoConexao> {
    return (await this.buscar(empresaId, id)).tipo;
  }

  /**
   * Executa SQL já compilado (parâmetros na sintaxe do driver) no banco da conexão.
   * Base para o teste ad hoc, as consultas salvas e, depois, a lista do dia.
   */
  async executar(
    empresaId: string,
    id: string,
    sql: string,
    parametros: unknown[],
    limiteLinhas: number,
  ): Promise<ResultadoConsulta> {
    const conexao = await this.buscar(empresaId, id);
    if (!ehConexaoSql(conexao.tipo)) throw new BadRequestException('Esta conexão é de planilhas: não aceita SQL.');
    const tempoLimiteSegundos = (conexao.opcoes as OpcoesConexao).tempoLimiteSegundos ?? TEMPO_LIMITE_PADRAO_S;
    const dados: DadosConsultar = { conexaoId: id, sql, parametros, limiteLinhas, tempoLimiteSegundos };
    // Margem para o agente devolver o erro de tempo esgotado do próprio banco.
    return this.viaAgente(conexao, 'consultar', dados, (tempoLimiteSegundos + 10) * 1000);
  }

  private async viaAgente<T>(conexao: ConexaoSelecionada, tipo: string, dados: unknown, tempoLimiteMs: number): Promise<T> {
    if (!conexao.ativo) throw new BadRequestException('Esta conexão está desativada.');
    if (!conexao.agenteId) throw new BadRequestException('Esta conexão não usa agente.');
    try {
      return await this.gateway.sessao(conexao.agenteId).requisitar<T>(tipo, dados, tempoLimiteMs);
    } catch (erro) {
      if (erro instanceof AgenteDesconectado) {
        throw new ServiceUnavailableException('O agente desta conexão está offline. Verifique se ele está em execução.');
      }
      if (erro instanceof TempoEsgotadoAgente) throw new GatewayTimeoutException(erro.message);
      if (erro instanceof ErroDoAgente) {
        if (erro.message.includes('não suportado por esta versão')) {
          throw new UnprocessableEntityException('O agente desta conexão está desatualizado: atualize-o para ler planilhas.');
        }
        throw new UnprocessableEntityException(erro.message);
      }
      throw erro;
    }
  }

  private chaveDrive(conexao: ConexaoSelecionada): string {
    if (!conexao.senhaCifrada) throw new BadRequestException('A conexão com o Google Drive está sem a chave.');
    return decifrar(conexao.senhaCifrada, config().chaveCriptografia);
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

const CAMINHO_ABSOLUTO = /^([A-Za-z]:[\\/]|\\\\|\/)/;

function validandoPlanilha<T>(fazer: () => T): T {
  try {
    return fazer();
  } catch (erro) {
    if (erro instanceof ErroPlanilha) throw new BadRequestException(erro.message);
    throw erro;
  }
}

/** Colunas de uma conexão nova: banco usa todas; as de planilha guardam só o que precisam. */
function camposDoTipo(tipo: TipoConexao, d: Omit<CriarConexaoDto, 'senha' | 'opcoes'>, senha: string | undefined) {
  if (ehConexaoSql(tipo)) return { ...d, agenteId: d.agenteId!, host: d.host!.trim(), porta: d.porta!, usuario: d.usuario! };
  if (tipo === 'GOOGLE_DRIVE' && !senha) throw new BadRequestException('Informe a chave JSON da conta de serviço do Google.');
  const p = parcialPlanilha(tipo, d, senha);
  return { nome: d.nome, tipo, banco: p.banco!, agenteId: tipo === 'PASTA' ? d.agenteId! : null, host: '', porta: 0, usuario: p.usuario ?? '' };
}

/** Pasta e conta de uma conexão de planilhas, conferidas. */
function parcialPlanilha(tipo: TipoConexao, d: { banco?: string; agenteId?: string; nome?: string }, senha: string | undefined) {
  const r: { nome?: string; agenteId?: string; banco?: string; usuario?: string } = { nome: d.nome };
  if (tipo === 'PASTA') {
    r.agenteId = d.agenteId;
    if (d.banco !== undefined) {
      r.banco = d.banco.trim();
      if (!CAMINHO_ABSOLUTO.test(r.banco)) throw new BadRequestException('Informe o caminho completo da pasta no computador do agente (ex.: C:\\Planilhas).');
    }
    return r;
  }
  if (d.banco !== undefined) r.banco = validandoPlanilha(() => pastaDriveDoLink(d.banco!));
  if (senha) r.usuario = validandoPlanilha(() => lerChaveDrive(senha)).email;
  return r;
}

function resultadoDaTabela(tabela: TabelaPlanilha, linhas: TabelaPlanilha['linhas'], limite: number, inicio: number): ResultadoConsulta {
  return { colunas: colunasDaTabela(tabela), linhas: linhas.slice(0, limite), truncado: linhas.length > limite, duracaoMs: Date.now() - inicio };
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
