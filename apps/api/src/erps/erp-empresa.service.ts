import { BadRequestException, Injectable } from '@nestjs/common';
import {
  situacaoCopia,
  type CampoDinamico,
  type CopiarTemplateResposta,
  type ErpDaEmpresa,
} from '@etiquetas/shared';
import { ConexoesService } from '../agentes/conexoes.service';
import { ConsultasService, hashSql } from '../consultas/consultas.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CopiarTemplateDto } from './dto';
import { resumoTemplate, SELECAO_TEMPLATE } from './erps.service';

/** O ERP vinculado vista pela empresa: template, cópias e cópia de novas consultas. */
@Injectable()
export class ErpEmpresaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consultas: ConsultasService,
    private readonly conexoes: ConexoesService,
  ) {}

  async obter(empresaId: string): Promise<ErpDaEmpresa> {
    const empresa = await this.prisma.empresa.findUniqueOrThrow({
      where: { id: empresaId },
      select: {
        sistemaErp: {
          select: {
            id: true,
            nome: true,
            fabricante: true,
            tipoBanco: true,
            descricao: true,
            consultas: { select: SELECAO_TEMPLATE, orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] },
          },
        },
      },
    });
    if (!empresa.sistemaErp) return { sistema: null, consultas: [] };
    const { consultas: templates, ...sistema } = empresa.sistemaErp;

    const copias = await this.prisma.consultaSql.findMany({
      where: { empresaId, templateConsultaId: { in: templates.map((t) => t.id) } },
      select: { id: true, nome: true, sql: true, campos: true, templateConsultaId: true, templateSqlHash: true },
    });

    return {
      sistema,
      consultas: templates.map((t) => {
        const template = resumoTemplate(t);
        const copia = copias.find((c) => c.templateConsultaId === t.id);
        if (!copia) return { template, copia: null };
        const campos = (copia.campos as unknown as CampoDinamico[]).map((c) => c.nome.toLowerCase());
        return {
          template,
          copia: {
            id: copia.id,
            nome: copia.nome,
            situacao: situacaoCopia(hashSql(copia.sql), copia.templateSqlHash, hashSql(t.sql)),
            // Só dá para comparar depois que as colunas foram lidas.
            camposFaltando: campos.length ? template.camposEsperados.filter((e) => !campos.includes(e.campo.toLowerCase())).map((e) => e.campo) : [],
          },
        };
      }),
    };
  }

  /**
   * Copia consultas do template para a empresa, na conexão escolhida. Consultas já
   * copiadas são puladas (use "restaurar do template" para atualizar uma cópia).
   */
  async copiar(empresaId: string, dto: CopiarTemplateDto, autorId: string): Promise<CopiarTemplateResposta> {
    const erp = await this.obter(empresaId);
    if (!erp.sistema) throw new BadRequestException('A empresa não tem ERP vinculado.');
    const tipoConexao = await this.conexoes.tipo(empresaId, dto.conexaoId).catch(() => {
      throw new BadRequestException('Conexão inválida para esta empresa.');
    });
    if (tipoConexao !== erp.sistema.tipoBanco) {
      throw new BadRequestException(`O template do ${erp.sistema.nome} é para ${erp.sistema.tipoBanco}; a conexão escolhida é ${tipoConexao}.`);
    }

    const escolhidas = dto.templateIds ? erp.consultas.filter((c) => dto.templateIds!.includes(c.template.id)) : erp.consultas;
    if (dto.templateIds && escolhidas.length !== new Set(dto.templateIds).size) {
      throw new BadRequestException('Há consultas que não pertencem ao template do ERP da empresa.');
    }

    const nomesUsados = new Set(
      (await this.prisma.consultaSql.findMany({ where: { empresaId }, select: { nome: true } })).map((c) => c.nome.toLowerCase()),
    );
    const resposta: CopiarTemplateResposta = { copiadas: [], avisos: [] };

    for (const { template, copia } of escolhidas) {
      if (copia) {
        resposta.avisos.push(`"${template.nome}" já foi copiada (como "${copia.nome}").`);
        continue;
      }
      let nome = template.nome;
      for (let n = 2; nomesUsados.has(nome.toLowerCase()); n++) nome = `${template.nome} (${n})`.slice(0, 80);
      nomesUsados.add(nome.toLowerCase());
      if (nome !== template.nome) resposta.avisos.push(`"${template.nome}" foi copiada como "${nome}" (nome já em uso).`);

      const r = await this.consultas.criar(
        empresaId,
        { conexaoId: dto.conexaoId, nome, descricao: template.descricao ?? undefined, finalidade: template.finalidade, sql: template.sql },
        autorId,
        { templateConsultaId: template.id, sql: template.sql },
      );
      resposta.copiadas.push({ templateId: template.id, consultaId: r.consulta.id, nome });
      resposta.avisos.push(...r.avisos.map((a) => `${nome}: ${a}`));
    }
    return resposta;
  }
}
