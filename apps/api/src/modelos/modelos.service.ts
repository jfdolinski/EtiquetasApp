import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  camposUsados,
  ehParametro,
  GERADORES,
  PREFIXO_PARAMETRO,
  type ConsultaParaModelo,
  linhasParaRegistros,
  validarLayout,
  type AmostraModelo,
  type CampoDinamico,
  type CopiaModeloResultado,
  type LayoutEtiqueta,
  type ModeloExportado,
  type LinguagemImpressora,
  type ModeloEtiquetaResumo,
  type Registro,
  type SaidaEtiquetas,
} from '@etiquetas/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { config } from '../config';
import { agoraNoFuso, ConsultasService } from '../consultas/consultas.service';
import { ehViolacaoUnica } from '../prisma/erros';
import { PrismaService } from '../prisma/prisma.service';
import type { AmostraDto, AtualizarModeloDto, CriarModeloDto, GerarDto } from './dto';
import { gerarPdf } from './pdf';

const SELECAO = {
  id: true,
  nome: true,
  descricao: true,
  consultaId: true,
  impressoraId: true,
  naListaDiaria: true,
  layout: true,
  ativo: true,
  criadoEm: true,
  atualizadoEm: true,
} satisfies Prisma.ModeloEtiquetaSelect;

type ModeloSelecionado = Prisma.ModeloEtiquetaGetPayload<{ select: typeof SELECAO }>;

const MAXIMO_COLUNAS_REGISTRO = 200;
const MAXIMO_TEXTO_VALOR = 2000;

/** Modelos de etiqueta da empresa. Todo método recebe `empresaId` e filtra por ele. */
@Injectable()
export class ModelosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly consultas: ConsultasService,
  ) {}

  async listar(empresaId: string): Promise<ModeloEtiquetaResumo[]> {
    const modelos = await this.prisma.modeloEtiqueta.findMany({ where: { empresaId }, orderBy: { nome: 'asc' }, select: SELECAO });
    return modelos.map(resumo);
  }

  async obter(empresaId: string, id: string): Promise<ModeloEtiquetaResumo> {
    return resumo(await this.buscar(empresaId, id));
  }

  async criar(empresaId: string, dto: CriarModeloDto, autorId: string): Promise<ModeloEtiquetaResumo> {
    exigirLayoutValido(dto.layout);
    if (dto.consultaId) await this.exigirConsultaDaEmpresa(empresaId, dto.consultaId);
    if (dto.impressoraId) await this.exigirImpressoraDaEmpresa(empresaId, dto.impressoraId);
    try {
      const modelo = await this.prisma.modeloEtiqueta.create({
        data: {
          empresaId,
          nome: dto.nome.trim(),
          descricao: dto.descricao?.trim() || null,
          consultaId: dto.consultaId ?? null,
          impressoraId: dto.impressoraId ?? null,
          naListaDiaria: dto.naListaDiaria ?? false,
          layout: dto.layout as unknown as Prisma.InputJsonObject,
        },
        select: SELECAO,
      });
      await this.auditoria.registrar({
        empresaId,
        usuarioId: autorId,
        acao: 'modelo.criar',
        entidade: 'ModeloEtiqueta',
        entidadeId: modelo.id,
        detalhes: { nome: modelo.nome },
      });
      return resumo(modelo);
    } catch (erro) {
      if (ehViolacaoUnica(erro)) throw new ConflictException('Já existe um modelo com este nome.');
      throw erro;
    }
  }

  async atualizar(empresaId: string, id: string, dto: AtualizarModeloDto, autorId: string): Promise<ModeloEtiquetaResumo> {
    await this.buscar(empresaId, id);
    if (dto.layout) exigirLayoutValido(dto.layout);
    if (dto.consultaId) await this.exigirConsultaDaEmpresa(empresaId, dto.consultaId);
    if (dto.impressoraId) await this.exigirImpressoraDaEmpresa(empresaId, dto.impressoraId);
    try {
      const modelo = await this.prisma.modeloEtiqueta.update({
        where: { id },
        data: {
          nome: dto.nome?.trim(),
          descricao: dto.descricao === undefined ? undefined : dto.descricao.trim() || null,
          consultaId: dto.consultaId,
          impressoraId: dto.impressoraId,
          naListaDiaria: dto.naListaDiaria,
          layout: dto.layout as unknown as Prisma.InputJsonObject | undefined,
          ativo: dto.ativo,
        },
        select: SELECAO,
      });
      await this.auditoria.registrar({
        empresaId,
        usuarioId: autorId,
        acao: 'modelo.editar',
        entidade: 'ModeloEtiqueta',
        entidadeId: id,
        detalhes: {
          nome: dto.nome,
          consultaId: dto.consultaId,
          impressoraId: dto.impressoraId,
          naListaDiaria: dto.naListaDiaria,
          ativo: dto.ativo,
          layoutAlterado: Boolean(dto.layout),
        },
      });
      return resumo(modelo);
    } catch (erro) {
      if (ehViolacaoUnica(erro)) throw new ConflictException('Já existe um modelo com este nome.');
      throw erro;
    }
  }

  async excluir(empresaId: string, id: string, autorId: string) {
    const atual = await this.buscar(empresaId, id);
    await this.prisma.modeloEtiqueta.delete({ where: { id } });
    await this.auditoria.registrar({
      empresaId,
      usuarioId: autorId,
      acao: 'modelo.excluir',
      entidade: 'ModeloEtiqueta',
      entidadeId: id,
      detalhes: { nome: atual.nome },
    });
  }

  /** Arquivo portável do modelo (layout + referência à consulta), para levar a outra empresa. */
  async exportar(empresaId: string, id: string, autorId: string): Promise<ModeloExportado> {
    const m = await this.prisma.modeloEtiqueta.findFirst({
      where: { id, empresaId },
      select: { nome: true, descricao: true, layout: true, consulta: { select: { nome: true, templateConsultaId: true } } },
    });
    if (!m) throw new NotFoundException('Modelo não encontrado.');
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'modelo.exportar', entidade: 'ModeloEtiqueta', entidadeId: id });
    return {
      formato: 'etiquetas.modelo',
      versao: 1,
      exportadoEm: new Date().toISOString(),
      nome: m.nome,
      descricao: m.descricao,
      layout: m.layout as unknown as LayoutEtiqueta,
      consulta: m.consulta,
    };
  }

  async importar(empresaId: string, arquivo: ModeloExportado, autorId: string) {
    if (arquivo?.formato !== 'etiquetas.modelo' || arquivo.versao !== 1) {
      throw new BadRequestException('Arquivo de modelo inválido ou de versão não suportada.');
    }
    if (typeof arquivo.nome !== 'string' || !arquivo.nome.trim()) throw new BadRequestException('Arquivo de modelo sem nome.');
    return this.criarDeExportado(empresaId, arquivo, autorId, 'modelo.importar');
  }

  /**
   * Copia um modelo para outras empresas (super-admin). Cada destino é independente: um
   * erro num não impede os demais. Impressora e lista do dia não são copiadas (são da loja).
   */
  async copiarParaEmpresas(origemId: string, id: string, destinos: string[], autorId: string): Promise<CopiaModeloResultado[]> {
    if (destinos.includes(origemId)) {
      throw new BadRequestException('A empresa de origem não pode ser destino da cópia (use Exportar/Importar para duplicar).');
    }
    const empresas = await this.prisma.empresa.findMany({
      where: { id: { in: destinos } },
      select: { id: true, razaoSocial: true, nomeFantasia: true },
    });
    if (empresas.length !== new Set(destinos).size) throw new BadRequestException('Há empresas de destino inexistentes.');
    const exportado = await this.exportar(origemId, id, autorId);
    const resultados: CopiaModeloResultado[] = [];
    for (const e of empresas) {
      const empresaNome = e.nomeFantasia || e.razaoSocial;
      try {
        const r = await this.criarDeExportado(e.id, exportado, autorId, 'modelo.copiar_recebido', { origemEmpresaId: origemId, origemModeloId: id });
        resultados.push({ empresaId: e.id, empresaNome, modeloId: r.modelo.id, nome: r.modelo.nome, avisos: r.avisos, erro: null });
      } catch (erro) {
        resultados.push({ empresaId: e.id, empresaNome, modeloId: null, nome: null, avisos: [], erro: (erro as Error).message });
      }
    }
    await this.auditoria.registrar({
      empresaId: origemId,
      usuarioId: autorId,
      acao: 'modelo.copiar',
      entidade: 'ModeloEtiqueta',
      entidadeId: id,
      detalhes: { destinos: resultados.map((r) => ({ empresaId: r.empresaId, modeloId: r.modeloId, erro: r.erro })) },
    });
    return resultados;
  }

  /** Cria o modelo no destino: nome livre, consulta equivalente (do mesmo template do ERP ou de mesmo nome). */
  private async criarDeExportado(
    empresaId: string,
    dados: ModeloExportado,
    autorId: string,
    acao: string,
    origem?: Record<string, string>,
  ): Promise<{ modelo: ModeloEtiquetaResumo; avisos: string[] }> {
    exigirLayoutValido(dados.layout);
    const avisos: string[] = [];

    const usados = new Set((await this.prisma.modeloEtiqueta.findMany({ where: { empresaId }, select: { nome: true } })).map((m) => m.nome.toLowerCase()));
    const base = dados.nome.trim().slice(0, 70);
    let nome = base;
    for (let n = 2; usados.has(nome.toLowerCase()); n++) nome = `${base} (${n})`;
    if (nome !== base) avisos.push(`Já existia um modelo "${base}"; o novo se chama "${nome}".`);

    let consultaId: string | null = null;
    if (dados.consulta) {
      const c =
        (dados.consulta.templateConsultaId &&
          (await this.prisma.consultaSql.findFirst({
            where: { empresaId, templateConsultaId: dados.consulta.templateConsultaId, ativo: true },
            select: { id: true, nome: true, campos: true },
          }))) ||
        (await this.prisma.consultaSql.findFirst({
          where: { empresaId, nome: { equals: dados.consulta.nome, mode: 'insensitive' }, ativo: true },
          select: { id: true, nome: true, campos: true },
        }));
      if (c) {
        consultaId = c.id;
        const campos = new Set((c.campos as unknown as CampoDinamico[]).map((x) => x.nome.toLowerCase()));
        const faltando = camposUsados(dados.layout).filter((x) => !campos.has(x.toLowerCase()));
        if (campos.size && faltando.length) avisos.push(`A consulta "${c.nome}" não devolve: ${faltando.join(', ')}.`);
      } else {
        avisos.push(`Nenhuma consulta equivalente a "${dados.consulta.nome}" nesta empresa: vincule a consulta no editor do modelo.`);
      }
    }

    const modelo = await this.prisma.modeloEtiqueta.create({
      data: { empresaId, nome, descricao: dados.descricao, consultaId, layout: dados.layout as unknown as Prisma.InputJsonObject },
      select: SELECAO,
    });
    await this.auditoria.registrar({
      empresaId,
      usuarioId: autorId,
      acao,
      entidade: 'ModeloEtiqueta',
      entidadeId: modelo.id,
      detalhes: { nome, consultaId, avisos, ...origem },
    });
    return { modelo: resumo(modelo), avisos };
  }

  /** Consultas ativas com seus campos, para o editor (sem o SQL: quem edita etiqueta pode não ter `sql.ver`). */
  async consultasDisponiveis(empresaId: string): Promise<ConsultaParaModelo[]> {
    const consultas = await this.consultas.listar(empresaId);
    return consultas
      .filter((c) => c.ativo)
      .map((c) => ({
        id: c.id,
        nome: c.nome,
        finalidade: c.finalidade,
        campos: c.campos,
        parametros: c.placeholders.filter(ehParametro).map((p) => p.slice(PREFIXO_PARAMETRO.length)),
      }));
  }

  /** Executa a consulta do modelo e devolve algumas linhas para pré-visualizar no editor. */
  async amostra(empresaId: string, id: string, dto: AmostraDto, usuarioId: string): Promise<AmostraModelo> {
    const modelo = await this.buscar(empresaId, id);
    if (!modelo.consultaId) throw new BadRequestException('Este modelo não tem consulta vinculada.');
    const consulta = await this.consultas.obter(empresaId, modelo.consultaId);
    const resultado = await this.consultas.executar(empresaId, modelo.consultaId, usuarioId, dto.parametros ?? {}, dto.limite ?? 5);
    const nomes = new Set(resultado.colunas.map((c) => c.nome.toLowerCase()));
    return {
      registros: linhasParaRegistros(resultado.colunas, resultado.linhas),
      campos: consulta.campos,
      camposAusentes: camposUsados(modelo.layout as unknown as LayoutEtiqueta).filter((c) => !nomes.has(c.toLowerCase())),
    };
  }

  /**
   * Gera a saída na linguagem da impressora para um layout (salvo ou ainda em edição) e
   * registros fornecidos. Base da pré-visualização agora e da impressão na Fase 5.
   */
  async gerar(empresaId: string, dto: GerarDto): Promise<SaidaEtiquetas> {
    exigirLayoutValido(dto.layout);
    validarRegistros(dto.registros);

    let linguagem = dto.linguagem;
    let dpi = dto.dpi;
    if (dto.impressoraId) {
      const impressora = await this.prisma.impressora.findFirst({
        where: { id: dto.impressoraId, empresaId },
        select: { linguagem: true, dpi: true },
      });
      if (!impressora) throw new BadRequestException('Impressora inválida para esta empresa.');
      linguagem = impressora.linguagem;
      dpi = impressora.dpi;
    }
    if (!linguagem) throw new BadRequestException('Informe a impressora ou a linguagem.');
    const hoje = agoraNoFuso(new Date(), config().fusoHorario).data;
    return gerarSaida(dto.layout, dto.registros, linguagem, dpi ?? 203, hoje);
  }

  private async exigirImpressoraDaEmpresa(empresaId: string, impressoraId: string) {
    const impressora = await this.prisma.impressora.findFirst({ where: { id: impressoraId, empresaId }, select: { id: true } });
    if (!impressora) throw new BadRequestException('Impressora inválida para esta empresa.');
  }

  private async exigirConsultaDaEmpresa(empresaId: string, consultaId: string) {
    const consulta = await this.prisma.consultaSql.findFirst({ where: { id: consultaId, empresaId }, select: { id: true } });
    if (!consulta) throw new BadRequestException('Consulta inválida para esta empresa.');
  }

  private async buscar(empresaId: string, id: string) {
    const modelo = await this.prisma.modeloEtiqueta.findFirst({ where: { id, empresaId }, select: SELECAO });
    if (!modelo) throw new NotFoundException('Modelo não encontrado.');
    return modelo;
  }
}

export function gerarSaida(
  layout: LayoutEtiqueta,
  registros: Registro[],
  linguagem: LinguagemImpressora,
  dpi: number,
  hoje: string,
  indiceInicial = 0,
): Promise<SaidaEtiquetas> | SaidaEtiquetas {
  if (linguagem === 'PDF') return gerarPdf(layout, registros, hoje, indiceInicial);
  return GERADORES[linguagem](layout, registros, { dpi, hoje, indiceInicial });
}

function exigirLayoutValido(layout: LayoutEtiqueta) {
  const erros = validarLayout(layout);
  if (erros.length) throw new BadRequestException(erros.slice(0, 10));
}

/** Registros vêm do navegador: só objetos planos com valores simples e tamanho limitado. */
export function validarRegistros(registros: Registro[]) {
  for (const r of registros) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new BadRequestException('Registro inválido.');
    const chaves = Object.keys(r);
    if (chaves.length > MAXIMO_COLUNAS_REGISTRO) throw new BadRequestException('Registro com colunas demais.');
    for (const k of chaves) {
      const v = r[k];
      const simples = v === null || ['string', 'number', 'boolean'].includes(typeof v);
      if (!simples || (typeof v === 'string' && v.length > MAXIMO_TEXTO_VALOR)) {
        throw new BadRequestException(`Valor inválido no campo "${k.slice(0, 50)}".`);
      }
    }
  }
}

function resumo(m: ModeloSelecionado): ModeloEtiquetaResumo {
  return {
    ...m,
    layout: m.layout as unknown as LayoutEtiqueta,
    criadoEm: m.criadoEm.toISOString(),
    atualizadoEm: m.atualizadoEm.toISOString(),
  };
}
