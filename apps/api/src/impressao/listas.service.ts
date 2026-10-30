import { BadRequestException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  camposUsados,
  chaveDoRegistro,
  descricaoDoRegistro,
  ehParametro,
  extrairPlaceholders,
  linhasParaRegistros,
  PREFIXO_PARAMETRO,
  quantidadeDoRegistro,
  type BuscaAvulsaResposta,
  type ErroLista,
  type ImprimirResposta,
  type LayoutEtiqueta,
  type ListaDiariaResumo,
  type ModeloAvulso,
  type Registro,
  type ResultadoConsulta,
} from '@etiquetas/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { config } from '../config';
import { agoraNoFuso, ConsultasService } from '../consultas/consultas.service';
import { validarRegistros } from '../modelos/modelos.service';
import { PrismaService } from '../prisma/prisma.service';
import { MAXIMO_ETIQUETAS_POR_PEDIDO, type AtualizarItemDto, type ImprimirAvulsaDto, type ImprimirListaDto } from './dto';
import { TrabalhosService } from './trabalhos.service';

/** Linhas lidas por consulta ao montar a lista do dia. */
export const LIMITE_LINHAS_LISTA = 5000;
const LIMITE_LINHAS_BUSCA = 50;

const SELECAO_ITEM = {
  id: true,
  modeloId: true,
  impressoraId: true,
  chave: true,
  descricao: true,
  quantidade: true,
  status: true,
  impressoEm: true,
  trabalhoId: true,
} satisfies Prisma.ItemListaSelect;

const SELECAO_IMPRESSORA = { id: true, nome: true, linguagem: true, dpi: true, ativo: true } satisfies Prisma.ImpressoraSelect;

/** Modelo como a lista do dia precisa (consulta e impressora padrão). */
export type ModeloDaLista = { id: string; nome: string; consultaId: string | null; impressoraId: string | null };

/** AAAA-MM-DD → Date à meia-noite UTC (coluna `date` do Postgres). */
function dataDoDia(dia: string) {
  return new Date(`${dia}T00:00:00Z`);
}

/** Lista do dia e etiquetas avulsas. Todo método recebe `empresaId` e filtra por ele. */
@Injectable()
export class ListasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly consultas: ConsultasService,
    private readonly trabalhos: TrabalhosService,
  ) {}

  private hoje() {
    return agoraNoFuso(new Date(), config().fusoHorario).data;
  }

  /** Lista de hoje (null se ainda não foi gerada). */
  async deHoje(empresaId: string): Promise<ListaDiariaResumo | null> {
    const dia = this.hoje();
    const lista = await this.prisma.listaDiaria.findUnique({
      where: { empresaId_data: { empresaId, data: dataDoDia(dia) } },
      select: { id: true, atualizadoEm: true, erros: true, itens: { select: SELECAO_ITEM, orderBy: [{ descricao: 'asc' }] } },
    });
    if (!lista) return null;
    const [modelos, impressoras] = await Promise.all([
      this.prisma.modeloEtiqueta.findMany({ where: { empresaId }, select: { id: true, nome: true } }),
      this.prisma.impressora.findMany({ where: { empresaId }, select: { id: true, nome: true, linguagem: true } }),
    ]);
    return {
      id: lista.id,
      data: dia,
      atualizadaEm: lista.atualizadoEm.toISOString(),
      erros: lista.erros as unknown as ErroLista[],
      itens: lista.itens.map((i) => ({ ...i, impressoEm: i.impressoEm?.toISOString() ?? null })),
      modelos,
      impressoras,
    };
  }

  /**
   * Monta (ou atualiza) a lista de hoje: executa via agente a consulta de cada modelo
   * marcado para a lista do dia. Itens já impressos, na fila ou descartados hoje não voltam.
   */
  async gerar(empresaId: string, usuarioId: string): Promise<ListaDiariaResumo> {
    const listaId = await this.listaDeHoje(empresaId);
    const modelos = await this.prisma.modeloEtiqueta.findMany({
      where: { empresaId, ativo: true, naListaDiaria: true, consultaId: { not: null } },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true, consultaId: true, impressoraId: true },
    });
    const { novos, erros } = await this.consultarModelos(empresaId, usuarioId, listaId, modelos);

    // Itens de modelos agendados fora da lista do dia são do agendamento: o botão não os apaga.
    const agendados = await this.prisma.agendamentoModelo.findMany({ where: { empresaId, ativo: true }, select: { modeloId: true } });
    const doAgendamento = agendados.map((a) => a.modeloId).filter((id) => !modelos.some((m) => m.id === id));

    await this.prisma.$transaction(async (tx) => {
      await this.substituirPendentes(tx, listaId, doAgendamento.length ? { modeloId: { notIn: doAgendamento } } : {}, novos);
      await tx.listaDiaria.update({ where: { id: listaId }, data: { erros: erros as unknown as Prisma.InputJsonArray, atualizadoEm: new Date() } });
      await this.auditoria.registrar(
        { empresaId, usuarioId, acao: 'lista.gerar', entidade: 'ListaDiaria', entidadeId: listaId, detalhes: { modelos: modelos.length, itens: novos.length, erros: erros.length } },
        tx,
      );
    });

    return (await this.deHoje(empresaId))!;
  }

  /**
   * Agendamento: atualiza na lista de hoje só os itens de um modelo. Se a consulta falhar,
   * os pendentes anteriores ficam como estavam.
   */
  async atualizarModeloNaLista(
    empresaId: string,
    usuarioId: string,
    modelo: ModeloDaLista,
    impressoraId: string | null,
  ): Promise<{ pendentes: number; erro?: string; aviso?: string }> {
    const listaId = await this.listaDeHoje(empresaId);
    const { novos, erros, falhou } = await this.consultarModelos(empresaId, usuarioId, listaId, [modelo], impressoraId);
    if (falhou) return { pendentes: 0, erro: erros[0]?.mensagem };
    const pendentes = await this.prisma.$transaction((tx) => this.substituirPendentes(tx, listaId, { modeloId: modelo.id }, novos));
    await this.prisma.listaDiaria.update({ where: { id: listaId }, data: { atualizadoEm: new Date() } });
    return { pendentes, aviso: erros[0]?.mensagem };
  }

  /** Agendamento com impressão automática: imprime os pendentes do modelo na lista de hoje. */
  async imprimirPendentesDoModelo(empresaId: string, usuarioId: string, modeloId: string): Promise<ImprimirResposta> {
    const listaId = await this.listaDeHoje(empresaId);
    const itens = await this.prisma.itemLista.findMany({
      where: { listaId, empresaId, modeloId, status: 'PENDENTE', trabalhoId: null, quantidade: { gt: 0 } },
      select: { id: true, quantidade: true },
    });
    if (itens.length === 0) return { trabalhos: [], avisos: [] };
    return this.imprimirLista(empresaId, listaId, { itens: itens.map((i) => ({ id: i.id, quantidade: i.quantidade })) }, usuarioId, 'AGENDAMENTO');
  }

  private async listaDeHoje(empresaId: string): Promise<string> {
    const data = dataDoDia(this.hoje());
    const lista = await this.prisma.listaDiaria.upsert({
      where: { empresaId_data: { empresaId, data } },
      create: { empresaId, data },
      update: {},
      select: { id: true },
    });
    return lista.id;
  }

  /** Troca os pendentes (sem trabalho) do escopo pelos itens novos; devolve quantos ficaram. */
  private async substituirPendentes(tx: Prisma.TransactionClient, listaId: string, escopo: Prisma.ItemListaWhereInput, novos: Prisma.ItemListaCreateManyInput[]) {
    await tx.itemLista.deleteMany({ where: { ...escopo, listaId, status: 'PENDENTE', trabalhoId: null } });
    // Pendentes ligados a um trabalho com erro ficam (podem ser reenviados); não duplica.
    const restantes = await tx.itemLista.findMany({ where: { listaId, status: 'PENDENTE' }, select: { modeloId: true, chave: true } });
    const manter = new Set(restantes.map((i) => `${i.modeloId}|${i.chave}`));
    const criar = novos.filter((n) => !manter.has(`${n.modeloId}|${n.chave}`));
    await tx.itemLista.createMany({ data: criar });
    return criar.length;
  }

  /**
   * Executa as consultas dos modelos (uma vez por consulta) e monta os itens que ainda não
   * foram impressos, enviados ou descartados hoje. Não grava nada.
   */
  private async consultarModelos(empresaId: string, usuarioId: string, listaId: string, modelos: ModeloDaLista[], impressoraFixa?: string | null) {
    const existentes = await this.prisma.itemLista.findMany({
      where: { listaId, status: { not: 'PENDENTE' } },
      select: { modeloId: true, chave: true },
    });
    const jaTratados = new Set(existentes.map((i) => `${i.modeloId}|${i.chave}`));

    const erros: ErroLista[] = [];
    let falhou = false;
    const resultados = new Map<string, Promise<ResultadoConsulta>>();
    const novos: Prisma.ItemListaCreateManyInput[] = [];

    for (const modelo of modelos) {
      const consultaId = modelo.consultaId!;
      // Vários modelos com a mesma consulta: executa uma vez só.
      if (!resultados.has(consultaId)) {
        resultados.set(consultaId, this.consultas.executar(empresaId, consultaId, usuarioId, {}, LIMITE_LINHAS_LISTA));
      }
      let resultado: ResultadoConsulta;
      try {
        resultado = await resultados.get(consultaId)!;
      } catch (e) {
        erros.push({ modeloId: modelo.id, modeloNome: modelo.nome, mensagem: e instanceof HttpException ? e.message : 'Erro inesperado.' });
        falhou = true;
        continue;
      }
      if (resultado.truncado) {
        erros.push({ modeloId: modelo.id, modeloNome: modelo.nome, mensagem: `A consulta devolveu mais de ${LIMITE_LINHAS_LISTA} linhas; só as primeiras entraram.` });
      }
      const vistos = new Set<string>();
      for (const registro of linhasParaRegistros(resultado.colunas, resultado.linhas)) {
        const chave = chaveDoRegistro(registro);
        const k = `${modelo.id}|${chave}`;
        if (jaTratados.has(k) || vistos.has(k)) continue;
        vistos.add(k);
        novos.push({
          empresaId,
          listaId,
          modeloId: modelo.id,
          impressoraId: impressoraFixa ?? modelo.impressoraId,
          chave,
          descricao: descricaoDoRegistro(registro),
          registro: registro as Prisma.InputJsonObject,
          quantidade: quantidadeDoRegistro(registro),
        });
      }
    }
    return { novos, erros, falhou };
  }

  async atualizarItem(empresaId: string, id: string, dto: AtualizarItemDto, usuarioId: string) {
    const item = await this.prisma.itemLista.findFirst({ where: { id, empresaId }, select: { id: true, status: true } });
    if (!item) throw new NotFoundException('Item não encontrado.');
    if (item.status === 'NA_FILA' || item.status === 'IMPRESSO') throw new BadRequestException('Este item já foi enviado para impressão.');
    const atualizado = await this.prisma.itemLista.update({ where: { id }, data: { quantidade: dto.quantidade, status: dto.status }, select: SELECAO_ITEM });
    if (dto.status) {
      await this.auditoria.registrar({ empresaId, usuarioId, acao: `lista.item.${dto.status.toLowerCase()}`, entidade: 'ItemLista', entidadeId: id });
    }
    return { ...atualizado, impressoEm: atualizado.impressoEm?.toISOString() ?? null };
  }

  /** Impressão em lote: separa os itens por modelo e impressora e cria um trabalho por grupo. */
  async imprimirLista(
    empresaId: string,
    listaId: string,
    dto: ImprimirListaDto,
    usuarioId: string,
    origem: 'LISTA' | 'AGENDAMENTO' = 'LISTA',
  ): Promise<ImprimirResposta> {
    const quantidades = new Map(dto.itens.map((i) => [i.id, i.quantidade]));
    const total = [...quantidades.values()].reduce((a, b) => a + b, 0);
    if (total > MAXIMO_ETIQUETAS_POR_PEDIDO) throw new BadRequestException(`No máximo ${MAXIMO_ETIQUETAS_POR_PEDIDO} etiquetas por vez.`);

    const itens = await this.prisma.itemLista.findMany({
      where: { id: { in: [...quantidades.keys()] }, listaId, empresaId, status: 'PENDENTE' },
      orderBy: { descricao: 'asc' },
      select: {
        id: true,
        registro: true,
        modelo: { select: { id: true, nome: true, layout: true, ativo: true } },
        impressora: { select: SELECAO_IMPRESSORA },
      },
    });
    if (itens.length === 0) throw new BadRequestException('Nenhum dos itens selecionados está pendente.');

    const grupos = new Map<string, typeof itens>();
    for (const item of itens) {
      const k = `${item.modelo.id}|${item.impressora?.id ?? ''}`;
      grupos.set(k, [...(grupos.get(k) ?? []), item]);
    }

    const resposta: ImprimirResposta = { trabalhos: [], avisos: [] };
    for (const grupo of grupos.values()) {
      const { modelo, impressora } = grupo[0];
      if (!impressora) {
        resposta.avisos.push(`${modelo.nome}: modelo sem impressora definida; ${grupo.length} item(ns) não enviado(s).`);
        continue;
      }
      if (!impressora.ativo) {
        resposta.avisos.push(`${modelo.nome}: a impressora ${impressora.nome} está desativada.`);
        continue;
      }
      // Grava as quantidades ajustadas pelo operador antes de gerar.
      await Promise.all(grupo.map((i) => this.prisma.itemLista.update({ where: { id: i.id }, data: { quantidade: quantidades.get(i.id)! } })));
      const registros = grupo.flatMap((i) => Array<Registro>(quantidades.get(i.id)!).fill(i.registro as Registro));
      const r = await this.trabalhos.criar(empresaId, usuarioId, {
        modelo: { id: modelo.id, nome: modelo.nome, layout: modelo.layout as unknown as LayoutEtiqueta },
        impressora,
        registros,
        itemIds: grupo.map((i) => i.id),
        origem,
      });
      resposta.trabalhos.push(...r.trabalhos);
      resposta.avisos.push(...r.avisos);
    }
    return resposta;
  }

  /** Modelos para etiqueta avulsa: os que têm consulta de busca de produto. */
  async modelosAvulsos(empresaId: string): Promise<ModeloAvulso[]> {
    const modelos = await this.prisma.modeloEtiqueta.findMany({
      where: { empresaId, ativo: true, consulta: { ativo: true, finalidade: 'BUSCA_PRODUTO' } },
      orderBy: { nome: 'asc' },
      select: {
        id: true,
        nome: true,
        impressoraId: true,
        layout: true,
        consulta: { select: { sql: true, campos: true, conexao: { select: { tipo: true } } } },
      },
    });
    return modelos.map((m) => {
      let parametros: string[] = [];
      try {
        parametros = extrairPlaceholders(m.consulta!.sql, m.consulta!.conexao.tipo)
          .filter(ehParametro)
          .map((p) => p.slice(PREFIXO_PARAMETRO.length));
      } catch {
        // SQL inválido aparece como erro na busca.
      }
      // Campos da consulta (na ordem dela) e os que o layout usa: o operador pode digitar qualquer um.
      const daConsulta = Array.isArray(m.consulta!.campos) ? (m.consulta!.campos as { nome?: unknown }[]).map((c) => String(c?.nome ?? '')) : [];
      const campos = [...new Set([...daConsulta, ...camposUsados(m.layout as unknown as LayoutEtiqueta)].filter(Boolean))];
      return { id: m.id, nome: m.nome, impressoraId: m.impressoraId, parametros, campos };
    });
  }

  /** Consulta ao vivo no banco do cliente (via agente) para a etiqueta avulsa. */
  async buscarAvulsa(empresaId: string, modeloId: string, parametros: Record<string, string | null>, usuarioId: string): Promise<BuscaAvulsaResposta> {
    const modelo = await this.prisma.modeloEtiqueta.findFirst({ where: { id: modeloId, empresaId, ativo: true }, select: { consultaId: true } });
    if (!modelo) throw new NotFoundException('Modelo não encontrado.');
    if (!modelo.consultaId) throw new BadRequestException('Este modelo não tem consulta vinculada.');
    const r = await this.consultas.executar(empresaId, modelo.consultaId, usuarioId, parametros, LIMITE_LINHAS_BUSCA);
    return { registros: linhasParaRegistros(r.colunas, r.linhas), colunas: r.colunas.map((c) => c.nome) };
  }

  async imprimirAvulsa(empresaId: string, dto: ImprimirAvulsaDto, usuarioId: string): Promise<ImprimirResposta> {
    validarRegistros(dto.itens.map((i) => i.registro));
    const total = dto.itens.reduce((a, i) => a + i.quantidade, 0);
    if (total > MAXIMO_ETIQUETAS_POR_PEDIDO) throw new BadRequestException(`No máximo ${MAXIMO_ETIQUETAS_POR_PEDIDO} etiquetas por vez.`);

    const modelo = await this.prisma.modeloEtiqueta.findFirst({
      where: { id: dto.modeloId, empresaId, ativo: true },
      select: { id: true, nome: true, layout: true, impressoraId: true },
    });
    if (!modelo) throw new NotFoundException('Modelo não encontrado.');
    const impressoraId = dto.impressoraId ?? modelo.impressoraId;
    if (!impressoraId) throw new BadRequestException('Escolha a impressora (o modelo não tem impressora padrão).');
    const impressora = await this.prisma.impressora.findFirst({ where: { id: impressoraId, empresaId }, select: SELECAO_IMPRESSORA });
    if (!impressora) throw new BadRequestException('Impressora inválida para esta empresa.');
    if (!impressora.ativo) throw new BadRequestException('A impressora está desativada.');

    const r = await this.trabalhos.criar(empresaId, usuarioId, {
      modelo: { id: modelo.id, nome: modelo.nome, layout: modelo.layout as unknown as LayoutEtiqueta },
      impressora,
      registros: dto.itens.flatMap((i) => Array<Registro>(i.quantidade).fill(i.registro)),
      itemIds: [],
      origem: 'AVULSA',
    });
    return { trabalhos: r.trabalhos, avisos: r.avisos };
  }
}
