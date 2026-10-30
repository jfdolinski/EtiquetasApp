import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ImpressoraResumo, MetodoImpressora } from '@etiquetas/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ehViolacaoUnica } from '../prisma/erros';
import { PrismaService } from '../prisma/prisma.service';
import type { AtualizarImpressoraDto, CadastrarImpressoraAgenteDto, CriarImpressoraDto } from './dto';

/** Limite de impressoras cadastradas pelo painel de um agente. */
const MAXIMO_POR_AGENTE = 50;

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

  /** Impressoras que o próprio agente entrega (painel do agente no Windows). */
  async listarDoAgente(empresaId: string, agenteId: string): Promise<ImpressoraResumo[]> {
    const lista = await this.prisma.impressora.findMany({ where: { empresaId, agenteId }, orderBy: { nome: 'asc' }, select: SELECAO });
    return lista.map(resumo);
  }

  /**
   * Cadastro pelo painel do agente: a impressora fica ligada a ele. Repetir o cadastro da
   * mesma impressora (mesmo método e endereço) devolve a existente; nome em uso ganha sufixo.
   */
  async cadastrarPeloAgente(empresaId: string, agenteId: string, dto: CadastrarImpressoraAgenteDto): Promise<ImpressoraResumo & { jaExistia: boolean }> {
    const endereco = normalizarEndereco(dto.metodo, dto.endereco);
    const existente = await this.prisma.impressora.findFirst({
      where: { empresaId, agenteId, metodo: dto.metodo, endereco: { equals: endereco, mode: 'insensitive' } },
      select: SELECAO,
    });
    if (existente) return { ...resumo(existente), jaExistia: true };
    if ((await this.prisma.impressora.count({ where: { empresaId, agenteId } })) >= MAXIMO_POR_AGENTE) {
      throw new BadRequestException(`Este agente já tem ${MAXIMO_POR_AGENTE} impressoras cadastradas.`);
    }
    const base = dto.nome.trim();
    for (let n = 1; n <= 20; n++) {
      const nome = n === 1 ? base : `${base} (${n})`.slice(0, 80);
      try {
        const impressora = await this.prisma.impressora.create({
          data: { empresaId, agenteId, nome, linguagem: dto.linguagem, dpi: dto.dpi, metodo: dto.metodo, endereco, modelo: dto.modelo?.trim() || null },
          select: SELECAO,
        });
        await this.auditoria.registrar({
          empresaId,
          usuarioId: null,
          acao: 'impressora.criar',
          entidade: 'Impressora',
          entidadeId: impressora.id,
          detalhes: { ...dto, nome, agenteId, origem: 'painel do agente' },
        });
        return { ...resumo(impressora), jaExistia: false };
      } catch (erro) {
        if (!ehViolacaoUnica(erro)) throw erro;
      }
    }
    throw new ConflictException('Já existem impressoras demais com este nome; escolha outro.');
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
