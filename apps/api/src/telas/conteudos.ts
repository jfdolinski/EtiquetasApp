import { createHash } from 'node:crypto';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import {
  AJUSTES_IMAGEM_TELA,
  aparenciaDoPrograma,
  caminhoImagemTela,
  conteudoVigente,
  dadosValidosAte,
  imagensUsadasPeloConteudo,
  itensDoConteudo,
  LIMITE_LINHAS_CONTEUDO,
  linhasParaRegistros,
  MAX_IMAGENS_TELA_POR_EMPRESA,
  modeloUsaConsulta,
  MODELOS_CONTEUDO_TELA,
  parametrosVigentes,
  problemaNaConfigConteudo,
  problemaNasImagensDoConteudo,
  problemaNaVigencia,
  problemaNosPrazosConteudo,
  registroBanido,
  situacaoDoConteudo,
  VEU_FUNDO_PADRAO,
  VEUS_FUNDO_TELA,
  type CampoDinamico,
  type ConfigConteudoTela,
  type ConsultaParaConteudo,
  type ConteudoTelaResumo,
  type AjusteImagemTela,
  type ImagemNoConteudo,
  type ImagemTelaResumo,
  type ItemConteudoTela,
  type ModeloConteudoTela,
  type PreviaConteudoResposta,
  type ProgramacaoTela,
  type ProgramaTela,
  type VigenciaConteudo,
} from '@etiquetas/shared';
import { empresaBloqueada } from '../auth/acesso-empresa';
import { EmpresaAtual, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { BanidosService } from '../banidos/banidos.service';
import { config } from '../config';
import { agoraNoFuso, ConsultasService } from '../consultas/consultas.service';
import { pedeParametros } from '../impressao/agendamentos.service';
import { tipoDaImagem } from '../posts/catalogo.service';
import { PrismaService } from '../prisma/prisma.service';
import { FotosProdutoTelaService } from './fotos';
import { horaLocal } from './hora';

const INTERVALO_VERIFICACAO_MS = 30_000;
/** Fora do horário não consulta o banco do cliente, mas confere de novo logo, para voltar ao ar com dados novos. */
const ESPERA_FORA_DO_HORARIO_MS = 60_000;
const MAX_POR_VERIFICACAO = 50;

class ConfigConteudoDto implements ConfigConteudoTela {
  @IsString()
  @MaxLength(80)
  titulo: string;

  @IsString()
  @MaxLength(160)
  rodape: string;

  @IsString()
  @MaxLength(200)
  colunaNome: string;

  @IsString()
  @MaxLength(200)
  colunaPreco: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  colunaPrecoDe: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  colunaDetalhe: string | null;

  @IsInt()
  segundosPorCena: number;

  @IsString()
  corFundo: string;

  @IsString()
  corDestaque: string;

  @IsOptional()
  @IsArray()
  imagens?: ImagemNoConteudo[];

  @IsOptional()
  @IsIn(AJUSTES_IMAGEM_TELA, { message: 'Ajuste de imagem desconhecido.' })
  ajuste?: AjusteImagemTela;

  @IsOptional()
  @IsBoolean()
  comFotos?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  colunaCodigo?: string | null;

  @IsOptional()
  @IsUUID('all', { message: 'Logomarca inválida.' })
  logoImagemId?: string | null;

  @IsOptional()
  @IsUUID('all', { message: 'Imagem de fundo inválida.' })
  fundoImagemId?: string | null;

  @IsOptional()
  @IsIn(VEUS_FUNDO_TELA, { message: 'Escolha como a imagem de fundo aparece.' })
  fundoVeu?: number;
}

class EnviarImagemTelaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  nome: string;

  /** Data URL. O limite real é o do parâmetro, conferido nos bytes. */
  @IsString()
  @MaxLength(14_500_000, { message: 'A imagem passa do limite.' })
  dados: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  largura?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  altura?: number;
}

class SalvarConteudoDto {
  @IsString()
  @MinLength(2, { message: 'Informe o nome do conteúdo.' })
  @MaxLength(80)
  nome: string;

  @IsIn(MODELOS_CONTEUDO_TELA, { message: 'Modelo desconhecido.' })
  modelo: ModeloConteudoTela;

  @IsOptional()
  @IsUUID('all', { message: 'Escolha a consulta.' })
  consultaId?: string;

  @ValidateNested()
  @Type(() => ConfigConteudoDto)
  config: ConfigConteudoDto;

  @IsInt({ message: 'Informe de quantos em quantos minutos atualizar.' })
  intervaloMinutos: number;

  @IsInt({ message: 'Informe a validade dos dados.' })
  validadeMinutos: number;

  @IsOptional()
  @IsString()
  horarioInicio?: string | null;

  @IsOptional()
  @IsString()
  horarioFim?: string | null;

  @IsOptional()
  @IsString()
  dataInicio?: string | null;

  @IsOptional()
  @IsString()
  dataFim?: string | null;
}

class PreviaConteudoDto {
  @IsUUID('all', { message: 'Escolha a consulta.' })
  consultaId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  colunaNome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  colunaPreco?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  colunaPrecoDe?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  colunaDetalhe?: string | null;

  @IsOptional()
  @IsBoolean()
  comFotos?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  colunaCodigo?: string | null;
}

class PublicarConteudoDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Escolha ao menos uma tela.' })
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true, message: 'Tela inválida.' })
  telaIds: string[];
}

const SEM_ITENS = {
  id: true,
  empresaId: true,
  nome: true,
  modelo: true,
  config: true,
  consultaId: true,
  intervaloMinutos: true,
  validadeMinutos: true,
  publicado: true,
  horarioInicio: true,
  horarioFim: true,
  dataInicio: true,
  dataFim: true,
  quantidadeItens: true,
  dadosEm: true,
  erro: true,
  consulta: { select: { nome: true } },
  responsavel: { select: { nome: true } },
  telas: { select: { telaId: true } },
} satisfies Prisma.ConteudoTelaSelect;

type ConteudoSemItens = Prisma.ConteudoTelaGetPayload<{ select: typeof SEM_ITENS }>;

function momento(agora: Date) {
  const fuso = config().fusoHorario;
  return { hoje: agoraNoFuso(agora, fuso).data, hora: horaLocal(agora, fuso) };
}

/** O que foi publicado nesta tela. Horário e validade são conferidos depois, com o relógio. */
function ondeNaTela(empresaId: string, telaId: string) {
  return { empresaId, publicado: true, dadosEm: { not: null }, quantidadeItens: { gt: 0 }, telas: { some: { telaId } } };
}

function vigencia(dto: { horarioInicio?: string | null; horarioFim?: string | null; dataInicio?: string | null; dataFim?: string | null }): VigenciaConteudo {
  return { horarioInicio: dto.horarioInicio || null, horarioFim: dto.horarioFim || null, dataInicio: dto.dataInicio || null, dataFim: dto.dataFim || null };
}

@Injectable()
export class ConteudosTelaService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('ConteudosTela');
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

  // Cadastro -------------------------------------------------------------------------------

  private resumir(c: ConteudoSemItens, agora = new Date()): ConteudoTelaResumo {
    const { hoje, hora } = momento(agora);
    return {
      id: c.id,
      nome: c.nome,
      modelo: c.modelo as ModeloConteudoTela,
      config: c.config as unknown as ConfigConteudoTela,
      consultaId: c.consultaId,
      consultaNome: c.consulta?.nome ?? null,
      intervaloMinutos: c.intervaloMinutos,
      validadeMinutos: c.validadeMinutos,
      publicado: c.publicado,
      horarioInicio: c.horarioInicio,
      horarioFim: c.horarioFim,
      dataInicio: c.dataInicio,
      dataFim: c.dataFim,
      situacao: situacaoDoConteudo(c, agora, hoje, hora),
      telaIds: c.telas.map((t) => t.telaId),
      quantidadeItens: c.quantidadeItens,
      dadosEm: c.dadosEm?.toISOString() ?? null,
      erro: c.erro,
      responsavelNome: c.responsavel?.nome ?? null,
    };
  }

  async listar(empresaId: string): Promise<ConteudoTelaResumo[]> {
    const lista = await this.prisma.conteudoTela.findMany({ where: { empresaId }, orderBy: { nome: 'asc' }, select: SEM_ITENS });
    return lista.map((c) => this.resumir(c));
  }

  private async obter(empresaId: string, id: string): Promise<ConteudoTelaResumo> {
    const c = await this.prisma.conteudoTela.findFirst({ where: { id, empresaId }, select: SEM_ITENS });
    if (!c) throw new NotFoundException('Conteúdo não encontrado.');
    return this.resumir(c);
  }

  async consultasDisponiveis(empresaId: string): Promise<ConsultaParaConteudo[]> {
    const lista = await this.prisma.consultaSql.findMany({
      where: { empresaId, ativo: true },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true, sql: true, campos: true, conexao: { select: { tipo: true } } },
    });
    return lista.map((c) => ({
      id: c.id,
      nome: c.nome,
      colunas: ((c.campos ?? []) as unknown as CampoDinamico[]).map((x) => x.nome),
      pedeParametro: pedeParametros(c as never),
    }));
  }

  private async consultaUtil(empresaId: string, consultaId: string) {
    const consulta = await this.prisma.consultaSql.findFirst({
      where: { id: consultaId, empresaId, ativo: true },
      select: { id: true, sql: true, campos: true, conexao: { select: { tipo: true } } },
    });
    if (!consulta) throw new BadRequestException('Consulta não encontrada ou desativada.');
    if (pedeParametros(consulta as never)) throw new BadRequestException('Esta consulta pede valores digitados ({param.*}), como uma busca: ela não roda sozinha. Use uma consulta de lista.');
    return consulta;
  }

  private conflitoDeNome(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Já existe um conteúdo com este nome.');
    throw e;
  }

  /** O endereço da imagem é público: sem isto, o id de outra empresa viraria logomarca aqui. */
  private async conferirImagens(empresaId: string, dto: SalvarConteudoDto) {
    const ids = imagensUsadasPeloConteudo(dto.modelo, dto.config);
    if (ids.length === 0) return;
    const achadas = await this.prisma.imagemTela.count({ where: { empresaId, id: { in: ids } } });
    if (achadas !== ids.length) throw new BadRequestException('Há imagens que não são desta empresa.');
  }

  private async validar(empresaId: string, dto: SalvarConteudoDto) {
    if (!modeloUsaConsulta(dto.modelo)) {
      const problema = problemaNasImagensDoConteudo(dto.config) ?? problemaNaVigencia(vigencia(dto));
      if (problema) throw new BadRequestException(problema);
      await this.conferirImagens(empresaId, dto);
      return;
    }
    if (!dto.consultaId) throw new BadRequestException('Escolha a consulta.');
    const problema = problemaNaConfigConteudo(dto.config) ?? problemaNosPrazosConteudo(dto.intervaloMinutos, dto.validadeMinutos) ?? problemaNaVigencia(vigencia(dto));
    if (problema) throw new BadRequestException(problema);
    await this.conferirImagens(empresaId, dto);
    const consulta = await this.consultaUtil(empresaId, dto.consultaId);
    // Sem colunas lidas (agente desligado ao salvar a consulta) não dá para conferir: a atualização avisa.
    const colunas = ((consulta.campos ?? []) as unknown as CampoDinamico[]).map((c) => c.nome.toLowerCase());
    if (colunas.length) {
      for (const coluna of [dto.config.colunaNome, dto.config.colunaPreco, dto.config.colunaPrecoDe, dto.config.colunaDetalhe, dto.config.comFotos ? dto.config.colunaCodigo : null]) {
        if (coluna && !colunas.includes(coluna.toLowerCase())) throw new BadRequestException(`A consulta não tem a coluna “${coluna}”.`);
      }
    }
  }

  private dados(dto: SalvarConteudoDto, autorId: string) {
    const comConsulta = modeloUsaConsulta(dto.modelo);
    return {
      nome: dto.nome.trim(),
      modelo: dto.modelo,
      consultaId: comConsulta ? dto.consultaId : null,
      config: { ...dto.config, colunaPrecoDe: dto.config.colunaPrecoDe || null, colunaDetalhe: dto.config.colunaDetalhe || null, comFotos: !!dto.config.comFotos, colunaCodigo: dto.config.colunaCodigo || null, logoImagemId: comConsulta ? dto.config.logoImagemId || null : null, fundoImagemId: comConsulta ? dto.config.fundoImagemId || null : null, fundoVeu: dto.config.fundoVeu ?? VEU_FUNDO_PADRAO } as unknown as Prisma.InputJsonValue,
      // Imagem não tem o que atualizar nem preço que fique velho.
      intervaloMinutos: comConsulta ? dto.intervaloMinutos : 0,
      validadeMinutos: comConsulta ? dto.validadeMinutos : 0,
      ...(comConsulta ? {} : { proximaAtualizacaoEm: null, itens: [] as Prisma.InputJsonValue }),
      ...vigencia(dto),
      responsavelId: autorId,
    };
  }

  async criar(empresaId: string, dto: SalvarConteudoDto, autorId: string): Promise<ConteudoTelaResumo> {
    await this.validar(empresaId, dto);
    const c = await this.prisma.conteudoTela.create({ data: { empresaId, ...this.dados(dto, autorId) }, select: { id: true } }).catch((e) => this.conflitoDeNome(e));
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'tela.conteudo_criar', entidade: 'ConteudoTela', entidadeId: c.id, detalhes: { nome: dto.nome, modelo: dto.modelo } });
    return this.obter(empresaId, c.id);
  }

  async atualizar(empresaId: string, id: string, dto: SalvarConteudoDto, autorId: string): Promise<ConteudoTelaResumo> {
    await this.validar(empresaId, dto);
    const { count } = await this.prisma.conteudoTela.updateMany({ where: { id, empresaId }, data: this.dados(dto, autorId) }).catch((e) => this.conflitoDeNome(e));
    if (count === 0) throw new NotFoundException('Conteúdo não encontrado.');
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'tela.conteudo_editar', entidade: 'ConteudoTela', entidadeId: id, detalhes: { nome: dto.nome, modelo: dto.modelo } });
    const atual = await this.obter(empresaId, id);
    // No ar, a mudança de colunas ou de consulta não pode esperar o próximo ciclo.
    if (atual.publicado) {
      // Passou de imagens para produtos: o relógio volta a cuidar dele.
      if (modeloUsaConsulta(dto.modelo)) await this.prisma.conteudoTela.updateMany({ where: { id, empresaId }, data: { proximaAtualizacaoEm: new Date(Date.now() + dto.intervaloMinutos * 60_000) } });
      await this.atualizarDados(id);
      return this.obter(empresaId, id);
    }
    return atual;
  }

  async excluir(empresaId: string, id: string, autorId: string) {
    const { count } = await this.prisma.conteudoTela.deleteMany({ where: { id, empresaId } });
    if (count === 0) throw new NotFoundException('Conteúdo não encontrado.');
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'tela.conteudo_excluir', entidade: 'ConteudoTela', entidadeId: id });
  }

  async previa(empresaId: string, dto: PreviaConteudoDto, usuarioId: string): Promise<PreviaConteudoResposta> {
    await this.consultaUtil(empresaId, dto.consultaId);
    const r = await this.consultas.executar(empresaId, dto.consultaId, usuarioId, {}, LIMITE_LINHAS_CONTEUDO);
    const banidos = await this.banidos.conjunto(empresaId);
    const todos = linhasParaRegistros(r.colunas, r.linhas);
    const registros = todos.filter((x) => !registroBanido(x, banidos));
    const colunas = r.colunas.map((c) => c.nome);
    const itens =
      dto.colunaNome && dto.colunaPreco
        ? itensDoConteudo(registros, { colunaNome: dto.colunaNome, colunaPreco: dto.colunaPreco, colunaPrecoDe: dto.colunaPrecoDe ?? null, colunaDetalhe: dto.colunaDetalhe ?? null, comFotos: dto.comFotos, colunaCodigo: dto.colunaCodigo ?? null })
        : { itens: [], descartados: 0, cortados: 0 };
    const banidosFora = todos.length - registros.length;
    if (!dto.comFotos || !dto.colunaCodigo) return { ...itens, colunas, banidos: banidosFora };
    const { itens: comFotos, fotos } = await this.fotos.paraPrevia(empresaId, itens.itens);
    return { ...itens, itens: comFotos, colunas, banidos: banidosFora, fotos };
  }

  // Imagens --------------------------------------------------------------------------------

  async listarImagens(empresaId: string): Promise<ImagemTelaResumo[]> {
    const [imagens, usos] = await Promise.all([
      this.prisma.imagemTela.findMany({ where: { empresaId }, orderBy: { criadoEm: 'desc' }, select: { id: true, nome: true, largura: true, altura: true, bytes: true, criadoEm: true } }),
      this.usosDeImagens(empresaId),
    ]);
    return imagens.map((i) => ({ ...i, usos: usos.get(i.id) ?? 0, criadoEm: i.criadoEm.toISOString() }));
  }

  /** Quantos conteúdos usam cada imagem: fica no JSON do conteúdo, sem chave estrangeira. */
  private async usosDeImagens(empresaId: string): Promise<Map<string, number>> {
    const conteudos = await this.prisma.conteudoTela.findMany({ where: { empresaId }, select: { modelo: true, config: true } });
    const usos = new Map<string, number>();
    for (const c of conteudos) {
      for (const id of imagensUsadasPeloConteudo(c.modelo as ModeloConteudoTela, c.config as unknown as ConfigConteudoTela)) usos.set(id, (usos.get(id) ?? 0) + 1);
    }
    return usos;
  }

  async enviarImagem(empresaId: string, dto: EnviarImagemTelaDto, autorId: string): Promise<ImagemTelaResumo> {
    const [global, daEmpresa] = await Promise.all([
      this.prisma.parametroTelas.findFirst({ where: { empresaId: null }, select: { valores: true } }),
      this.prisma.parametroTelas.findFirst({ where: { empresaId }, select: { valores: true } }),
    ]);
    const maximoMb = parametrosVigentes(global?.valores, daEmpresa?.valores).imagemTamanhoMaximoMb;
    const bytes = Buffer.from(dto.dados.slice(dto.dados.indexOf(',') + 1), 'base64');
    if (bytes.length > maximoMb * 1_000_000) throw new BadRequestException(`A imagem passa de ${maximoMb} MB.`);
    // Pelos bytes, não pelo que o navegador declarou: SVG pode carregar script.
    const mime = tipoDaImagem(bytes);
    if (!mime) throw new BadRequestException('A imagem precisa ser PNG, JPEG, WebP ou GIF.');
    if ((await this.prisma.imagemTela.count({ where: { empresaId } })) >= MAX_IMAGENS_TELA_POR_EMPRESA) throw new BadRequestException(`A galeria das telas aceita até ${MAX_IMAGENS_TELA_POR_EMPRESA} imagens. Exclua alguma para enviar outra.`);
    const i = await this.prisma.imagemTela.create({
      data: { empresaId, nome: dto.nome.trim().slice(0, 200), mime, largura: dto.largura ?? null, altura: dto.altura ?? null, bytes: bytes.length, conteudo: bytes },
      select: { id: true, nome: true, largura: true, altura: true, bytes: true, criadoEm: true },
    });
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'tela.imagem_enviar', entidade: 'ImagemTela', entidadeId: i.id, detalhes: { nome: i.nome, bytes: i.bytes } });
    return { ...i, usos: 0, criadoEm: i.criadoEm.toISOString() };
  }

  async excluirImagem(empresaId: string, id: string, autorId: string) {
    if ((await this.usosDeImagens(empresaId)).get(id)) throw new ConflictException('Esta imagem está em um conteúdo. Tire a imagem de lá antes de excluir.');
    const { count } = await this.prisma.imagemTela.deleteMany({ where: { id, empresaId } });
    if (count === 0) throw new NotFoundException('Imagem não encontrada.');
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'tela.imagem_excluir', entidade: 'ImagemTela', entidadeId: id });
  }

  async arquivoDaImagem(id: string) {
    const i = await this.prisma.imagemTela.findUnique({ where: { id }, select: { mime: true, conteudo: true } });
    if (!i) throw new NotFoundException('Imagem não encontrada.');
    return i;
  }

  // Publicação -----------------------------------------------------------------------------

  async publicar(empresaId: string, id: string, telaIds: string[], autor: UsuarioRequisicao): Promise<ConteudoTelaResumo> {
    const [global, daEmpresa] = await Promise.all([
      this.prisma.parametroTelas.findFirst({ where: { empresaId: null }, select: { valores: true } }),
      this.prisma.parametroTelas.findFirst({ where: { empresaId }, select: { valores: true } }),
    ]);
    // Publicar sem aprovar passaria por cima do que a empresa pediu: melhor recusar até a aprovação existir.
    if (parametrosVigentes(global?.valores, daEmpresa?.valores).aprovacaoObrigatoria) {
      throw new ConflictException('Esta empresa exige aprovação, mas a tela de aprovação ainda não está disponível. Desligue “Aprovação obrigatória” nos parâmetros para publicar.');
    }
    const unicas = [...new Set(telaIds)];
    const achadas = await this.prisma.tela.count({ where: { empresaId, id: { in: unicas } } });
    if (achadas !== unicas.length) throw new BadRequestException('Há telas que não são desta empresa.');
    const conteudo = await this.prisma.conteudoTela.findFirst({ where: { id, empresaId }, select: { id: true, modelo: true, consultaId: true, intervaloMinutos: true } });
    if (!conteudo) throw new NotFoundException('Conteúdo não encontrado.');
    const comConsulta = modeloUsaConsulta(conteudo.modelo as ModeloConteudoTela);
    if (comConsulta) {
      if (!conteudo.consultaId) throw new BadRequestException('A consulta deste conteúdo foi excluída. Escolha outra antes de publicar.');
      await this.consultaUtil(empresaId, conteudo.consultaId);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.telaConteudo.deleteMany({ where: { conteudoId: id, empresaId } });
      await tx.telaConteudo.createMany({ data: unicas.map((telaId) => ({ telaId, conteudoId: id, empresaId })) });
      await tx.conteudoTela.update({ where: { id }, data: { publicado: true, responsavelId: autor.id, proximaAtualizacaoEm: comConsulta ? new Date(Date.now() + conteudo.intervaloMinutos * 60_000) : null } });
      await this.auditoria.registrar({ empresaId, usuarioId: autor.id, acao: 'tela.conteudo_publicar', entidade: 'ConteudoTela', entidadeId: id, detalhes: { telas: unicas.length } }, tx);
    });
    await this.atualizarDados(id);
    return this.obter(empresaId, id);
  }

  async despublicar(empresaId: string, id: string, autorId: string): Promise<ConteudoTelaResumo> {
    const { count } = await this.prisma.conteudoTela.updateMany({ where: { id, empresaId }, data: { publicado: false, proximaAtualizacaoEm: null } });
    if (count === 0) throw new NotFoundException('Conteúdo não encontrado.');
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'tela.conteudo_despublicar', entidade: 'ConteudoTela', entidadeId: id });
    return this.obter(empresaId, id);
  }

  async atualizarAgora(empresaId: string, id: string): Promise<ConteudoTelaResumo> {
    const c = await this.prisma.conteudoTela.findFirst({ where: { id, empresaId, publicado: true }, select: { id: true } });
    if (!c) throw new NotFoundException('Conteúdo não publicado.');
    await this.atualizarDados(id);
    return this.obter(empresaId, id);
  }

  // Cópia dos dados ------------------------------------------------------------------------

  /** Reivindica com `updateMany` no horário antigo: uma atualização por vez de cada conteúdo. */
  async verificar(agora = new Date()) {
    if (this.verificando) return;
    this.verificando = true;
    try {
      const { hoje, hora } = momento(agora);
      const vencidos = await this.prisma.conteudoTela.findMany({
        where: { publicado: true, proximaAtualizacaoEm: { lte: agora }, telas: { some: {} } },
        orderBy: { proximaAtualizacaoEm: 'asc' },
        take: MAX_POR_VERIFICACAO,
        select: { id: true, proximaAtualizacaoEm: true, intervaloMinutos: true, horarioInicio: true, horarioFim: true, dataInicio: true, dataFim: true, empresa: { select: { ativa: true, statusAssinatura: true } } },
      });
      for (const c of vencidos) {
        const vale = conteudoVigente(c, hoje, hora) && !empresaBloqueada(c.empresa);
        const proxima = new Date(agora.getTime() + (vale ? c.intervaloMinutos * 60_000 : ESPERA_FORA_DO_HORARIO_MS));
        const { count } = await this.prisma.conteudoTela.updateMany({ where: { id: c.id, proximaAtualizacaoEm: c.proximaAtualizacaoEm }, data: { proximaAtualizacaoEm: proxima } });
        if (count === 1 && vale) void this.atualizarDados(c.id);
      }
    } catch (e) {
      this.log.error(`Verificação: ${(e as Error).message}`);
    } finally {
      this.verificando = false;
    }
  }

  /** Falhou: guarda o motivo e mantém os dados anteriores, que saem do ar ao vencer. */
  async atualizarDados(id: string): Promise<void> {
    const c = await this.prisma.conteudoTela.findUnique({ where: { id }, select: { empresaId: true, modelo: true, consultaId: true, config: true, responsavelId: true, responsavel: { select: { ativo: true } } } });
    if (!c) return;
    // Imagem não consulta nada: está pronta assim que publica, e a data só serve para a TV buscar de novo.
    if (!modeloUsaConsulta(c.modelo as ModeloConteudoTela)) {
      const quantidade = ((c.config as unknown as ConfigConteudoTela).imagens ?? []).length;
      await this.prisma.conteudoTela.update({ where: { id }, data: { quantidadeItens: quantidade, dadosEm: new Date(), erro: null } });
      return;
    }
    try {
      if (!c.consultaId) throw new Error('A consulta deste conteúdo foi excluída. Escolha outra.');
      if (!c.responsavelId || !c.responsavel?.ativo) throw new Error('O usuário responsável foi removido ou desativado: edite e salve o conteúdo.');
      const r = await this.consultas.executar(c.empresaId, c.consultaId, c.responsavelId, {}, LIMITE_LINHAS_CONTEUDO);
      const banidos = await this.banidos.conjunto(c.empresaId);
      const registros = linhasParaRegistros(r.colunas, r.linhas).filter((x) => !registroBanido(x, banidos));
      const cfg = c.config as unknown as ConfigConteudoTela;
      const { itens } = itensDoConteudo(registros, cfg);
      // Sem nada aproveitável não é "dados novos": apagar a tela por um erro de coluna seria pior que esperar a validade.
      if (itens.length === 0) throw new Error('A consulta não trouxe nenhum produto com nome e preço.');
      // O preço nunca espera a foto: entra com as já guardadas, e as outras chegam depois.
      const { itens: comFotos, faltam } = cfg.comFotos ? await this.fotos.aplicar(c.empresaId, itens) : { itens, faltam: [] as string[] };
      const dadosEm = new Date();
      await this.prisma.conteudoTela.update({ where: { id }, data: { itens: comFotos as unknown as Prisma.InputJsonValue, quantidadeItens: itens.length, dadosEm, erro: null } });
      if (faltam.length) void this.completarFotos(id, c.empresaId, faltam, dadosEm);
    } catch (e) {
      await this.prisma.conteudoTela.updateMany({ where: { id }, data: { erro: (e as Error).message.slice(0, 500) } }).catch(() => undefined);
    }
  }

  /** Em segundo plano. Só toca nos dados que começou a completar: se já vieram outros, eles usam as fotos da próxima vez. */
  async completarFotos(id: string, empresaId: string, codigos: string[], dadosEm: Date): Promise<void> {
    try {
      await this.fotos.buscar(empresaId, codigos);
      const atual = await this.prisma.conteudoTela.findUnique({ where: { id }, select: { itens: true, dadosEm: true } });
      if (!atual || atual.dadosEm?.getTime() !== dadosEm.getTime()) return;
      const antes = atual.itens as unknown as ItemConteudoTela[];
      const { itens } = await this.fotos.aplicar(empresaId, antes);
      if (itens.every((item, i) => item.foto === antes[i].foto)) return;
      // Sem mexer em `dadosEm`: a foto não torna o preço mais novo. A edição muda a versão, e a TV busca de novo.
      await this.prisma.conteudoTela.updateMany({ where: { id, dadosEm }, data: { itens: itens as unknown as Prisma.InputJsonValue } });
    } catch (e) {
      this.log.warn(`Fotos do conteúdo ${id}: ${(e as Error).message}`);
    }
  }

  // Player ---------------------------------------------------------------------------------

  /** Muda quando a tela precisa buscar de novo: dados novos, edição, ou algo que entrou ou saiu do horário. */
  async versaoDaProgramacao(empresaId: string, telaId: string, agora = new Date()): Promise<string> {
    const lista = await this.prisma.conteudoTela.findMany({
      where: ondeNaTela(empresaId, telaId),
      orderBy: { id: 'asc' },
      select: { id: true, atualizadoEm: true, dadosEm: true, validadeMinutos: true, horarioInicio: true, horarioFim: true, dataInicio: true, dataFim: true },
    });
    const { hoje, hora } = momento(agora);
    const partes = lista.filter((c) => conteudoVigente(c, hoje, hora) && dadosValidosAte(c.dadosEm!, c.validadeMinutos) > agora).map((c) => `${c.id}:${c.dadosEm!.getTime()}:${c.atualizadoEm.getTime()}`);
    return createHash('sha256').update(partes.join('|')).digest('hex').slice(0, 16);
  }

  async programacaoDaTela(empresaId: string, telaId: string, agora = new Date()): Promise<ProgramacaoTela> {
    const lista = await this.prisma.conteudoTela.findMany({ where: ondeNaTela(empresaId, telaId), orderBy: { nome: 'asc' } });
    const { hoje, hora } = momento(agora);
    const programas: ProgramaTela[] = lista
      .filter((c) => conteudoVigente(c, hoje, hora) && dadosValidosAte(c.dadosEm!, c.validadeMinutos) > agora)
      .map((c) => {
        const cfg = c.config as unknown as ConfigConteudoTela;
        return {
          id: c.id,
          nome: c.nome,
          modelo: c.modelo as ModeloConteudoTela,
          config: { titulo: cfg.titulo, rodape: cfg.rodape, segundosPorCena: cfg.segundosPorCena, corFundo: cfg.corFundo, corDestaque: cfg.corDestaque, ajuste: cfg.ajuste },
          // O código só serve para achar a foto, e a foto só vale com a opção ligada: uma atualização que falhou pode ter deixado a antiga.
          itens: (c.itens as unknown as ItemConteudoTela[]).map(({ codigo: _codigo, foto, ...item }) => (foto && cfg.comFotos ? { ...item, foto } : item)),
          ...(c.modelo === 'IMAGENS' ? { imagens: (cfg.imagens ?? []).map((i) => ({ url: caminhoImagemTela(i.imagemId), segundos: i.segundos })) } : {}),
          ...aparenciaDoPrograma(c.modelo as ModeloConteudoTela, cfg),
          dadosEm: c.dadosEm!.toISOString(),
          validoAte: dadosValidosAte(c.dadosEm!, c.validadeMinutos).toISOString(),
        };
      });
    return { versao: await this.versaoDaProgramacao(empresaId, telaId, agora), programas, agora: agora.toISOString(), fuso: config().fusoHorario };
  }
}

@Controller('telas/conteudos')
export class ConteudosTelaController {
  constructor(private readonly conteudos: ConteudosTelaService) {}

  @Get()
  @RequerPermissao('tela.ver')
  listar(@EmpresaAtual() empresaId: string) {
    return this.conteudos.listar(empresaId);
  }

  /** Sem exigir `sql.ver`: quem cuida das telas escolhe a consulta sem ver o SQL. */
  @Get('consultas')
  @RequerPermissao('tela.editar')
  consultas(@EmpresaAtual() empresaId: string) {
    return this.conteudos.consultasDisponiveis(empresaId);
  }

  @Get('imagens')
  @RequerPermissao('tela.ver')
  imagens(@EmpresaAtual() empresaId: string) {
    return this.conteudos.listarImagens(empresaId);
  }

  @Post('imagens')
  @RequerPermissao('tela.editar')
  enviarImagem(@EmpresaAtual() empresaId: string, @Body() dto: EnviarImagemTelaDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.conteudos.enviarImagem(empresaId, dto, u.id);
  }

  @Delete('imagens/:id')
  @HttpCode(204)
  @RequerPermissao('tela.editar')
  async excluirImagem(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao) {
    await this.conteudos.excluirImagem(empresaId, id, u.id);
  }

  @Post('previa')
  @HttpCode(200)
  @RequerPermissao('tela.editar')
  previa(@EmpresaAtual() empresaId: string, @Body() dto: PreviaConteudoDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.conteudos.previa(empresaId, dto, u.id);
  }

  @Post()
  @RequerPermissao('tela.editar')
  criar(@EmpresaAtual() empresaId: string, @Body() dto: SalvarConteudoDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.conteudos.criar(empresaId, dto, u.id);
  }

  @Put(':id')
  @RequerPermissao('tela.editar')
  atualizar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SalvarConteudoDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.conteudos.atualizar(empresaId, id, dto, u.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequerPermissao('tela.editar')
  async excluir(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao) {
    await this.conteudos.excluir(empresaId, id, u.id);
  }

  @Post(':id/publicar')
  @HttpCode(200)
  @RequerPermissao('tela.editar')
  publicar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PublicarConteudoDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.conteudos.publicar(empresaId, id, dto.telaIds, u);
  }

  @Post(':id/despublicar')
  @HttpCode(200)
  @RequerPermissao('tela.editar')
  despublicar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.conteudos.despublicar(empresaId, id, u.id);
  }

  @Post(':id/atualizar')
  @HttpCode(200)
  @RequerPermissao('tela.editar')
  atualizarAgora(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.conteudos.atualizarAgora(empresaId, id);
  }
}
