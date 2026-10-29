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
  type LayoutEtiqueta,
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
    try {
      const modelo = await this.prisma.modeloEtiqueta.create({
        data: {
          empresaId,
          nome: dto.nome.trim(),
          descricao: dto.descricao?.trim() || null,
          consultaId: dto.consultaId ?? null,
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
    try {
      const modelo = await this.prisma.modeloEtiqueta.update({
        where: { id },
        data: {
          nome: dto.nome?.trim(),
          descricao: dto.descricao === undefined ? undefined : dto.descricao.trim() || null,
          consultaId: dto.consultaId,
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
        detalhes: { nome: dto.nome, consultaId: dto.consultaId, ativo: dto.ativo, layoutAlterado: Boolean(dto.layout) },
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
): Promise<SaidaEtiquetas> | SaidaEtiquetas {
  if (linguagem === 'PDF') return gerarPdf(layout, registros, hoje);
  return GERADORES[linguagem](layout, registros, { dpi, hoje });
}

function exigirLayoutValido(layout: LayoutEtiqueta) {
  const erros = validarLayout(layout);
  if (erros.length) throw new BadRequestException(erros.slice(0, 10));
}

/** Registros vêm do navegador: só objetos planos com valores simples e tamanho limitado. */
function validarRegistros(registros: Registro[]) {
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
