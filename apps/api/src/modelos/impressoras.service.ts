import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ImpressoraResumo, MetodoImpressora } from '@etiquetas/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ehViolacaoUnica } from '../prisma/erros';
import { PrismaService } from '../prisma/prisma.service';
import type { AtualizarImpressoraDto, CriarImpressoraDto } from './dto';

const SELECAO = {
  id: true,
  nome: true,
  agenteId: true,
  linguagem: true,
  dpi: true,
  metodo: true,
  endereco: true,
  modelo: true,
  larguraMaximaMm: true,
  ativo: true,
  criadoEm: true,
} satisfies Prisma.ImpressoraSelect;

type ImpressoraSelecionada = Prisma.ImpressoraGetPayload<{ select: typeof SELECAO }>;

/** REDE: host ou IP com porta opcional (padrão 9100). */
export function normalizarEndereco(metodo: MetodoImpressora, endereco: string): string {
  const e = endereco.trim();
  if (metodo === 'SISTEMA') return e;
  const m = e.match(/^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(?::(\d{1,5}))?$/);
  const porta = Number(m?.[2] ?? 9100);
  if (!m || porta < 1 || porta > 65535) {
    throw new BadRequestException('Endereço de rede inválido: use IP ou nome, com porta opcional (ex.: 192.168.0.50:9100).');
  }
  return `${m[1]}:${porta}`;
}

/** Impressoras da empresa. Todo método recebe `empresaId` e filtra por ele. */
@Injectable()
export class ImpressorasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar(empresaId: string): Promise<ImpressoraResumo[]> {
    const lista = await this.prisma.impressora.findMany({ where: { empresaId }, orderBy: { nome: 'asc' }, select: SELECAO });
    return lista.map(resumo);
  }

  async criar(empresaId: string, dto: CriarImpressoraDto, autorId: string): Promise<ImpressoraResumo> {
    if (dto.agenteId) await this.exigirAgente(empresaId, dto.agenteId);
    try {
      const impressora = await this.prisma.impressora.create({
        data: {
          empresaId,
          nome: dto.nome.trim(),
          agenteId: dto.agenteId ?? null,
          linguagem: dto.linguagem,
          dpi: dto.dpi,
          metodo: dto.metodo,
          endereco: normalizarEndereco(dto.metodo, dto.endereco),
          modelo: dto.modelo?.trim() || null,
          larguraMaximaMm: dto.larguraMaximaMm ?? null,
        },
        select: SELECAO,
      });
      await this.auditoria.registrar({
        empresaId,
        usuarioId: autorId,
        acao: 'impressora.criar',
        entidade: 'Impressora',
        entidadeId: impressora.id,
        detalhes: { ...dto },
      });
      return resumo(impressora);
    } catch (erro) {
      if (ehViolacaoUnica(erro)) throw new ConflictException('Já existe uma impressora com este nome.');
      throw erro;
    }
  }

  async atualizar(empresaId: string, id: string, dto: AtualizarImpressoraDto, autorId: string): Promise<ImpressoraResumo> {
    const atual = await this.buscar(empresaId, id);
    if (dto.agenteId) await this.exigirAgente(empresaId, dto.agenteId);
    const metodo = dto.metodo ?? atual.metodo;
    const endereco = dto.endereco ?? (dto.metodo ? atual.endereco : undefined);
    try {
      const impressora = await this.prisma.impressora.update({
        where: { id },
        data: {
          nome: dto.nome?.trim(),
          agenteId: dto.agenteId,
          linguagem: dto.linguagem,
          dpi: dto.dpi,
          metodo: dto.metodo,
          endereco: endereco === undefined ? undefined : normalizarEndereco(metodo, endereco),
          modelo: dto.modelo === undefined ? undefined : dto.modelo.trim() || null,
          larguraMaximaMm: dto.larguraMaximaMm,
          ativo: dto.ativo,
        },
        select: SELECAO,
      });
      await this.auditoria.registrar({
        empresaId,
        usuarioId: autorId,
        acao: 'impressora.editar',
        entidade: 'Impressora',
        entidadeId: id,
        detalhes: { ...dto },
      });
      return resumo(impressora);
    } catch (erro) {
      if (ehViolacaoUnica(erro)) throw new ConflictException('Já existe uma impressora com este nome.');
      throw erro;
    }
  }

  async excluir(empresaId: string, id: string, autorId: string) {
    const atual = await this.buscar(empresaId, id);
    await this.prisma.impressora.delete({ where: { id } });
    await this.auditoria.registrar({
      empresaId,
      usuarioId: autorId,
      acao: 'impressora.excluir',
      entidade: 'Impressora',
      entidadeId: id,
      detalhes: { nome: atual.nome },
    });
  }

  private async exigirAgente(empresaId: string, agenteId: string) {
    const agente = await this.prisma.agente.findFirst({ where: { id: agenteId, empresaId }, select: { id: true } });
    if (!agente) throw new BadRequestException('Agente inválido para esta empresa.');
  }

  private async buscar(empresaId: string, id: string) {
    const impressora = await this.prisma.impressora.findFirst({ where: { id, empresaId }, select: SELECAO });
    if (!impressora) throw new NotFoundException('Impressora não encontrada.');
    return impressora;
  }
}

function resumo(i: ImpressoraSelecionada): ImpressoraResumo {
  return { ...i, criadoEm: i.criadoEm.toISOString() };
}
