import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { LayoutEtiqueta, LinguagemImpressora, OrigemTrabalho, Registro, TrabalhoResumo } from '@etiquetas/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { config } from '../config';
import { agoraNoFuso } from '../consultas/consultas.service';
import { gerarSaida } from '../modelos/modelos.service';
import { PrismaService } from '../prisma/prisma.service';
import { DespachoService } from './despacho.service';

/** Etiquetas por trabalho: lotes maiores são divididos. */
export const ETIQUETAS_POR_TRABALHO = 2000;

export const SELECAO_TRABALHO = {
  id: true,
  origem: true,
  status: true,
  linguagem: true,
  quantidadeEtiquetas: true,
  modeloNome: true,
  impressoraId: true,
  impressoraNome: true,
  tentativas: true,
  erro: true,
  criadoEm: true,
  concluidoEm: true,
  criadoPor: { select: { nome: true } },
} satisfies Prisma.TrabalhoImpressaoSelect;

type TrabalhoSelecionado = Prisma.TrabalhoImpressaoGetPayload<{ select: typeof SELECAO_TRABALHO }>;

export function resumoTrabalho(t: TrabalhoSelecionado): TrabalhoResumo {
  const { criadoPor, criadoEm, concluidoEm, ...resto } = t;
  return { ...resto, criadoPor: criadoPor?.nome ?? null, criadoEm: criadoEm.toISOString(), concluidoEm: concluidoEm?.toISOString() ?? null };
}

export interface GrupoImpressao {
  modelo: { id: string; nome: string; layout: LayoutEtiqueta };
  impressora: { id: string; nome: string; linguagem: LinguagemImpressora; dpi: number };
  /** Um registro por etiqueta (já repetido conforme a quantidade). */
  registros: Registro[];
  /** Itens da lista do dia cobertos por este grupo. */
  itemIds: string[];
  origem: OrigemTrabalho;
}

/** Converte a saída do gerador nos bytes que vão para a impressora. */
function emBytes(conteudo: string, codificacao: 'texto' | 'base64'): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(codificacao === 'base64' ? Buffer.from(conteudo, 'base64') : Buffer.from(conteudo, 'utf8'));
}

@Injectable()
export class TrabalhosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly despacho: DespachoService,
  ) {}

  /**
   * Gera o conteúdo na linguagem da impressora e grava os trabalhos (fila durável).
   * PDF não passa pelo agente: fica concluído e é baixado/impresso pelo navegador.
   */
  async criar(empresaId: string, usuarioId: string, grupo: GrupoImpressao): Promise<{ trabalhos: TrabalhoResumo[]; avisos: string[] }> {
    const hoje = agoraNoFuso(new Date(), config().fusoHorario).data;
    const trabalhos: TrabalhoResumo[] = [];
    const avisos: string[] = [];
    const ehPdf = grupo.impressora.linguagem === 'PDF';

    for (let i = 0; i < grupo.registros.length; i += ETIQUETAS_POR_TRABALHO) {
      const lote = grupo.registros.slice(i, i + ETIQUETAS_POR_TRABALHO);
      const saida = await gerarSaida(grupo.modelo.layout, lote, grupo.impressora.linguagem, grupo.impressora.dpi, hoje, i);
      avisos.push(...saida.avisos.map((a) => `${grupo.modelo.nome}: ${a}`));
      const agora = new Date();

      const trabalho = await this.prisma.$transaction(async (tx) => {
        const t = await tx.trabalhoImpressao.create({
          data: {
            empresaId,
            impressoraId: grupo.impressora.id,
            impressoraNome: grupo.impressora.nome,
            modeloNome: grupo.modelo.nome,
            linguagem: grupo.impressora.linguagem,
            origem: grupo.origem,
            quantidadeEtiquetas: lote.length,
            conteudo: emBytes(saida.conteudo, saida.codificacao),
            status: ehPdf ? 'CONCLUIDO' : 'PENDENTE',
            concluidoEm: ehPdf ? agora : null,
            criadoPorId: usuarioId,
          },
          select: SELECAO_TRABALHO,
        });
        // Os itens ficam ligados ao primeiro lote; os demais lotes do mesmo grupo só levam etiquetas.
        if (i === 0 && grupo.itemIds.length) {
          await tx.itemLista.updateMany({
            where: { id: { in: grupo.itemIds }, empresaId },
            data: { trabalhoId: t.id, status: ehPdf ? 'IMPRESSO' : 'NA_FILA', impressoEm: ehPdf ? agora : null },
          });
        }
        await this.auditoria.registrar(
          {
            empresaId,
            usuarioId,
            acao: 'impressao.criar',
            entidade: 'TrabalhoImpressao',
            entidadeId: t.id,
            detalhes: { origem: grupo.origem, modelo: grupo.modelo.nome, impressora: grupo.impressora.nome, etiquetas: lote.length },
          },
          tx,
        );
        return t;
      });
      trabalhos.push(resumoTrabalho(trabalho));
      if (!ehPdf) this.despacho.despachar(trabalho.id);
    }
    return { trabalhos, avisos };
  }

  async listar(empresaId: string, limite = 100): Promise<TrabalhoResumo[]> {
    const lista = await this.prisma.trabalhoImpressao.findMany({
      where: { empresaId },
      orderBy: { criadoEm: 'desc' },
      take: Math.min(500, Math.max(1, limite)),
      select: SELECAO_TRABALHO,
    });
    return lista.map(resumoTrabalho);
  }

  /** Situação de trabalhos específicos (a tela acompanha os que acabou de enviar). */
  async situacao(empresaId: string, ids: string[]): Promise<TrabalhoResumo[]> {
    const lista = await this.prisma.trabalhoImpressao.findMany({
      where: { empresaId, id: { in: ids.slice(0, 200) } },
      select: SELECAO_TRABALHO,
    });
    return lista.map(resumoTrabalho);
  }

  async conteudo(empresaId: string, id: string) {
    const t = await this.prisma.trabalhoImpressao.findFirst({
      where: { id, empresaId },
      select: { conteudo: true, linguagem: true, modeloNome: true, criadoEm: true },
    });
    if (!t) throw new NotFoundException('Trabalho não encontrado.');
    return t;
  }

  /** Volta para a fila um trabalho com erro (ou cancelado) e os itens dele. */
  async reenviar(empresaId: string, id: string, usuarioId: string): Promise<TrabalhoResumo> {
    const t = await this.buscar(empresaId, id);
    if (t.linguagem === 'PDF') throw new BadRequestException('Trabalhos em PDF são impressos pelo navegador: baixe o arquivo.');
    if (t.status !== 'ERRO' && t.status !== 'CANCELADO') throw new BadRequestException('Só trabalhos com erro ou cancelados podem ser reenviados.');
    const atualizado = await this.prisma.$transaction(async (tx) => {
      await tx.itemLista.updateMany({ where: { trabalhoId: id, empresaId, status: 'PENDENTE' }, data: { status: 'NA_FILA' } });
      const r = await tx.trabalhoImpressao.update({ where: { id }, data: { status: 'PENDENTE', erro: null }, select: SELECAO_TRABALHO });
      await this.auditoria.registrar({ empresaId, usuarioId, acao: 'impressao.reenviar', entidade: 'TrabalhoImpressao', entidadeId: id }, tx);
      return r;
    });
    this.despacho.despachar(id);
    return resumoTrabalho(atualizado);
  }

  /** Cancela um trabalho que ainda não foi impresso; os itens voltam para a lista. */
  async cancelar(empresaId: string, id: string, usuarioId: string): Promise<TrabalhoResumo> {
    const t = await this.buscar(empresaId, id);
    if (t.status !== 'PENDENTE' && t.status !== 'ERRO') throw new BadRequestException('Só trabalhos aguardando ou com erro podem ser cancelados.');
    const atualizado = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.trabalhoImpressao.updateMany({ where: { id, status: { in: ['PENDENTE', 'ERRO'] } }, data: { status: 'CANCELADO' } });
      if (count === 0) throw new BadRequestException('O trabalho começou a ser enviado e não pode mais ser cancelado.');
      await tx.itemLista.updateMany({
        where: { trabalhoId: id, empresaId, status: { in: ['NA_FILA', 'PENDENTE'] } },
        data: { status: 'PENDENTE', trabalhoId: null },
      });
      await this.auditoria.registrar({ empresaId, usuarioId, acao: 'impressao.cancelar', entidade: 'TrabalhoImpressao', entidadeId: id }, tx);
      return tx.trabalhoImpressao.findUniqueOrThrow({ where: { id }, select: SELECAO_TRABALHO });
    });
    return resumoTrabalho(atualizado);
  }

  private async buscar(empresaId: string, id: string) {
    const t = await this.prisma.trabalhoImpressao.findFirst({ where: { id, empresaId }, select: { id: true, status: true, linguagem: true } });
    if (!t) throw new NotFoundException('Trabalho não encontrado.');
    return t;
  }
}
