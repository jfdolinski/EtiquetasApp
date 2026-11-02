import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Logger, Module, NotFoundException, OnApplicationBootstrap, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { aliasValido, FINALIDADES_CONSULTA, finalidadesValidas, REFERENCIAS_SISTEMA, REFERENCIAS_SUGERIDAS, type FinalidadeConsulta, type ReferenciaCampo } from '@etiquetas/shared';
import { ApenasSuperAdmin, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ehViolacaoUnica } from '../prisma/erros';
import { PrismaService } from '../prisma/prisma.service';

class CriarReferenciaDto {
  @IsString()
  @MaxLength(60)
  alias: string;

  @IsString()
  @MinLength(2, { message: 'Informe o que é o campo.' })
  @MaxLength(120)
  nome: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descricao?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  exemplo?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  alternativos?: string[];

  @IsOptional()
  @IsArray()
  @IsIn(FINALIDADES_CONSULTA as FinalidadeConsulta[], { each: true, message: 'Finalidade desconhecida.' })
  obrigatoriaEm?: FinalidadeConsulta[];
}

class AtualizarReferenciaDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  alias?: string;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Informe o que é o campo.' })
  @MaxLength(120)
  nome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descricao?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  exemplo?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  alternativos?: string[];

  @IsOptional()
  @IsArray()
  @IsIn(FINALIDADES_CONSULTA as FinalidadeConsulta[], { each: true, message: 'Finalidade desconhecida.' })
  obrigatoriaEm?: FinalidadeConsulta[];

  @IsOptional()
  @IsBoolean()
  ativa?: boolean;
}

const limparNomes = (nomes: string[] | undefined) => [...new Set((nomes ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean))];

function resumo(r: { id: string; alias: string; nome: string; descricao: string; exemplo: string; alternativos: string[]; obrigatoriaEm: string[]; sistema: boolean; ativa: boolean; ordem: number }): ReferenciaCampo {
  return { ...r, obrigatoriaEm: finalidadesValidas(r.obrigatoriaEm) };
}

/** Índice de campos das consultas. Dado da plataforma (sem `empresa_id`): só o super-admin altera. */
@Injectable()
export class ReferenciasService implements OnApplicationBootstrap {
  private readonly log = new Logger('Referencias');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Os campos do sistema sempre existem; as sugestões só entram com o índice vazio, para não voltarem depois de excluídas. */
  async onApplicationBootstrap() {
    const vazio = (await this.prisma.referenciaCampo.count()) === 0;
    const novas = [...REFERENCIAS_SISTEMA.map((r) => ({ ...r, sistema: true })), ...(vazio ? REFERENCIAS_SUGERIDAS.map((r) => ({ ...r, sistema: false })) : [])];
    const { count } = await this.prisma.referenciaCampo.createMany({ data: novas.map((r, i) => ({ ...r, ordem: (i + 1) * 10 })), skipDuplicates: true });
    if (count) this.log.log(`${count} referência(s) de campo incluída(s) no índice.`);
  }

  async listar(): Promise<ReferenciaCampo[]> {
    const lista = await this.prisma.referenciaCampo.findMany({ orderBy: [{ ordem: 'asc' }, { alias: 'asc' }] });
    return lista.map(resumo);
  }

  async criar(dto: CriarReferenciaDto, autorId: string): Promise<ReferenciaCampo> {
    const alias = dto.alias.trim().toLowerCase();
    const alternativos = limparNomes(dto.alternativos).filter((n) => n !== alias);
    await this.validarNomes(alias, alternativos);
    const ultima = await this.prisma.referenciaCampo.aggregate({ _max: { ordem: true } });
    try {
      const r = await this.prisma.referenciaCampo.create({
        data: { alias, nome: dto.nome.trim(), descricao: dto.descricao?.trim() ?? '', exemplo: dto.exemplo?.trim() ?? '', alternativos, obrigatoriaEm: finalidadesValidas(dto.obrigatoriaEm ?? []), ordem: (ultima._max.ordem ?? 0) + 10 },
      });
      await this.auditoria.registrar({ empresaId: null, usuarioId: autorId, acao: 'referencia.criar', entidade: 'ReferenciaCampo', entidadeId: r.id, detalhes: { alias, obrigatoriaEm: r.obrigatoriaEm } });
      return resumo(r);
    } catch (erro) {
      if (ehViolacaoUnica(erro)) throw new ConflictException(`O alias ${alias} já está no índice.`);
      throw erro;
    }
  }

  async atualizar(id: string, dto: AtualizarReferenciaDto, autorId: string): Promise<ReferenciaCampo> {
    const atual = await this.prisma.referenciaCampo.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException('Referência não encontrada.');
    const alias = dto.alias === undefined ? atual.alias : dto.alias.trim().toLowerCase();
    const alternativos = dto.alternativos === undefined ? atual.alternativos : limparNomes(dto.alternativos).filter((n) => n !== alias);
    if (atual.sistema) {
      // O código do sistema lê estes nomes: mudá-los aqui prometeria algo que ele não entende.
      if (alias !== atual.alias) throw new BadRequestException('O alias deste campo é fixo: o sistema lê o campo por esse nome.');
      if (dto.alternativos !== undefined && JSON.stringify([...alternativos].sort()) !== JSON.stringify([...atual.alternativos].sort())) throw new BadRequestException('Os outros nomes deste campo são fixos: o sistema lê o campo por esses nomes.');
      if (dto.ativa === false) throw new BadRequestException('Este campo é usado pelo sistema e não pode ser desativado.');
    } else {
      await this.validarNomes(alias, alternativos, id);
    }
    try {
      const r = await this.prisma.referenciaCampo.update({
        where: { id },
        data: { alias, alternativos, nome: dto.nome?.trim(), descricao: dto.descricao?.trim(), exemplo: dto.exemplo?.trim(), obrigatoriaEm: dto.obrigatoriaEm && finalidadesValidas(dto.obrigatoriaEm), ativa: dto.ativa },
      });
      await this.auditoria.registrar({ empresaId: null, usuarioId: autorId, acao: 'referencia.editar', entidade: 'ReferenciaCampo', entidadeId: id, detalhes: { ...dto } });
      return resumo(r);
    } catch (erro) {
      if (ehViolacaoUnica(erro)) throw new ConflictException(`O alias ${alias} já está no índice.`);
      throw erro;
    }
  }

  async excluir(id: string, autorId: string) {
    const atual = await this.prisma.referenciaCampo.findUnique({ where: { id }, select: { alias: true, sistema: true } });
    if (!atual) throw new NotFoundException('Referência não encontrada.');
    if (atual.sistema) throw new BadRequestException('Este campo é usado pelo sistema e não pode ser excluído.');
    await this.prisma.referenciaCampo.delete({ where: { id } });
    await this.auditoria.registrar({ empresaId: null, usuarioId: autorId, acao: 'referencia.excluir', entidade: 'ReferenciaCampo', entidadeId: id, detalhes: { alias: atual.alias } });
  }

  /** Um nome explica um campo só: sem isso, a mesma coluna teria dois significados. */
  private async validarNomes(alias: string, alternativos: string[], ignorarId?: string) {
    for (const n of [alias, ...alternativos]) {
      if (!aliasValido(n)) throw new BadRequestException(`Nome inválido: "${n.slice(0, 60)}". Use letras minúsculas sem acento, números e sublinhado, começando por letra.`);
    }
    const outras = await this.prisma.referenciaCampo.findMany({ where: { id: ignorarId ? { not: ignorarId } : undefined }, select: { alias: true, alternativos: true } });
    for (const n of [alias, ...alternativos]) {
      const dona = outras.find((o) => o.alias === n || o.alternativos.includes(n));
      if (dona) throw new ConflictException(`O nome ${n} já pertence ao campo ${dona.alias}.`);
    }
  }
}

@Controller('referencias')
export class ReferenciasController {
  constructor(private readonly referencias: ReferenciasService) {}

  /** Quem monta consulta precisa consultar o índice. */
  @Get()
  @RequerPermissao('sql.ver')
  listar() {
    return this.referencias.listar();
  }

  @Post()
  @ApenasSuperAdmin()
  criar(@Body() dto: CriarReferenciaDto, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.referencias.criar(dto, autor.id);
  }

  @Patch(':id')
  @ApenasSuperAdmin()
  atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarReferenciaDto, @UsuarioAtual() autor: UsuarioRequisicao) {
    return this.referencias.atualizar(id, dto, autor.id);
  }

  @Delete(':id')
  @ApenasSuperAdmin()
  @HttpCode(204)
  async excluir(@Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() autor: UsuarioRequisicao) {
    await this.referencias.excluir(id, autor.id);
  }
}

@Module({
  controllers: [ReferenciasController],
  providers: [ReferenciasService],
})
export class ReferenciasModule {}
