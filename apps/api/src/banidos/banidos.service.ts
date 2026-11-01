import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { codigoBarrasValido, normalizarCodigoBarras, type BanirResposta, type ProdutoBanidoResumo } from '@etiquetas/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PrismaService } from '../prisma/prisma.service';
import type { BanirDto } from './dto';

const MAXIMO_LISTADOS = 5000;

/** Produtos que não saem em etiqueta. Chave: empresa + código de barras normalizado. */
@Injectable()
export class BanidosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar(empresaId: string): Promise<ProdutoBanidoResumo[]> {
    const lista = await this.prisma.produtoBanido.findMany({ where: { empresaId }, orderBy: { criadoEm: 'desc' }, take: MAXIMO_LISTADOS });
    return lista.map((b) => ({ codigoBarras: b.codigoBarras, motivo: b.motivo, criadoPor: b.criadoPor, criadoEm: b.criadoEm.toISOString() }));
  }

  /** Códigos banidos da empresa, para conferir cada registro antes de imprimir. */
  async conjunto(empresaId: string): Promise<Set<string>> {
    const lista = await this.prisma.produtoBanido.findMany({ where: { empresaId }, select: { codigoBarras: true } });
    return new Set(lista.map((b) => b.codigoBarras));
  }

  /** Inclui um ou vários códigos; quem já está banido fica como está. */
  async banir(empresaId: string, dto: BanirDto, autorId: string): Promise<BanirResposta> {
    const codigos = [...new Set(dto.codigos.map(normalizarCodigoBarras).filter(Boolean))];
    if (codigos.length === 0) throw new BadRequestException('Informe ao menos um código de barras.');
    const invalido = codigos.find((c) => !codigoBarrasValido(c));
    if (invalido) throw new BadRequestException(`Código de barras inválido: ${invalido.slice(0, 80)}`);
    const motivo = dto.motivo?.trim() || null;
    const autor = await this.prisma.usuario.findUnique({ where: { id: autorId }, select: { nome: true } });
    const { count } = await this.prisma.produtoBanido.createMany({
      data: codigos.map((codigoBarras) => ({ empresaId, codigoBarras, motivo, criadoPor: autor?.nome ?? null })),
      skipDuplicates: true,
    });
    await this.auditoria.registrar({
      empresaId,
      usuarioId: autorId,
      acao: 'produto_banido.incluir',
      entidade: 'ProdutoBanido',
      detalhes: { incluidos: count, codigos: codigos.slice(0, 100), motivo },
    });
    return { incluidos: count, jaBanidos: codigos.length - count };
  }

  async liberar(empresaId: string, codigo: string, autorId: string) {
    const codigoBarras = normalizarCodigoBarras(codigo);
    const { count } = await this.prisma.produtoBanido.deleteMany({ where: { empresaId, codigoBarras } });
    if (count === 0) throw new NotFoundException('Código não encontrado entre os banidos.');
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'produto_banido.excluir', entidade: 'ProdutoBanido', detalhes: { codigoBarras } });
  }
}
