import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ehConexaoSql,
  ehParametro,
  extrairPlaceholders,
  filtrarPorTermo,
  linhasParaRegistros,
  PARAMETRO_PLANILHA,
  PREFIXO_PARAMETRO,
  problemaNoPost,
  problemaNoTemplate,
  produtoDoRegistro,
  registroBanido,
  type AjustesPost,
  type BuscaProdutosPost,
  type ConsultaPost,
  type ConteudoPost,
  type DadosPost,
  type DesignPost,
  type FormatoPost,
  type ImagemGaleria,
  type ModeloPost,
  type PostCompleto,
  type PostResumo,
  type SituacaoMarcaPost,
  type TemplatePost,
} from '@etiquetas/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { BanidosService } from '../banidos/banidos.service';
import { config } from '../config';
import { ConsultasService } from '../consultas/consultas.service';
import { cifrar } from '../cripto';
import { PrismaService } from '../prisma/prisma.service';
import { tipoDaImagem } from './catalogo.service';

const MAX_IMAGEM_BYTES = 5_000_000;
const MAX_IMAGENS_POR_EMPRESA = 200;
const LIMITE_LINHAS_BUSCA = 50;
const LIMITE_LINHAS_SEM_FILTRO = 5000;
const COR = /^#[0-9a-f]{6}$/i;
const CARENCIA_LIMPEZA_MS = 3_600_000;

export interface AtualizarMarca {
  nome: string;
  corPrincipal: string;
  corDestaque: string;
  logoId: string | null;
  /** Ausente mantém a atual; vazia remove. */
  chaveCatalogo?: string | null;
}

const podeEditarLivre = (u: UsuarioRequisicao) => u.superAdmin || u.permissoes.includes('post.edicao_livre');

function completo(p: { id: string; titulo: string; modelo: string; formato: string; conteudo: unknown; legenda: string; ajustes: unknown; design?: unknown; atualizadoEm: Date }): PostCompleto {
  return {
    id: p.id,
    titulo: p.titulo,
    modelo: p.modelo as ModeloPost,
    formato: p.formato as FormatoPost,
    conteudo: p.conteudo as ConteudoPost,
    legenda: p.legenda,
    ajustes: p.ajustes as AjustesPost,
    design: (p.design ?? {}) as DesignPost,
    atualizadoEm: p.atualizadoEm.toISOString(),
  };
}

function exigirValido(d: DadosPost) {
  const problema = problemaNoPost(d);
  if (problema) throw new BadRequestException(problema);
}

/** Ordem das chaves não conta: só muda quem mudou de verdade. */
function mesmosAjustes(a: unknown, b: unknown): boolean {
  const canonico = (v: unknown): unknown => (Array.isArray(v) ? v.map(canonico) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)).map(([k, w]) => [k, canonico(w)])) : v);
  return JSON.stringify(canonico(a)) === JSON.stringify(canonico(b));
}

@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly consultas: ConsultasService,
    private readonly banidos: BanidosService,
  ) {}

  private readonly log = new Logger(PostsService.name);

  async listar(empresaId: string): Promise<PostResumo[]> {
    const lista = await this.prisma.postSocial.findMany({
      where: { empresaId },
      orderBy: { atualizadoEm: 'desc' },
      take: 200,
      select: { id: true, titulo: true, modelo: true, formato: true, atualizadoEm: true, autor: true },
    });
    return lista.map((p) => ({ ...p, modelo: p.modelo as ModeloPost, formato: p.formato as FormatoPost, atualizadoEm: p.atualizadoEm.toISOString() }));
  }

  async buscar(empresaId: string, id: string): Promise<PostCompleto> {
    const p = await this.prisma.postSocial.findFirst({ where: { id, empresaId } });
    if (!p) throw new NotFoundException('Post não encontrado.');
    return completo(p);
  }

  async criar(empresaId: string, d: DadosPost, usuario: UsuarioRequisicao): Promise<PostCompleto> {
    exigirValido(d);
    const design = d.design ?? {};
    if (!podeEditarLivre(usuario)) {
      // Sem a permissão, o post nasce como veio do modelo ou do template padrão da empresa.
      const template = (await this.prisma.marcaPost.findUnique({ where: { empresaId }, select: { templatePadrao: true } }))?.templatePadrao as TemplatePost | null | undefined;
      const designOk = !Object.keys(design).length || mesmosAjustes(design, template?.design);
      const ajustesOk = !Object.keys(d.ajustes).length || mesmosAjustes(d.ajustes, template?.ajustes);
      if (!designOk || !ajustesOk) throw new ForbiddenException('Você não tem permissão para a edição livre da arte.');
    }
    const autor = await this.prisma.usuario.findUnique({ where: { id: usuario.id }, select: { nome: true } });
    const p = await this.prisma.postSocial.create({
      data: { empresaId, titulo: d.titulo.trim(), modelo: d.modelo, formato: d.formato, conteudo: d.conteudo as unknown as Prisma.InputJsonValue, legenda: d.legenda, ajustes: d.ajustes as Prisma.InputJsonValue, design: design as Prisma.InputJsonValue, autor: autor?.nome ?? null },
    });
    await this.auditoria.registrar({ empresaId, usuarioId: usuario.id, acao: 'post.criar', entidade: 'PostSocial', entidadeId: p.id, detalhes: { titulo: p.titulo, modelo: p.modelo } });
    await this.limparGaleria(empresaId, usuario.id);
    return completo(p);
  }

  /**
   * A cada post criado, some da galeria o que nenhum post, logomarca ou template usa. As recentes
   * ficam: podem estar num post ainda não salvo. Falhar aqui não atrapalha a criação do post.
   */
  private async limparGaleria(empresaId: string, autorId: string) {
    try {
      const candidatas = await this.prisma.imagemPost.findMany({ where: { empresaId, criadoEm: { lt: new Date(Date.now() - CARENCIA_LIMPEZA_MS) } }, select: { id: true } });
      if (!candidatas.length) return;
      const [posts, marca] = await Promise.all([
        this.prisma.postSocial.findMany({ where: { empresaId }, select: { conteudo: true, design: true } }),
        this.prisma.marcaPost.findUnique({ where: { empresaId }, select: { logoId: true, templatePadrao: true } }),
      ]);
      const emUso = JSON.stringify([posts, marca]);
      const ids = candidatas.map((c) => c.id).filter((id) => !emUso.includes(id));
      if (!ids.length) return;
      await this.prisma.imagemPost.deleteMany({ where: { empresaId, id: { in: ids } } });
      await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'post.imagem.limpeza', entidade: 'ImagemPost', entidadeId: empresaId, detalhes: { apagadas: ids.length } });
    } catch (erro) {
      this.log.warn(`Limpeza da galeria da empresa ${empresaId} falhou: ${(erro as Error).message}`);
    }
  }

  async salvarTemplate(empresaId: string, t: TemplatePost, autorId: string): Promise<SituacaoMarcaPost> {
    const problema = problemaNoTemplate(t);
    if (problema) throw new BadRequestException(problema);
    const m = await this.marca(empresaId);
    await this.prisma.marcaPost.upsert({
      where: { empresaId },
      create: { empresaId, nome: m.nome, corPrincipal: m.corPrincipal, corDestaque: m.corDestaque, templatePadrao: t as unknown as Prisma.InputJsonValue },
      update: { templatePadrao: t as unknown as Prisma.InputJsonValue },
    });
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'post.template.salvar', entidade: 'MarcaPost', entidadeId: empresaId, detalhes: { modelo: t.modelo } });
    return this.marca(empresaId);
  }

  async removerTemplate(empresaId: string, autorId: string): Promise<SituacaoMarcaPost> {
    await this.prisma.marcaPost.updateMany({ where: { empresaId }, data: { templatePadrao: Prisma.DbNull } });
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'post.template.remover', entidade: 'MarcaPost', entidadeId: empresaId, detalhes: {} });
    return this.marca(empresaId);
  }

  async atualizar(empresaId: string, id: string, d: DadosPost, usuario: UsuarioRequisicao): Promise<PostCompleto> {
    const atual = await this.prisma.postSocial.findFirst({ where: { id, empresaId }, select: { ajustes: true, design: true } });
    if (!atual) throw new NotFoundException('Post não encontrado.');
    exigirValido(d);
    const design = d.design ?? {};
    const mudouArte = !mesmosAjustes(atual.ajustes, d.ajustes) || !mesmosAjustes(atual.design, design);
    if (mudouArte && !podeEditarLivre(usuario)) throw new ForbiddenException('Você não tem permissão para a edição livre da arte.');
    const p = await this.prisma.postSocial.update({
      where: { id },
      data: { titulo: d.titulo.trim(), modelo: d.modelo, formato: d.formato, conteudo: d.conteudo as unknown as Prisma.InputJsonValue, legenda: d.legenda, ajustes: d.ajustes as Prisma.InputJsonValue, design: design as Prisma.InputJsonValue },
    });
    await this.auditoria.registrar({ empresaId, usuarioId: usuario.id, acao: 'post.editar', entidade: 'PostSocial', entidadeId: id, detalhes: { titulo: p.titulo, modelo: p.modelo } });
    return completo(p);
  }

  async excluir(empresaId: string, id: string, autorId: string) {
    const atual = await this.prisma.postSocial.findFirst({ where: { id, empresaId }, select: { titulo: true } });
    if (!atual) throw new NotFoundException('Post não encontrado.');
    await this.prisma.postSocial.delete({ where: { id } });
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'post.excluir', entidade: 'PostSocial', entidadeId: id, detalhes: { titulo: atual.titulo } });
  }

  async marca(empresaId: string): Promise<SituacaoMarcaPost> {
    const [m, empresa] = await Promise.all([
      this.prisma.marcaPost.findUnique({ where: { empresaId } }),
      this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { nomeFantasia: true, razaoSocial: true } }),
    ]);
    return {
      nome: m?.nome ?? empresa?.nomeFantasia ?? empresa?.razaoSocial ?? '',
      corPrincipal: m?.corPrincipal ?? '#1d4ed8',
      corDestaque: m?.corDestaque ?? '#facc15',
      logoId: m?.logoId ?? null,
      temChaveCatalogo: !!m?.chaveCatalogoCifrada,
      catalogoConfigurado: !!config().catalogoUrl,
      template: (m?.templatePadrao ?? null) as TemplatePost | null,
    };
  }

  async salvarMarca(empresaId: string, d: AtualizarMarca, autorId: string): Promise<SituacaoMarcaPost> {
    if (!COR.test(d.corPrincipal) || !COR.test(d.corDestaque)) throw new BadRequestException('Informe as cores no formato #RRGGBB.');
    if (d.logoId && !(await this.prisma.imagemPost.findFirst({ where: { id: d.logoId, empresaId }, select: { id: true } }))) throw new BadRequestException('Logomarca inválida para esta empresa.');
    const chave = d.chaveCatalogo === undefined ? undefined : d.chaveCatalogo?.trim() ? cifrar(d.chaveCatalogo.trim(), config().chaveCriptografia) : null;
    const dados = { nome: d.nome.trim(), corPrincipal: d.corPrincipal, corDestaque: d.corDestaque, logoId: d.logoId };
    await this.prisma.marcaPost.upsert({ where: { empresaId }, create: { empresaId, ...dados, chaveCatalogoCifrada: chave ?? null }, update: { ...dados, chaveCatalogoCifrada: chave } });
    // A chave não vai para a auditoria: só o fato de ter mudado.
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'post.marca', entidade: 'MarcaPost', entidadeId: empresaId, detalhes: { ...dados, chaveAlterada: chave !== undefined } });
    return this.marca(empresaId);
  }

  async imagens(empresaId: string): Promise<ImagemGaleria[]> {
    const lista = await this.prisma.imagemPost.findMany({ where: { empresaId }, orderBy: { criadoEm: 'desc' }, select: { id: true, nome: true, criadoEm: true } });
    return lista.map((i) => ({ ...i, criadoEm: i.criadoEm.toISOString() }));
  }

  async enviarImagem(empresaId: string, nome: string, dataUrl: string, autorId: string): Promise<ImagemGaleria> {
    const virgula = dataUrl.indexOf(',');
    const bytes = Buffer.from(dataUrl.slice(virgula + 1), 'base64');
    if (bytes.length > MAX_IMAGEM_BYTES) throw new BadRequestException('A imagem passa de 5 MB.');
    // Pelos bytes, não pelo que o navegador declarou: SVG pode carregar script.
    const mime = tipoDaImagem(bytes);
    if (!mime) throw new BadRequestException('A imagem precisa ser PNG, JPEG, WebP ou GIF.');
    if ((await this.prisma.imagemPost.count({ where: { empresaId } })) >= MAX_IMAGENS_POR_EMPRESA) throw new BadRequestException(`A galeria aceita até ${MAX_IMAGENS_POR_EMPRESA} imagens. Exclua alguma para enviar outra.`);
    const i = await this.prisma.imagemPost.create({ data: { empresaId, nome: nome.trim().slice(0, 200), mime, conteudo: bytes }, select: { id: true, nome: true, criadoEm: true } });
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'post.imagem.enviar', entidade: 'ImagemPost', entidadeId: i.id, detalhes: { nome: i.nome, bytes: bytes.length } });
    return { ...i, criadoEm: i.criadoEm.toISOString() };
  }

  async arquivoImagem(empresaId: string, id: string) {
    const i = await this.prisma.imagemPost.findFirst({ where: { id, empresaId }, select: { mime: true, conteudo: true } });
    if (!i) throw new NotFoundException('Imagem não encontrada.');
    return i;
  }

  async excluirImagem(empresaId: string, id: string, autorId: string) {
    const i = await this.prisma.imagemPost.findFirst({ where: { id, empresaId }, select: { nome: true } });
    if (!i) throw new NotFoundException('Imagem não encontrada.');
    await this.prisma.imagemPost.delete({ where: { id } });
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'post.imagem.excluir', entidade: 'ImagemPost', entidadeId: id, detalhes: { nome: i.nome } });
  }

  /** Consultas de onde vêm os dados do produto: as mesmas da etiqueta avulsa. */
  async consultasDeBusca(empresaId: string): Promise<ConsultaPost[]> {
    const lista = await this.prisma.consultaSql.findMany({
      where: { empresaId, ativo: true, OR: [{ finalidade: 'BUSCA_PRODUTO' }, { arquivo: { not: null } }] },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true, campos: true },
    });
    return lista.map((c) => ({ id: c.id, nome: c.nome, colunas: Array.isArray(c.campos) ? (c.campos as { nome?: unknown }[]).map((x) => String(x?.nome ?? '')).filter(Boolean) : [] }));
  }

  /** Busca no ERP. Todo `{param.*}` recebe o termo; sem nenhum, lê mais linhas e filtra aqui. Banido não vira propaganda. */
  async buscarProdutos(empresaId: string, consultaId: string, termo: string, usuarioId: string): Promise<BuscaProdutosPost> {
    const consulta = await this.prisma.consultaSql.findFirst({ where: { id: consultaId, empresaId }, select: { sql: true, conexao: { select: { tipo: true } } } });
    if (!consulta) throw new NotFoundException('Consulta não encontrada.');
    const tipo = consulta.conexao.tipo;
    const nomes = ehConexaoSql(tipo)
      ? extrairPlaceholders(consulta.sql, tipo)
          .filter(ehParametro)
          .map((p) => p.slice(PREFIXO_PARAMETRO.length))
      : [PARAMETRO_PLANILHA];
    const r = nomes.length
      ? await this.consultas.executar(empresaId, consultaId, usuarioId, Object.fromEntries(nomes.map((n) => [n, termo])), LIMITE_LINHAS_BUSCA)
      : await this.consultas.buscarPorTermo(empresaId, consultaId, usuarioId, termo, LIMITE_LINHAS_SEM_FILTRO);
    const linhas = linhasParaRegistros(r.colunas, r.linhas);
    const todos = (nomes.length ? linhas : filtrarPorTermo(linhas, termo)).slice(0, LIMITE_LINHAS_BUSCA);
    const proibidos = await this.banidos.conjunto(empresaId);
    const permitidos = todos.filter((x) => !registroBanido(x, proibidos));
    return { produtos: permitidos.map((x) => produtoDoRegistro(x)), banidos: todos.length - permitidos.length, incompleta: !nomes.length && r.truncado ? true : undefined };
  }
}
