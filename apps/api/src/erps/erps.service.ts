import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ErroPlaceholder,
  extrairPlaceholders,
  type CampoEsperado,
  type SistemaErpDetalhe,
  type SistemaErpResumo,
  type TemplateConsultaResumo,
  type TipoBanco,
} from '@etiquetas/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ehViolacaoUnica } from '../prisma/erros';
import { PrismaService } from '../prisma/prisma.service';
import type { AtualizarSistemaErpDto, AtualizarTemplateConsultaDto, CriarSistemaErpDto, TemplateConsultaDto } from './dto';

const SELECAO_SISTEMA = {
  id: true,
  nome: true,
  fabricante: true,
  tipoBanco: true,
  descricao: true,
  ativo: true,
  atualizadoEm: true,
  _count: { select: { consultas: true, empresas: true } },
} satisfies Prisma.SistemaErpSelect;

export const SELECAO_TEMPLATE = {
  id: true,
  nome: true,
  descricao: true,
  finalidade: true,
  sql: true,
  camposEsperados: true,
  ordem: true,
  atualizadoEm: true,
} satisfies Prisma.TemplateConsultaSelect;

type SistemaSelecionado = Prisma.SistemaErpGetPayload<{ select: typeof SELECAO_SISTEMA }>;
type TemplateSelecionado = Prisma.TemplateConsultaGetPayload<{ select: typeof SELECAO_TEMPLATE }>;

export function resumoTemplate(t: TemplateSelecionado): TemplateConsultaResumo {
  return { ...t, camposEsperados: t.camposEsperados as unknown as CampoEsperado[], atualizadoEm: t.atualizadoEm.toISOString() };
}

function resumoSistema(s: SistemaSelecionado): SistemaErpResumo {
  const { _count, atualizadoEm, ...resto } = s;
  return { ...resto, totalConsultas: _count.consultas, totalEmpresas: _count.empresas, atualizadoEm: atualizadoEm.toISOString() };
}

/** Placeholders válidos para o dialeto do ERP: o template é copiado como está para as empresas. */
function validarSqlTemplate(sql: string, tipo: TipoBanco, nome?: string) {
  try {
    extrairPlaceholders(sql, tipo);
  } catch (e) {
    if (e instanceof ErroPlaceholder) throw new BadRequestException(nome ? `${nome}: ${e.message}` : e.message);
    throw e;
  }
}

function camposUnicos(campos: CampoEsperado[] | undefined): Prisma.InputJsonArray | undefined {
  if (!campos) return undefined;
  const nomes = campos.map((c) => c.campo.toLowerCase());
  if (new Set(nomes).size !== nomes.length) throw new BadRequestException('Há campos repetidos no mapeamento.');
  return campos.map((c) => ({ campo: c.campo, ...(c.origem?.trim() ? { origem: c.origem.trim() } : {}), ...(c.descricao?.trim() ? { descricao: c.descricao.trim() } : {}) }));
}

/** Cadastro de ERPs e templates. Dados da plataforma (não pertencem a um tenant): só super-admin. */
@Injectable()
export class ErpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar(): Promise<SistemaErpResumo[]> {
    const lista = await this.prisma.sistemaErp.findMany({ orderBy: { nome: 'asc' }, select: SELECAO_SISTEMA });
    return lista.map(resumoSistema);
  }

  async obter(id: string): Promise<SistemaErpDetalhe> {
    const s = await this.prisma.sistemaErp.findUnique({
      where: { id },
      select: { ...SELECAO_SISTEMA, consultas: { select: SELECAO_TEMPLATE, orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] } },
    });
    if (!s) throw new NotFoundException('Sistema ERP não encontrado.');
    const { consultas, ...resto } = s;
    return { ...resumoSistema(resto), consultas: consultas.map(resumoTemplate) };
  }

  async criar(dto: CriarSistemaErpDto, autorId: string): Promise<SistemaErpDetalhe> {
    try {
      const s = await this.prisma.sistemaErp.create({
        data: { nome: dto.nome.trim(), fabricante: dto.fabricante?.trim() || null, tipoBanco: dto.tipoBanco, descricao: dto.descricao?.trim() || null },
        select: { id: true },
      });
      await this.auditoria.registrar({ empresaId: null, usuarioId: autorId, acao: 'erp.criar', entidade: 'SistemaErp', entidadeId: s.id, detalhes: { ...dto } });
      return this.obter(s.id);
    } catch (e) {
      if (ehViolacaoUnica(e)) throw new ConflictException('Já existe um ERP com este nome.');
      throw e;
    }
  }

  async atualizar(id: string, dto: AtualizarSistemaErpDto, autorId: string): Promise<SistemaErpDetalhe> {
    const atual = await this.obter(id);
    // Trocar o tipo de banco exige que todo o template continue válido no novo dialeto.
    if (dto.tipoBanco && dto.tipoBanco !== atual.tipoBanco) {
      for (const c of atual.consultas) validarSqlTemplate(c.sql, dto.tipoBanco, c.nome);
    }
    try {
      await this.prisma.sistemaErp.update({
        where: { id },
        data: {
          nome: dto.nome?.trim(),
          fabricante: dto.fabricante === undefined ? undefined : dto.fabricante.trim() || null,
          tipoBanco: dto.tipoBanco,
          descricao: dto.descricao === undefined ? undefined : dto.descricao.trim() || null,
          ativo: dto.ativo,
        },
      });
    } catch (e) {
      if (ehViolacaoUnica(e)) throw new ConflictException('Já existe um ERP com este nome.');
      throw e;
    }
    await this.auditoria.registrar({ empresaId: null, usuarioId: autorId, acao: 'erp.editar', entidade: 'SistemaErp', entidadeId: id, detalhes: { ...dto } });
    return this.obter(id);
  }

  async excluir(id: string, autorId: string) {
    const atual = await this.obter(id);
    if (atual.totalEmpresas > 0) {
      throw new ConflictException(`${atual.totalEmpresas} empresa(s) usam este ERP. Desvincule-as ou desative o ERP.`);
    }
    await this.prisma.sistemaErp.delete({ where: { id } });
    await this.auditoria.registrar({ empresaId: null, usuarioId: autorId, acao: 'erp.excluir', entidade: 'SistemaErp', entidadeId: id, detalhes: { nome: atual.nome } });
  }

  async criarConsulta(sistemaId: string, dto: TemplateConsultaDto, autorId: string): Promise<TemplateConsultaResumo> {
    const sistema = await this.obter(sistemaId);
    validarSqlTemplate(dto.sql, sistema.tipoBanco);
    try {
      const t = await this.prisma.templateConsulta.create({
        data: {
          sistemaErpId: sistemaId,
          nome: dto.nome.trim(),
          descricao: dto.descricao?.trim() || null,
          finalidade: dto.finalidade,
          sql: dto.sql,
          camposEsperados: camposUnicos(dto.camposEsperados) ?? [],
          ordem: dto.ordem ?? sistema.consultas.length,
        },
        select: SELECAO_TEMPLATE,
      });
      await this.auditoria.registrar({
        empresaId: null,
        usuarioId: autorId,
        acao: 'erp.consulta.criar',
        entidade: 'TemplateConsulta',
        entidadeId: t.id,
        detalhes: { sistemaErpId: sistemaId, nome: t.nome },
      });
      return resumoTemplate(t);
    } catch (e) {
      if (ehViolacaoUnica(e)) throw new ConflictException('Este ERP já tem uma consulta com este nome.');
      throw e;
    }
  }

  async atualizarConsulta(sistemaId: string, id: string, dto: AtualizarTemplateConsultaDto, autorId: string): Promise<TemplateConsultaResumo> {
    const sistema = await this.obter(sistemaId);
    if (!sistema.consultas.some((c) => c.id === id)) throw new NotFoundException('Consulta do template não encontrada.');
    if (dto.sql !== undefined) validarSqlTemplate(dto.sql, sistema.tipoBanco);
    try {
      const t = await this.prisma.templateConsulta.update({
        where: { id },
        data: {
          nome: dto.nome?.trim(),
          descricao: dto.descricao === undefined ? undefined : dto.descricao.trim() || null,
          finalidade: dto.finalidade,
          sql: dto.sql,
          camposEsperados: camposUnicos(dto.camposEsperados),
          ordem: dto.ordem,
        },
        select: SELECAO_TEMPLATE,
      });
      await this.auditoria.registrar({
        empresaId: null,
        usuarioId: autorId,
        acao: 'erp.consulta.editar',
        entidade: 'TemplateConsulta',
        entidadeId: id,
        detalhes: { ...dto, sql: dto.sql?.slice(0, 2000) } as unknown as Prisma.InputJsonObject,
      });
      return resumoTemplate(t);
    } catch (e) {
      if (ehViolacaoUnica(e)) throw new ConflictException('Este ERP já tem uma consulta com este nome.');
      throw e;
    }
  }

  /** As cópias nas empresas continuam; só perdem o vínculo com o template. */
  async excluirConsulta(sistemaId: string, id: string, autorId: string) {
    const { count } = await this.prisma.templateConsulta.deleteMany({ where: { id, sistemaErpId: sistemaId } });
    if (count === 0) throw new NotFoundException('Consulta do template não encontrada.');
    await this.auditoria.registrar({ empresaId: null, usuarioId: autorId, acao: 'erp.consulta.excluir', entidade: 'TemplateConsulta', entidadeId: id });
  }
}
