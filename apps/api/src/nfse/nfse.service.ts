import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  dataHoraNoFuso,
  descricaoDaMensalidade,
  descricaoDoPedido,
  diasParaVencer,
  documentoDoTomador,
  esperaDaTentativa,
  idDps,
  issDaNota,
  leiauteDoAmbiente,
  montarDps,
  montarPedidoCancelamento,
  normalizarCnpj,
  podeCancelarNota,
  podeEmitirDeNovo,
  problemaNoCancelamento,
  problemaNoEmissor,
  problemaNoTomador,
  valorDoPedidoNaNota,
  type AmbienteNfse,
  type AutomaticoNfse,
  type DadosEmissorNfse,
  type EmissorNfseResumo,
  type EventoNota,
  type MotivoCancelamentoNfse,
  type NotaResumo,
  type NovaNotaAvulsa,
  type OrigemNota,
  type RegimeNfse,
  type ServicoNfse,
  type SituacaoNota,
  type TomadorNfse,
} from '@etiquetas/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { dataIso, hojeNoFuso } from '../cobranca/mensagens-cobranca.service';
import { config } from '../config';
import { cifrar, decifrar } from '../cripto';
import { PrismaService } from '../prisma/prisma.service';
import { assinarXml, CertificadoInvalido, lerCertificado, type CertificadoA1 } from './certificado';
import { danfsePdf } from './danfse';
import { SefinNacional, type CredencialNfse, type ProvedorNfse } from './sefin';

/** Plataforma = emissor sem empresa (nota da mensalidade). */
export type Escopo = { empresaId: string } | { plataforma: true };

export const PROVEDOR_NFSE = Symbol('PROVEDOR_NFSE');
const INTERVALO_CICLO_MS = 10_000;
/** Nota presa em PROCESSANDO (a API caiu no meio) volta à fila depois disso: reenviar a mesma DPS é seguro. */
const PRESA_MS = 5 * 60_000;
const VERSAO_APLICATIVO = 'Flow-1.0';
/** Pagamentos e pedidos procurados por ciclo da emissão automática. */
const POR_CICLO = 20;

type EmissorDoBanco = Prisma.EmissorNfseGetPayload<object>;
type NotaDoBanco = Prisma.NotaFiscalGetPayload<{ include: { pedido: { select: { numero: true } }; emissor: { select: { razaoSocial: true } } } }>;

export function criarProvedorNfse(): ProvedorNfse {
  const c = config().nfse;
  return new SefinNacional(c.sefinUrl ? { PRODUCAO_RESTRITA: c.sefinUrl, PRODUCAO: c.sefinUrl } : undefined, c.verificarServidor);
}

const ondeEmissor = (e: Escopo) => ('empresaId' in e ? { empresaId: e.empresaId } : { empresaId: null });
const evento = (texto: string, autor?: string | null): EventoNota => ({ em: new Date().toISOString(), texto, autor: autor ?? null });

/**
 * NFS-e pelo padrão nacional. A plataforma (emissor sem empresa) emite a nota da mensalidade; cada
 * empresa emite as dela (pedido concluído e avulsa). `notas_fiscais` é a fila: a nota nasce PENDENTE
 * com o número da DPS já reservado, o relógio reivindica (PENDENTE → PROCESSANDO por `updateMany`) e
 * envia. Fora do ar, a mesma DPS é reenviada com espera crescente; DPS repetida (E0014) é recuperada
 * pela consulta. Recusa da Sefin vira ERRO, com "Emitir de novo".
 */
@Injectable()
export class NfseService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('NFS-e');
  private relogio?: NodeJS.Timeout;
  private rodando = false;
  /** Certificados abertos (chave em memória), pela data da última alteração do emissor. */
  private readonly certificados = new Map<string, { versao: number; cert: CertificadoA1; cred: CredencialNfse }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    @Inject(PROVEDOR_NFSE) private readonly provedor: ProvedorNfse,
  ) {}

  onApplicationBootstrap() {
    this.relogio = setInterval(() => void this.ciclo(), INTERVALO_CICLO_MS);
  }

  onModuleDestroy() {
    clearInterval(this.relogio);
  }

  // Emissor ------------------------------------------------------------------------------------

  private resumoEmissor(e: EmissorDoBanco): EmissorNfseResumo {
    const dados = this.dadosDoEmissor(e);
    return {
      ...dados,
      certificado: e.certificadoCifrado ? { titular: e.certificadoTitular, documento: e.certificadoDocumento, validoAte: e.certificadoValidoAte?.toISOString() ?? null } : null,
      diasParaVencer: e.certificadoValidoAte ? diasParaVencer(e.certificadoValidoAte, new Date()) : null,
      problema: this.problemaParaEmitir(e),
    };
  }

  private dadosDoEmissor(e: EmissorDoBanco): DadosEmissorNfse {
    return {
      ambiente: e.ambiente as AmbienteNfse,
      cnpj: e.cnpj,
      inscricaoMunicipal: e.inscricaoMunicipal,
      razaoSocial: e.razaoSocial,
      codigoMunicipio: e.codigoMunicipio,
      regime: e.regime as RegimeNfse,
      regimeEspecial: e.regimeEspecial,
      email: e.email,
      telefone: e.telefone,
      serie: e.serie,
      proximoNumero: e.proximoNumero,
      servico: e.servico as unknown as ServicoNfse,
      automatico: (e.automatico ?? {}) as AutomaticoNfse,
    };
  }

  /** O que impede emitir agora (sem certificado, vencido, de outro CNPJ). */
  private problemaParaEmitir(e: EmissorDoBanco): string | null {
    if (!e.certificadoCifrado) return 'Envie o certificado digital A1 (.pfx) para emitir.';
    if (e.certificadoValidoAte && e.certificadoValidoAte.getTime() < Date.now()) return 'O certificado digital venceu. Envie o novo.';
    if (e.certificadoDocumento && e.certificadoDocumento.slice(0, 8) !== normalizarCnpj(e.cnpj).slice(0, 8)) return 'O certificado é de outro CNPJ.';
    return problemaNoEmissor(this.dadosDoEmissor(e));
  }

  async emissor(escopo: Escopo): Promise<EmissorNfseResumo | null> {
    const e = await this.prisma.emissorNfse.findFirst({ where: ondeEmissor(escopo) });
    return e ? this.resumoEmissor(e) : null;
  }

  async salvarEmissor(escopo: Escopo, dto: DadosEmissorNfse, autorId: string): Promise<EmissorNfseResumo> {
    const dados: DadosEmissorNfse = {
      ...dto,
      cnpj: normalizarCnpj(dto.cnpj ?? ''),
      inscricaoMunicipal: dto.inscricaoMunicipal?.trim() || null,
      razaoSocial: (dto.razaoSocial ?? '').trim(),
      email: dto.email?.trim() || null,
      telefone: (dto.telefone ?? '').replace(/\D/g, '') || null,
      regimeEspecial: dto.regime === 'NORMAL' ? (dto.regimeEspecial ?? 0) : 0,
      servico: {
        codigoTributacaoNacional: (dto.servico?.codigoTributacaoNacional ?? '').replace(/\D/g, ''),
        codigoTributacaoMunicipal: dto.servico?.codigoTributacaoMunicipal?.trim() || null,
        codigoNbs: (dto.servico?.codigoNbs ?? '').replace(/\D/g, '') || null,
        descricao: (dto.servico?.descricao ?? '').trim(),
        aliquotaIss: dto.servico?.aliquotaIss ?? null,
        issRetido: !!dto.servico?.issRetido,
        percentualTributos: dto.servico?.percentualTributos ?? null,
      },
      // Mensalidade só na plataforma; pedidos só na empresa.
      automatico:
        'plataforma' in escopo
          ? { mensalidade: !!dto.automatico?.mensalidade }
          : { pedidos: !!dto.automatico?.pedidos, valorPedido: dto.automatico?.valorPedido === 'TOTAL' ? 'TOTAL' : 'TAXA_ENTREGA' },
    };
    const problema = problemaNoEmissor(dados);
    if (problema) throw new BadRequestException(problema);
    const atual = await this.prisma.emissorNfse.findFirst({ where: ondeEmissor(escopo) });
    // Número já usado nesta série e ambiente não volta: a Sefin recusaria a DPS repetida.
    if (atual) {
      const ultimo = await this.prisma.notaFiscal.aggregate({ where: { emissorId: atual.id, ambiente: dados.ambiente, serie: dados.serie }, _max: { numeroDps: true } });
      if ((ultimo._max.numeroDps ?? 0) >= dados.proximoNumero) throw new BadRequestException(`O próximo número da DPS precisa ser maior que ${ultimo._max.numeroDps}, o último usado nesta série.`);
    }
    const ligado = !!(dados.automatico.mensalidade || dados.automatico.pedidos);
    const estavaLigado = !!(atual && ((atual.automatico as AutomaticoNfse).mensalidade || (atual.automatico as AutomaticoNfse).pedidos));
    const colunas = {
      ambiente: dados.ambiente,
      cnpj: dados.cnpj,
      inscricaoMunicipal: dados.inscricaoMunicipal,
      razaoSocial: dados.razaoSocial,
      codigoMunicipio: dados.codigoMunicipio,
      regime: dados.regime,
      regimeEspecial: dados.regimeEspecial ?? 0,
      email: dados.email,
      telefone: dados.telefone,
      serie: dados.serie,
      proximoNumero: dados.proximoNumero,
      servico: dados.servico as unknown as Prisma.InputJsonValue,
      automatico: dados.automatico as unknown as Prisma.InputJsonValue,
      // Ligar marca desde quando: o passado não vira nota sozinho.
      automaticoDesde: ligado ? (estavaLigado ? atual!.automaticoDesde : new Date()) : null,
      atualizadoPorId: autorId,
    };
    const empresaId = 'empresaId' in escopo ? escopo.empresaId : null;
    const e = await this.prisma.$transaction(async (tx) => {
      const salvo = atual ? await tx.emissorNfse.update({ where: { id: atual.id }, data: colunas }) : await tx.emissorNfse.create({ data: { ...colunas, empresaId } });
      await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'nfse.emissor', entidade: 'EmissorNfse', entidadeId: salvo.id, detalhes: { ...dados } as unknown as Prisma.InputJsonValue }, tx);
      return salvo;
    });
    return this.resumoEmissor(e);
  }

  async enviarCertificado(escopo: Escopo, pfxBase64: string, senha: string, autorId: string): Promise<EmissorNfseResumo> {
    const e = await this.prisma.emissorNfse.findFirst({ where: ondeEmissor(escopo) });
    if (!e) throw new BadRequestException('Salve os dados fiscais antes de enviar o certificado.');
    let cert: CertificadoA1;
    try {
      cert = lerCertificado(pfxBase64.replace(/^data:[^,]*,/, ''), senha);
    } catch (err) {
      if (err instanceof CertificadoInvalido) throw new BadRequestException(err.message);
      throw err;
    }
    if (cert.validoAte.getTime() < Date.now()) throw new BadRequestException('Este certificado já venceu.');
    if (cert.documento && cert.documento.slice(0, 8) !== normalizarCnpj(e.cnpj).slice(0, 8)) throw new BadRequestException(`O certificado é do documento ${cert.documento}, não do CNPJ do emissor.`);
    const salvo = await this.prisma.emissorNfse.update({
      where: { id: e.id },
      data: {
        certificadoCifrado: cifrar(JSON.stringify({ pfx: pfxBase64.replace(/^data:[^,]*,/, ''), senha }), config().chaveCriptografia),
        certificadoTitular: cert.titular,
        certificadoDocumento: cert.documento,
        certificadoValidoAte: cert.validoAte,
        atualizadoPorId: autorId,
      },
    });
    this.certificados.delete(e.id);
    await this.auditoria.registrar({ empresaId: e.empresaId, usuarioId: autorId, acao: 'nfse.certificado', entidade: 'EmissorNfse', entidadeId: e.id, detalhes: { titular: cert.titular, documento: cert.documento, validoAte: cert.validoAte.toISOString() } });
    return this.resumoEmissor(salvo);
  }

  async removerCertificado(escopo: Escopo, autorId: string): Promise<EmissorNfseResumo> {
    const e = await this.prisma.emissorNfse.findFirst({ where: ondeEmissor(escopo) });
    if (!e) throw new NotFoundException('Emissor não encontrado.');
    const salvo = await this.prisma.emissorNfse.update({ where: { id: e.id }, data: { certificadoCifrado: null, certificadoTitular: null, certificadoDocumento: null, certificadoValidoAte: null, atualizadoPorId: autorId } });
    this.certificados.delete(e.id);
    await this.auditoria.registrar({ empresaId: e.empresaId, usuarioId: autorId, acao: 'nfse.certificado_removido', entidade: 'EmissorNfse', entidadeId: e.id });
    return this.resumoEmissor(salvo);
  }

  private certificadoDo(e: EmissorDoBanco): { cert: CertificadoA1; cred: CredencialNfse } {
    const versao = e.atualizadoEm.getTime();
    const guardado = this.certificados.get(e.id);
    if (guardado && guardado.versao === versao) return guardado;
    const { pfx, senha } = JSON.parse(decifrar(e.certificadoCifrado!, config().chaveCriptografia)) as { pfx: string; senha: string };
    const aberto = { versao, cert: lerCertificado(pfx, senha), cred: { pfx: Buffer.from(pfx, 'base64'), senha } };
    this.certificados.set(e.id, aberto);
    return aberto;
  }

  // Notas --------------------------------------------------------------------------------------

  private resumoNota(n: NotaDoBanco): NotaResumo {
    const servico = n.servico as unknown as ServicoNfse;
    return {
      id: n.id,
      origem: n.origem as OrigemNota,
      situacao: n.situacao as SituacaoNota,
      ambiente: n.ambiente as AmbienteNfse,
      serie: n.serie,
      numeroDps: n.numeroDps,
      numeroNfse: n.numeroNfse,
      chaveAcesso: n.chaveAcesso,
      tomador: (n.tomador as TomadorNfse | null) ?? null,
      descricao: servico.descricao,
      valorCentavos: n.valorCentavos,
      issCentavos: n.issCentavos,
      competencia: dataIso(n.competencia),
      erro: n.erro,
      emitidaEm: n.emitidaEm?.toISOString() ?? null,
      canceladaEm: n.canceladaEm?.toISOString() ?? null,
      motivoCancelamento: n.motivoCancelamento,
      criadoEm: n.criadoEm.toISOString(),
      pedidoNumero: n.pedido?.numero ?? null,
      emitente: n.emissor.razaoSocial,
      historico: (n.historico as unknown as EventoNota[]) ?? [],
    };
  }

  private readonly incluir = { pedido: { select: { numero: true } }, emissor: { select: { razaoSocial: true } } } as const;

  /** Emitidas pela empresa (ou pela plataforma) e, para a empresa, as recebidas da plataforma (mensalidade). */
  async listar(escopo: Escopo, filtro: { tipo?: 'EMITIDAS' | 'RECEBIDAS'; situacao?: SituacaoNota; busca?: string }): Promise<NotaResumo[]> {
    const where: Prisma.NotaFiscalWhereInput =
      'empresaId' in escopo && filtro.tipo === 'RECEBIDAS' ? { tomadorEmpresaId: escopo.empresaId, empresaId: null, situacao: { in: ['EMITIDA', 'CANCELADA'] } } : { empresaId: 'empresaId' in escopo ? escopo.empresaId : null };
    if (filtro.situacao) where.situacao = filtro.situacao;
    const busca = filtro.busca?.trim();
    if (busca) {
      const digitos = busca.replace(/\D/g, '');
      where.OR = [
        { tomador: { path: ['nome'], string_contains: busca } },
        ...(digitos ? [{ numeroNfse: digitos }, { tomador: { path: ['documento'], string_contains: digitos } }, ...(/^\d{1,9}$/.test(digitos) ? [{ numeroDps: Number(digitos) }] : [])] : []),
      ];
    }
    const lista = await this.prisma.notaFiscal.findMany({ where, orderBy: { criadoEm: 'desc' }, take: 300, include: this.incluir });
    return lista.map((n) => this.resumoNota(n));
  }

  /** Uma nota que o escopo pode ver (emitida por ele ou recebida da plataforma). */
  private async notaDoEscopo(escopo: Escopo, id: string, recebidaTambem = true): Promise<NotaDoBanco> {
    const onde: Prisma.NotaFiscalWhereInput =
      'empresaId' in escopo
        ? { id, OR: [{ empresaId: escopo.empresaId }, ...(recebidaTambem ? [{ empresaId: null, tomadorEmpresaId: escopo.empresaId, situacao: { in: ['EMITIDA', 'CANCELADA'] } }] : [])] }
        : { id, empresaId: null };
    const n = await this.prisma.notaFiscal.findFirst({ where: onde, include: this.incluir });
    if (!n) throw new NotFoundException('Nota fiscal não encontrada.');
    return n;
  }

  async obter(escopo: Escopo, id: string): Promise<NotaResumo> {
    return this.resumoNota(await this.notaDoEscopo(escopo, id));
  }

  /**
   * Cria a nota na fila com o número da DPS reservado (a linha do emissor fica presa até o fim da
   * transação, então duas notas nunca levam o mesmo número).
   */
  private async criar(
    emissor: EmissorDoBanco,
    nota: { origem: OrigemNota; tomador: TomadorNfse | null; servico: ServicoNfse; valorCentavos: number; competencia: string; pedidoId?: string; pagamentoId?: string; tomadorEmpresaId?: string | null; autorId?: string | null; texto: string },
  ): Promise<string | null> {
    if (nota.valorCentavos <= 0) throw new BadRequestException('A nota precisa de valor maior que zero.');
    const tomador = nota.tomador ? { ...nota.tomador, documento: documentoDoTomador(nota.tomador.documento), nome: nota.tomador.nome.trim(), email: nota.tomador.email?.trim() || null } : null;
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const [linha] = await tx.$queryRaw<{ proximo_numero: number; serie: string; ambiente: string; codigo_municipio: string; cnpj: string }[]>`
          UPDATE emissores_nfse SET proximo_numero = proximo_numero + 1 WHERE id = ${emissor.id}::uuid
          RETURNING proximo_numero - 1 AS proximo_numero, serie, ambiente, codigo_municipio, cnpj`;
        const numero = Number(linha.proximo_numero);
        const criada = await tx.notaFiscal.create({
          data: {
            emissorId: emissor.id,
            empresaId: emissor.empresaId,
            tomadorEmpresaId: nota.tomadorEmpresaId ?? null,
            origem: nota.origem,
            pedidoId: nota.pedidoId ?? null,
            pagamentoAssinaturaId: nota.pagamentoId ?? null,
            ambiente: linha.ambiente,
            serie: linha.serie,
            numeroDps: numero,
            idDps: idDps(linha.codigo_municipio, linha.cnpj, linha.serie, numero),
            tomador: (tomador ?? Prisma.DbNull) as Prisma.InputJsonValue,
            servico: nota.servico as unknown as Prisma.InputJsonValue,
            valorCentavos: nota.valorCentavos,
            issCentavos: issDaNota(nota.valorCentavos, nota.servico.aliquotaIss),
            competencia: new Date(`${nota.competencia}T00:00:00Z`),
            proximaTentativaEm: new Date(),
            criadoPorId: nota.autorId ?? null,
            historico: [evento(nota.texto)] as unknown as Prisma.InputJsonValue,
          },
        });
        await this.auditoria.registrar({ empresaId: emissor.empresaId, usuarioId: nota.autorId ?? null, acao: 'nfse.criar', entidade: 'NotaFiscal', entidadeId: criada.id, detalhes: { origem: nota.origem, valorCentavos: nota.valorCentavos, numeroDps: numero } }, tx);
        return criada.id;
      });
      setImmediate(() => void this.processar(id));
      return id;
    } catch (e) {
      // Pedido ou pagamento que já tem nota (corrida com o relógio).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
      throw e;
    }
  }

  private async emissorPronto(escopo: Escopo): Promise<EmissorDoBanco> {
    const e = await this.prisma.emissorNfse.findFirst({ where: ondeEmissor(escopo) });
    if (!e) throw new BadRequestException('Configure os dados fiscais antes de emitir.');
    const problema = this.problemaParaEmitir(e);
    if (problema) throw new BadRequestException(problema);
    return e;
  }

  async avulsa(escopo: Escopo, dto: NovaNotaAvulsa, autorId: string): Promise<NotaResumo> {
    const e = await this.emissorPronto(escopo);
    const problema = problemaNoTomador(dto.tomador);
    if (problema) throw new BadRequestException(problema);
    const hoje = hojeNoFuso();
    const competencia = dto.competencia || hoje;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(competencia) || competencia > hoje) throw new BadRequestException('A competência não pode ser depois de hoje.');
    if (!Number.isInteger(dto.valorCentavos) || dto.valorCentavos <= 0 || dto.valorCentavos > 100_000_000) throw new BadRequestException('Informe o valor do serviço.');
    const base = e.servico as unknown as ServicoNfse;
    const descricao = (dto.descricao ?? '').trim() || base.descricao;
    if (descricao.length < 5) throw new BadRequestException('Descreva o serviço (ao menos 5 letras).');
    const id = await this.criar(e, { origem: 'AVULSA', tomador: dto.tomador?.nome?.trim() || dto.tomador?.documento ? dto.tomador : null, servico: { ...base, descricao }, valorCentavos: dto.valorCentavos, competencia, autorId, texto: 'Nota avulsa criada' });
    return this.obter(escopo, id!);
  }

  /** Nota do pedido (empresa): automática pelo relógio ou pelo botão no painel do pedido. */
  async doPedido(empresaId: string, pedidoId: string, autorId: string | null): Promise<NotaResumo> {
    const e = await this.emissorPronto({ empresaId });
    const p = await this.prisma.pedido.findFirst({ where: { id: pedidoId, empresaId }, select: { id: true, numero: true, situacao: true, clienteNome: true, clienteDocumento: true, taxaCentavos: true, totalCentavos: true, notaFiscal: { select: { id: true } } } });
    if (!p) throw new NotFoundException('Pedido não encontrado.');
    if (p.notaFiscal) throw new ConflictException('Este pedido já tem nota fiscal.');
    if (p.situacao !== 'CONCLUIDO') throw new BadRequestException('A nota sai depois de o pedido ser concluído.');
    const id = await this.notaDoPedido(e, p, autorId);
    if (!id) throw new ConflictException('Este pedido já tem nota fiscal.');
    return this.obter({ empresaId }, id);
  }

  private notaDoPedido(e: EmissorDoBanco, p: { id: string; numero: number; clienteNome: string; clienteDocumento: string | null; taxaCentavos: number; totalCentavos: number }, autorId: string | null) {
    const auto = e.automatico as AutomaticoNfse;
    const valor = valorDoPedidoNaNota(p, auto.valorPedido);
    if (valor <= 0) throw new BadRequestException(auto.valorPedido === 'TOTAL' ? 'O pedido não tem valor.' : 'O pedido não tem taxa de entrega para a nota.');
    const base = e.servico as unknown as ServicoNfse;
    return this.criar(e, {
      origem: 'PEDIDO',
      tomador: { nome: p.clienteNome, documento: p.clienteDocumento },
      servico: { ...base, descricao: descricaoDoPedido(base.descricao, p.numero, auto.valorPedido ?? 'TAXA_ENTREGA') },
      valorCentavos: valor,
      competencia: hojeNoFuso(),
      pedidoId: p.id,
      autorId,
      texto: autorId ? `Nota do pedido nº ${p.numero} pedida no painel` : `Nota do pedido nº ${p.numero} criada ao concluir o pedido`,
    });
  }

  /** Nota da mensalidade (plataforma): automática pelo relógio ou pelo botão em Cobrança. */
  async doPagamento(pagamentoId: string, autorId: string | null): Promise<NotaResumo> {
    const e = await this.emissorPronto({ plataforma: true });
    const id = await this.notaDoPagamento(e, pagamentoId, autorId);
    if (!id) throw new ConflictException('Este pagamento já tem nota fiscal.');
    return this.obter({ plataforma: true }, id);
  }

  private async notaDoPagamento(e: EmissorDoBanco, pagamentoId: string, autorId: string | null) {
    const p = await this.prisma.pagamentoAssinatura.findUnique({ where: { id: pagamentoId }, include: { empresa: { select: { id: true, cnpj: true, razaoSocial: true } }, notaFiscal: { select: { id: true } } } });
    if (!p) throw new NotFoundException('Pagamento não encontrado.');
    if (p.notaFiscal) return null;
    const base = e.servico as unknown as ServicoNfse;
    // Competência: o dia do pagamento, que nunca é futuro (Cobrança recusa).
    const pago = dataIso(p.pagoEm);
    return this.criar(e, {
      origem: 'MENSALIDADE',
      tomador: { documento: p.empresa.cnpj, nome: p.empresa.razaoSocial },
      servico: { ...base, descricao: descricaoDaMensalidade(base.descricao, dataIso(p.vencimentoQuitado), p.meses) },
      valorCentavos: Math.round(Number(p.valor) * 100),
      competencia: pago > hojeNoFuso() ? hojeNoFuso() : pago,
      pagamentoId: p.id,
      tomadorEmpresaId: p.empresaId,
      autorId,
      texto: autorId ? 'Nota da mensalidade pedida em Cobrança' : 'Nota da mensalidade criada ao registrar o pagamento',
    });
  }

  /** Nota com erro volta à fila com os dados fiscais de agora (mesmo número de DPS: nenhuma nota nasceu com ele). */
  async emitirDeNovo(escopo: Escopo, id: string, autorId: string): Promise<NotaResumo> {
    const n = await this.notaDoEscopo(escopo, id, false);
    if (!podeEmitirDeNovo(n.situacao as SituacaoNota)) throw new BadRequestException('Só a nota com erro pode ser emitida de novo.');
    const e = await this.emissorPronto(escopo);
    if (e.ambiente !== n.ambiente) throw new BadRequestException('O emissor mudou de ambiente depois desta nota. Crie uma nota nova.');
    const base = e.servico as unknown as ServicoNfse;
    const servico = { ...base, descricao: (n.servico as unknown as ServicoNfse).descricao };
    const { count } = await this.prisma.notaFiscal.updateMany({
      where: { id: n.id, situacao: 'ERRO', atualizadoEm: n.atualizadoEm },
      data: { situacao: 'PENDENTE', erro: null, tentativas: 0, proximaTentativaEm: new Date(), servico: servico as unknown as Prisma.InputJsonValue, issCentavos: issDaNota(n.valorCentavos, base.aliquotaIss) },
    });
    if (!count) throw new ConflictException('A nota mudou enquanto você olhava. Atualize a página.');
    await this.anotar(n.id, evento('Emitir de novo', await this.nomeDe(autorId)));
    await this.auditoria.registrar({ empresaId: n.empresaId, usuarioId: autorId, acao: 'nfse.emitir_de_novo', entidade: 'NotaFiscal', entidadeId: n.id });
    setImmediate(() => void this.processar(n.id));
    return this.obter(escopo, n.id);
  }

  async cancelar(escopo: Escopo, id: string, motivo: number, texto: string, autorId: string): Promise<NotaResumo> {
    const problema = problemaNoCancelamento(motivo, texto);
    if (problema) throw new BadRequestException(problema);
    const n = await this.notaDoEscopo(escopo, id, false);
    if (!podeCancelarNota(n.situacao as SituacaoNota) || !n.chaveAcesso) throw new BadRequestException('Só a nota emitida pode ser cancelada.');
    const e = await this.prisma.emissorNfse.findUniqueOrThrow({ where: { id: n.emissorId } });
    if (!e.certificadoCifrado) throw new BadRequestException('Envie o certificado digital para cancelar.');
    const { count } = await this.prisma.notaFiscal.updateMany({ where: { id: n.id, situacao: 'EMITIDA' }, data: { situacao: 'CANCELANDO' } });
    if (!count) throw new ConflictException('A nota mudou enquanto você olhava. Atualize a página.');
    const autor = await this.nomeDe(autorId);
    let resultado;
    try {
      const { cert, cred } = this.certificadoDo(e);
      const pedido = assinarXml(
        montarPedidoCancelamento({ ambiente: n.ambiente as AmbienteNfse, cnpjAutor: e.cnpj, chaveAcesso: n.chaveAcesso, emitidoEm: dataHoraNoFuso(new Date(Date.now() - 30_000), config().fusoHorario), motivo: motivo as MotivoCancelamentoNfse, texto, versaoAplicativo: VERSAO_APLICATIVO }),
        'infPedReg',
        cert,
      );
      resultado = await this.provedor.registrarEvento(cred, n.ambiente as AmbienteNfse, n.chaveAcesso, pedido);
    } catch (err) {
      resultado = { ok: false as const, temporaria: true, status: null, mensagem: String((err as Error).message ?? err) };
    }
    if (!resultado.ok) {
      await this.prisma.notaFiscal.updateMany({ where: { id: n.id, situacao: 'CANCELANDO' }, data: { situacao: 'EMITIDA' } });
      await this.anotar(n.id, evento(`Cancelamento recusado: ${resultado.mensagem}`, autor));
      throw new BadRequestException(resultado.temporaria ? `A Sefin não respondeu. A nota continua emitida; tente de novo. (${resultado.mensagem})` : `A Sefin recusou o cancelamento: ${resultado.mensagem}`);
    }
    const textoMotivo = texto.trim();
    await this.prisma.notaFiscal.update({ where: { id: n.id }, data: { situacao: 'CANCELADA', canceladaEm: new Date(), motivoCancelamento: textoMotivo } });
    await this.anotar(n.id, evento(`Cancelada: ${textoMotivo}`, autor));
    await this.auditoria.registrar({ empresaId: n.empresaId, usuarioId: autorId, acao: 'nfse.cancelar', entidade: 'NotaFiscal', entidadeId: n.id, detalhes: { motivo, texto: textoMotivo, chave: n.chaveAcesso } });
    return this.obter(escopo, n.id);
  }

  async pdf(escopo: Escopo, id: string): Promise<{ nome: string; bytes: Uint8Array }> {
    const n = await this.notaDoEscopo(escopo, id);
    if (!n.chaveAcesso || !n.emitidaEm) throw new BadRequestException('A nota ainda não foi emitida.');
    const e = await this.prisma.emissorNfse.findUniqueOrThrow({ where: { id: n.emissorId } });
    const servico = n.servico as unknown as ServicoNfse;
    const issXml = n.xmlNfse?.match(/<vISSQN>(\d+(?:\.\d{1,2})?)<\/vISSQN>/)?.[1];
    const bytes = await danfsePdf(
      {
        ambiente: n.ambiente as AmbienteNfse,
        chaveAcesso: n.chaveAcesso,
        numeroNfse: n.numeroNfse,
        serie: n.serie,
        numeroDps: n.numeroDps,
        emitidaEm: n.emitidaEm,
        competencia: dataIso(n.competencia),
        cancelada: n.situacao === 'CANCELADA',
        emitente: { razaoSocial: e.razaoSocial, cnpj: e.cnpj, inscricaoMunicipal: e.inscricaoMunicipal, codigoMunicipio: e.codigoMunicipio, regime: e.regime as RegimeNfse, email: e.email },
        tomador: (n.tomador as TomadorNfse | null) ?? null,
        servico,
        valorCentavos: n.valorCentavos,
        issCentavos: issXml ? Math.round(Number(issXml) * 100) : n.issCentavos,
        issRetido: !!servico.issRetido,
        xmlNfse: n.xmlNfse,
      },
      config().fusoHorario,
    );
    return { nome: `nfse-${n.numeroNfse ?? n.numeroDps}.pdf`, bytes };
  }

  async xml(escopo: Escopo, id: string): Promise<{ nome: string; xml: string }> {
    const n = await this.notaDoEscopo(escopo, id);
    if (!n.xmlNfse) throw new BadRequestException('A nota ainda não foi emitida.');
    return { nome: `nfse-${n.numeroNfse ?? n.numeroDps}.xml`, xml: n.xmlNfse };
  }

  /** Situação da nota de cada pagamento (tela Cobrança). */
  async notasDosPagamentos(ids: string[]) {
    const lista = await this.prisma.notaFiscal.findMany({ where: { pagamentoAssinaturaId: { in: ids } }, select: { id: true, situacao: true, numeroNfse: true, erro: true, pagamentoAssinaturaId: true } });
    return new Map(lista.map((n) => [n.pagamentoAssinaturaId!, { id: n.id, situacao: n.situacao, numeroNfse: n.numeroNfse, erro: n.erro }]));
  }

  /** Nota do pedido (painel do pedido). */
  async notaDoPedidoResumo(empresaId: string, pedidoId: string): Promise<NotaResumo | null> {
    const n = await this.prisma.notaFiscal.findFirst({ where: { pedidoId, empresaId }, include: this.incluir });
    return n ? this.resumoNota(n) : null;
  }

  // Fila ---------------------------------------------------------------------------------------

  private async anotar(id: string, e: EventoNota) {
    await this.prisma.$executeRaw`UPDATE notas_fiscais SET historico = historico || ${JSON.stringify([e])}::jsonb WHERE id = ${id}::uuid`;
  }

  private async nomeDe(usuarioId: string | null): Promise<string | null> {
    if (!usuarioId) return null;
    return (await this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: { nome: true } }))?.nome ?? null;
  }

  /** Relógio: devolve à fila as presas, envia as vencidas e cria as automáticas. */
  async ciclo() {
    if (this.rodando) return;
    this.rodando = true;
    try {
      await this.prisma.notaFiscal.updateMany({ where: { situacao: 'PROCESSANDO', atualizadoEm: { lt: new Date(Date.now() - PRESA_MS) } }, data: { situacao: 'PENDENTE', proximaTentativaEm: new Date() } });
      await this.automaticas();
      const vencidas = await this.prisma.notaFiscal.findMany({ where: { situacao: 'PENDENTE', proximaTentativaEm: { lte: new Date() } }, select: { id: true }, orderBy: { proximaTentativaEm: 'asc' }, take: 20 });
      for (const v of vencidas) await this.processar(v.id);
    } catch (e) {
      this.log.error(`Ciclo da NFS-e falhou: ${(e as Error).message}`);
    } finally {
      this.rodando = false;
    }
  }

  /** Pagamento e pedido concluído depois de ligar o automático, ainda sem nota. Emissor com problema não cria nada. */
  private async automaticas() {
    const emissores = await this.prisma.emissorNfse.findMany({ where: { automaticoDesde: { not: null }, certificadoCifrado: { not: null } } });
    for (const e of emissores) {
      if (this.problemaParaEmitir(e)) continue;
      const auto = e.automatico as AutomaticoNfse;
      try {
        if (!e.empresaId && auto.mensalidade) {
          const pagamentos = await this.prisma.pagamentoAssinatura.findMany({ where: { criadoEm: { gte: e.automaticoDesde! }, notaFiscal: null, valor: { gt: 0 } }, select: { id: true }, take: POR_CICLO });
          for (const p of pagamentos) await this.notaDoPagamento(e, p.id, null);
        }
        if (e.empresaId && auto.pedidos) {
          const campo = auto.valorPedido === 'TOTAL' ? 'totalCentavos' : 'taxaCentavos';
          const pedidos = await this.prisma.pedido.findMany({
            where: { empresaId: e.empresaId, situacao: 'CONCLUIDO', atualizadoEm: { gte: e.automaticoDesde! }, notaFiscal: null, [campo]: { gt: 0 } },
            select: { id: true, numero: true, clienteNome: true, clienteDocumento: true, taxaCentavos: true, totalCentavos: true },
            take: POR_CICLO,
          });
          for (const p of pedidos) await this.notaDoPedido(e, p, null);
        }
      } catch (err) {
        this.log.warn(`Emissão automática do emissor ${e.id} falhou: ${(err as Error).message}`);
      }
    }
  }

  /** Envia uma nota PENDENTE (reivindica antes: só um processo envia cada DPS). */
  async processar(id: string) {
    const { count } = await this.prisma.notaFiscal.updateMany({ where: { id, situacao: 'PENDENTE' }, data: { situacao: 'PROCESSANDO' } });
    if (!count) return;
    const n = await this.prisma.notaFiscal.findUniqueOrThrow({ where: { id }, include: { emissor: true } });
    const e = n.emissor;
    const parar = async (mensagem: string) => {
      await this.prisma.notaFiscal.update({ where: { id }, data: { situacao: 'ERRO', erro: mensagem, proximaTentativaEm: null } });
      await this.anotar(id, evento(`Erro: ${mensagem}`));
    };
    const problema = this.problemaParaEmitir(e);
    if (problema) return parar(problema);
    if (e.ambiente !== n.ambiente) return parar('O emissor mudou de ambiente depois desta nota.');
    try {
      const { cert, cred } = this.certificadoDo(e);
      const ambiente = n.ambiente as AmbienteNfse;
      const dps = assinarXml(
        montarDps({
          emissor: { ...this.dadosDoEmissor(e), ambiente },
          serie: n.serie,
          numero: n.numeroDps,
          // Um pouco antes de agora: a Sefin recusa hora de emissão à frente do relógio dela.
          emitidaEm: dataHoraNoFuso(new Date(Date.now() - 30_000), config().fusoHorario),
          competencia: dataIso(n.competencia),
          tomador: (n.tomador as TomadorNfse | null) ?? null,
          servico: n.servico as unknown as ServicoNfse,
          valorCentavos: n.valorCentavos,
          versaoAplicativo: VERSAO_APLICATIVO,
          leiaute: leiauteDoAmbiente(ambiente, config().nfse.leiauteProducao),
        }),
        'infDPS',
        cert,
      );
      let r = await this.provedor.emitir(cred, ambiente, dps);
      if (!r.ok && r.duplicada) {
        // A DPS já virou nota numa tentativa cuja resposta se perdeu: recupera pela consulta.
        const achada = await this.provedor.consultarPorDps(cred, ambiente, n.idDps);
        if (achada) r = { ok: true, ...achada };
      }
      if (r.ok) {
        const issXml = r.xmlNfse.match(/<vISSQN>(\d+(?:\.\d{1,2})?)<\/vISSQN>/)?.[1];
        await this.prisma.notaFiscal.update({
          where: { id },
          data: { situacao: 'EMITIDA', chaveAcesso: r.chaveAcesso, numeroNfse: r.numeroNfse, xmlNfse: r.xmlNfse, emitidaEm: new Date(), erro: null, proximaTentativaEm: null, ...(issXml ? { issCentavos: Math.round(Number(issXml) * 100) } : {}) },
        });
        await this.anotar(id, evento(`Emitida: NFS-e nº ${r.numeroNfse ?? '-'}`));
        return;
      }
      if (r.temporaria) {
        const espera = esperaDaTentativa(n.tentativas);
        if (espera === null) return parar(`A Sefin não respondeu depois de ${n.tentativas + 1} tentativas: ${r.mensagem}`);
        await this.prisma.notaFiscal.update({ where: { id }, data: { situacao: 'PENDENTE', tentativas: { increment: 1 }, erro: r.mensagem, proximaTentativaEm: new Date(Date.now() + espera) } });
        if (n.tentativas === 0) await this.anotar(id, evento(`Sefin fora do ar, tentando de novo: ${r.mensagem}`));
        return;
      }
      return parar(r.mensagem);
    } catch (err) {
      // Erro nosso (certificado que não abre, XML): não adianta repetir.
      return parar(err instanceof CertificadoInvalido ? err.message : `Falha ao preparar a nota: ${(err as Error).message}`);
    }
  }
}
