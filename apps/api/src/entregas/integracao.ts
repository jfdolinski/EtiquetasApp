import {
  BadRequestException,
  Body,
  CanActivate,
  ConflictException,
  Controller,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import type { Request } from 'express';
import {
  esperaDoWebhook,
  ipPrivado,
  LIMITE_REFERENCIA,
  MAX_CHAVES_API,
  MAX_PARADAS_EXTRAS,
  PREFIXO_CHAVE_API,
  PREFIXO_SEGREDO_WEBHOOK,
  primeiroNome,
  problemaNoWebhook,
  referenciaLimpa,
  ROTULO_VEICULO,
  textoParaCliente,
  TIPOS_CHAMADA,
  type ChamadaIntegracao,
  type ChaveApiCriada,
  type ChaveApiResumo,
  type CorpoWebhook,
  type EnvioWebhookResumo,
  type EventoWebhook,
  type ParadaChamada,
  type PreviaChamada,
  type SituacaoChamada,
  type TipoChamada,
  type TipoVeiculo,
} from '@etiquetas/shared';
import { Prisma } from '@prisma/client';
import { empresaBloqueada } from '../auth/acesso-empresa';
import { hashDoToken } from '../auth/conta.service';
import { EmpresaAtual, Publico, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { config } from '../config';
import { cifrar, decifrar } from '../cripto';
import { PrismaService } from '../prisma/prisma.service';
import { ChamadasService, type NovaChamadaDto } from './chamadas';
import { EntregasEmpresaService } from './empresa';
import { MapasService } from './mapas';
import { caminhoDoRastreio } from './rastreio';

const INTERVALO_MS = 10_000;
const DIA_MS = 86_400_000;
/** Mudança de situação com mais tempo que isso não vira aviso (chamada antiga). */
const JANELA_MUDANCAS_MS = 2 * DIA_MS;
const ESPERA_RESPOSTA_MS = 10_000;
const RETENCAO_ENVIOS_DIAS = 30;

// DTOs -------------------------------------------------------------------------------------

class NovaChaveDto {
  @IsString() @MinLength(3, { message: 'Dê um nome à chave (ex.: o nome do sistema).' }) @MaxLength(60) nome: string;
  @IsOptional() @IsString() @MaxLength(500) webhookUrl?: string | null;
}

class WebhookDto {
  @IsOptional() @IsString() @MaxLength(500) webhookUrl?: string | null;
}

class ParadaIntegracaoDto {
  @IsString() @MinLength(5, { message: 'Informe o endereço.' }) @MaxLength(300) endereco: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number | null;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lon?: number | null;
  @IsOptional() @IsString() @MaxLength(80) contato?: string;
  @IsOptional() @IsString() @MaxLength(20) telefone?: string;
  @IsOptional() @IsString() @MaxLength(300) instrucoes?: string;
}

class NovaChamadaIntegracaoDto {
  @IsOptional() @IsString() @MaxLength(LIMITE_REFERENCIA) referencia?: string | null;
  @IsOptional() @IsIn(TIPOS_CHAMADA, { message: 'Tipo inválido.' }) tipo?: TipoChamada;
  @IsOptional() @ValidateNested() @Type(() => ParadaIntegracaoDto) origem?: ParadaIntegracaoDto | null;
  @ValidateNested() @Type(() => ParadaIntegracaoDto) destino: ParadaIntegracaoDto;
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_PARADAS_EXTRAS) @ValidateNested({ each: true }) @Type(() => ParadaIntegracaoDto) paradas?: ParadaIntegracaoDto[];
  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
  @IsOptional() @IsInt() @Min(0) @Max(5_000_000) valorDeclaradoCentavos?: number | null;
  @IsOptional() @IsISO8601() agendadaPara?: string | null;
  @IsOptional() @IsBoolean() distribuir?: boolean;
}

class CancelarDto {
  @IsString() @MinLength(3, { message: 'Informe o motivo.' }) @MaxLength(300) motivo: string;
}

// Guard ------------------------------------------------------------------------------------

export interface Integracao {
  empresaId: string;
  chaveId: string;
  nome: string;
}

interface RequisicaoIntegracao extends Request {
  integracao?: Integracao;
}

/** `Authorization: Bearer flw_...`: a chave vale para a empresa que a criou e mais nada. */
@Injectable()
export class ChaveApiGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RequisicaoIntegracao>();
    const [tipo, token] = (req.headers.authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || !token?.startsWith(PREFIXO_CHAVE_API)) throw new UnauthorizedException('Mande a chave da API no cabeçalho Authorization: Bearer flw_...');
    const chave = await this.prisma.chaveApiEntregas.findUnique({ where: { tokenHash: hashDoToken(token) }, include: { empresa: { select: { ativa: true, statusAssinatura: true } } } });
    if (!chave || chave.revogadaEm) throw new UnauthorizedException('Chave da API inválida ou revogada.');
    if (empresaBloqueada(chave.empresa)) throw new ForbiddenException('O acesso da empresa está bloqueado.');
    if (!chave.ultimoUsoEm || Date.now() - chave.ultimoUsoEm.getTime() > 60_000) void this.prisma.chaveApiEntregas.update({ where: { id: chave.id }, data: { ultimoUsoEm: new Date() } }).catch(() => undefined);
    req.integracao = { empresaId: chave.empresaId, chaveId: chave.id, nome: chave.nome };
    return true;
  }
}

const IntegracaoAtual = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<RequisicaoIntegracao>().integracao!);

// Serviço ----------------------------------------------------------------------------------

const INCLUIR = { entregador: { select: { nome: true, veiculo: true, placa: true } }, _count: { select: { paradas: true } } } as const;
type ChamadaParaIntegracao = Prisma.ChamadaEntregaGetPayload<{ include: typeof INCLUIR }>;

const estado = (c: { situacao: string; paradaAtual: number }) => `${c.situacao}:${c.paradaAtual}`;

/**
 * Entregas, etapa 14: API para o sistema da empresa (docs/API-ENTREGAS.md) e avisos por webhook.
 * O relógio de 10 s compara `situacao:parada_atual` de cada chamada recente com `webhook_estado` e,
 * quando muda, põe um aviso por chave na fila `envios_webhook` (sem mexer em cada lugar que muda a
 * chamada). Cada aviso vai assinado com HMAC-SHA256 do segredo da chave e tenta até 6 vezes.
 */
@Injectable()
export class IntegracaoService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Integração');
  private relogio?: NodeJS.Timeout;
  private rodando = false;
  private ultimaFaxina = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly chamadas: ChamadasService,
    private readonly empresas: EntregasEmpresaService,
    private readonly mapas: MapasService,
  ) {}

  onApplicationBootstrap() {
    this.relogio = setInterval(() => void this.ciclo(), INTERVALO_MS);
  }

  onModuleDestroy() {
    clearInterval(this.relogio);
  }

  async ciclo(agora = new Date()): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    try {
      await this.procurarMudancas(agora);
      await this.enviarPendentes(agora);
      if (agora.getTime() - this.ultimaFaxina > 3_600_000) {
        this.ultimaFaxina = agora.getTime();
        await this.prisma.envioWebhook.deleteMany({ where: { criadoEm: { lt: new Date(agora.getTime() - RETENCAO_ENVIOS_DIAS * DIA_MS) } } });
      }
    } catch (e) {
      this.log.error(`Falha nos avisos da integração: ${(e as Error).message}`);
    } finally {
      this.rodando = false;
    }
  }

  // Chaves -----------------------------------------------------------------------------------

  private async resumos(empresaId: string): Promise<ChaveApiResumo[]> {
    const chaves = await this.prisma.chaveApiEntregas.findMany({ where: { empresaId }, orderBy: { criadoEm: 'desc' } });
    const desde = new Date(Date.now() - 7 * DIA_MS);
    const envios = chaves.length
      ? await this.prisma.envioWebhook.findMany({ where: { chaveId: { in: chaves.map((c) => c.id) }, criadoEm: { gte: desde } }, select: { chaveId: true, enviadoEm: true, falhouEm: true } })
      : [];
    return chaves.map((c) => {
      const meus = envios.filter((e) => e.chaveId === c.id);
      return {
        id: c.id,
        nome: c.nome,
        prefixo: c.prefixo,
        webhookUrl: c.webhookUrl,
        criadoEm: c.criadoEm.toISOString(),
        criadoPor: c.criadoPorNome,
        ultimoUsoEm: c.ultimoUsoEm?.toISOString() ?? null,
        revogadaEm: c.revogadaEm?.toISOString() ?? null,
        avisos: { enviados: meus.filter((e) => e.enviadoEm).length, falharam: meus.filter((e) => e.falhouEm).length, esperando: meus.filter((e) => !e.enviadoEm && !e.falhouEm).length },
      };
    });
  }

  listarChaves(empresaId: string): Promise<ChaveApiResumo[]> {
    return this.resumos(empresaId);
  }

  /** O webhook de agora em diante: as chamadas que já estão como estão não viram aviso. */
  private async marcarAtuais(empresaId: string) {
    await this.prisma.$executeRaw`UPDATE chamadas_entrega SET webhook_estado = situacao || ':' || parada_atual WHERE empresa_id = ${empresaId}::uuid AND (atualizado_em > ${new Date(Date.now() - JANELA_MUDANCAS_MS)} OR situacao NOT IN ('CONCLUIDA', 'CANCELADA'))`;
  }

  async criarChave(empresaId: string, dto: NovaChaveDto, u: UsuarioRequisicao): Promise<ChaveApiCriada> {
    const webhookUrl = dto.webhookUrl?.trim() || null;
    const problema = problemaNoWebhook(webhookUrl);
    if (problema) throw new BadRequestException(problema);
    const ativas = await this.prisma.chaveApiEntregas.count({ where: { empresaId, revogadaEm: null } });
    if (ativas >= MAX_CHAVES_API) throw new ConflictException(`A empresa pode ter até ${MAX_CHAVES_API} chaves ativas: revogue uma que não usa mais.`);
    const token = `${PREFIXO_CHAVE_API}${randomBytes(24).toString('base64url')}`;
    const segredo = `${PREFIXO_SEGREDO_WEBHOOK}${randomBytes(24).toString('base64url')}`;
    const autor = await this.prisma.usuario.findUnique({ where: { id: u.id }, select: { nome: true } });
    const c = await this.prisma.chaveApiEntregas.create({
      data: { empresaId, nome: dto.nome.trim(), tokenHash: hashDoToken(token), prefixo: token.slice(0, PREFIXO_CHAVE_API.length + 6), webhookUrl, webhookSegredoCifrado: cifrar(segredo, config().chaveCriptografia), criadoPorId: u.id, criadoPorNome: autor?.nome ?? null },
    });
    if (webhookUrl) await this.marcarAtuais(empresaId);
    await this.auditoria.registrar({ empresaId, usuarioId: u.id, acao: 'entrega.integracao.chave.criar', entidade: 'ChaveApiEntregas', entidadeId: c.id, detalhes: { nome: c.nome, webhookUrl } });
    const chave = (await this.resumos(empresaId)).find((x) => x.id === c.id)!;
    return { chave, token, segredoWebhook: segredo };
  }

  async definirWebhook(empresaId: string, id: string, dto: WebhookDto, autorId: string): Promise<ChaveApiResumo[]> {
    const webhookUrl = dto.webhookUrl?.trim() || null;
    const problema = problemaNoWebhook(webhookUrl);
    if (problema) throw new BadRequestException(problema);
    const { count } = await this.prisma.chaveApiEntregas.updateMany({ where: { id, empresaId, revogadaEm: null }, data: { webhookUrl } });
    if (!count) throw new NotFoundException('Chave não encontrada ou revogada.');
    if (webhookUrl) await this.marcarAtuais(empresaId);
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.integracao.webhook', entidade: 'ChaveApiEntregas', entidadeId: id, detalhes: { webhookUrl } });
    return this.resumos(empresaId);
  }

  async revogar(empresaId: string, id: string, autorId: string): Promise<ChaveApiResumo[]> {
    const { count } = await this.prisma.chaveApiEntregas.updateMany({ where: { id, empresaId, revogadaEm: null }, data: { revogadaEm: new Date() } });
    if (!count) throw new NotFoundException('Chave não encontrada ou já revogada.');
    // Avisos que ainda iam sair por esta chave param aqui.
    await this.prisma.envioWebhook.updateMany({ where: { chaveId: id, enviadoEm: null, falhouEm: null }, data: { falhouEm: new Date(), ultimoErro: 'Chave revogada.' } });
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.integracao.chave.revogar', entidade: 'ChaveApiEntregas', entidadeId: id });
    return this.resumos(empresaId);
  }

  async envios(empresaId: string, id: string): Promise<EnvioWebhookResumo[]> {
    const chave = await this.prisma.chaveApiEntregas.findFirst({ where: { id, empresaId }, select: { id: true } });
    if (!chave) throw new NotFoundException('Chave não encontrada.');
    const lista = await this.prisma.envioWebhook.findMany({ where: { chaveId: id }, orderBy: { criadoEm: 'desc' }, take: 50 });
    return lista.map((e) => this.resumoEnvio(e));
  }

  private resumoEnvio(e: { id: string; evento: string; corpo: Prisma.JsonValue; criadoEm: Date; tentativas: number; enviadoEm: Date | null; falhouEm: Date | null; ultimoStatus: number | null; ultimoErro: string | null }): EnvioWebhookResumo {
    const corpo = e.corpo as unknown as CorpoWebhook;
    return { id: e.id, evento: e.evento, numero: corpo.chamada?.numero ?? null, situacao: corpo.chamada?.situacao ?? null, criadoEm: e.criadoEm.toISOString(), tentativas: e.tentativas, enviadoEm: e.enviadoEm?.toISOString() ?? null, falhouEm: e.falhouEm?.toISOString() ?? null, ultimoStatus: e.ultimoStatus, ultimoErro: e.ultimoErro };
  }

  /** Manda um aviso de teste agora e devolve como foi. */
  async testar(empresaId: string, id: string): Promise<EnvioWebhookResumo> {
    const chave = await this.prisma.chaveApiEntregas.findFirst({ where: { id, empresaId, revogadaEm: null } });
    if (!chave) throw new NotFoundException('Chave não encontrada ou revogada.');
    if (!chave.webhookUrl) throw new ConflictException('Informe primeiro o endereço que recebe os avisos.');
    const envio = await this.prisma.envioWebhook.create({ data: { chaveId: id, evento: 'teste', corpo: this.corpo('teste', null) as never, proximaEm: new Date(Date.now() + 60_000) } });
    await this.enviar(envio.id, new Date());
    return this.resumoEnvio(await this.prisma.envioWebhook.findUniqueOrThrow({ where: { id: envio.id } }));
  }

  // Avisos -----------------------------------------------------------------------------------

  private corpo(evento: EventoWebhook, chamada: ChamadaIntegracao | null): CorpoWebhook {
    return { evento, id: randomUUID(), enviadoEm: new Date().toISOString(), chamada };
  }

  async procurarMudancas(agora = new Date()): Promise<number> {
    const chaves = await this.prisma.chaveApiEntregas.findMany({ where: { revogadaEm: null, webhookUrl: { not: null } }, select: { id: true, empresaId: true } });
    if (!chaves.length) return 0;
    const empresas = [...new Set(chaves.map((c) => c.empresaId))];
    const mudadas = await this.prisma.$queryRaw<{ id: string; situacao: string; parada_atual: number; webhook_estado: string | null }[]>`
      SELECT id, situacao, parada_atual, webhook_estado FROM chamadas_entrega
      WHERE empresa_id = ANY(${empresas}::uuid[])
        AND (atualizado_em > ${new Date(agora.getTime() - JANELA_MUDANCAS_MS)} OR criado_em > ${new Date(agora.getTime() - JANELA_MUDANCAS_MS)})
        AND webhook_estado IS DISTINCT FROM (situacao || ':' || parada_atual)
      ORDER BY atualizado_em
      LIMIT 200`;
    let n = 0;
    for (const m of mudadas) {
      const novo = estado({ situacao: m.situacao, paradaAtual: m.parada_atual });
      const c = await this.prisma.chamadaEntrega.findUnique({ where: { id: m.id }, include: INCLUIR });
      if (!c) continue;
      const dados = this.paraIntegracao(c);
      await this.prisma.$transaction(async (tx) => {
        // Reivindica a mudança: duas voltas do relógio não avisam duas vezes.
        const { count } = await tx.chamadaEntrega.updateMany({ where: { id: m.id, webhookEstado: m.webhook_estado }, data: { webhookEstado: novo } });
        if (!count) return;
        const destino = chaves.filter((k) => k.empresaId === c.empresaId);
        await tx.envioWebhook.createMany({ data: destino.map((k) => ({ chaveId: k.id, chamadaId: c.id, evento: 'chamada.situacao', corpo: this.corpo('chamada.situacao', dados) as never, proximaEm: agora })) });
        n += destino.length;
      });
    }
    return n;
  }

  async enviarPendentes(agora = new Date()): Promise<number> {
    const pendentes = await this.prisma.envioWebhook.findMany({ where: { enviadoEm: null, falhouEm: null, proximaEm: { lte: agora } }, orderBy: { proximaEm: 'asc' }, take: 20, select: { id: true } });
    for (const p of pendentes) await this.enviar(p.id, agora);
    return pendentes.length;
  }

  private async enviar(id: string, agora: Date): Promise<void> {
    const e = await this.prisma.envioWebhook.findUnique({ where: { id }, include: { chave: true } });
    if (!e || e.enviadoEm || e.falhouEm) return;
    // Reivindica: outra volta do relógio não manda o mesmo aviso junto.
    const { count } = await this.prisma.envioWebhook.updateMany({ where: { id, proximaEm: e.proximaEm, enviadoEm: null, falhouEm: null }, data: { proximaEm: new Date(agora.getTime() + 2 * 60_000) } });
    if (!count) return;
    let status: number | null = null;
    let erro: string | null = null;
    if (!e.chave.webhookUrl || e.chave.revogadaEm) erro = 'A chave não tem mais endereço de aviso.';
    else {
      try {
        // A data da tentativa vai no corpo e na assinatura: quem recebe recusa aviso velho repetido.
        const corpo = JSON.stringify({ ...(e.corpo as object), enviadoEm: new Date().toISOString() });
        status = await this.postar(e.chave.webhookUrl, corpo, decifrar(e.chave.webhookSegredoCifrado, config().chaveCriptografia), e.evento, (e.corpo as unknown as CorpoWebhook).id);
        if (status < 200 || status >= 300) erro = `O endereço respondeu ${status}.`;
      } catch (x) {
        erro = (x as Error).message.slice(0, 300);
      }
    }
    const tentativas = e.tentativas + 1;
    if (!erro) {
      await this.prisma.envioWebhook.update({ where: { id }, data: { tentativas, enviadoEm: new Date(), ultimoStatus: status, ultimoErro: null } });
      return;
    }
    const espera = e.evento === 'teste' ? null : esperaDoWebhook(tentativas);
    await this.prisma.envioWebhook.update({ where: { id }, data: { tentativas, ultimoStatus: status, ultimoErro: erro, ...(espera === null ? { falhouEm: new Date() } : { proximaEm: new Date(Date.now() + espera) }) } });
  }

  /** Só para endereço público (confere o DNS), sem seguir redirecionamento, com 10 s de espera. */
  private async postar(url: string, corpo: string, segredo: string, evento: string, idAviso: string): Promise<number> {
    // Só os testes de ponta a ponta ligam isto, para receber os avisos num servidor local.
    const redeInterna = !!process.env.WEBHOOK_PERMITE_REDE_INTERNA;
    const problema = redeInterna ? null : problemaNoWebhook(url);
    if (problema) throw new Error(problema);
    const host = new URL(url).hostname;
    if (!redeInterna) {
      const ips = await lookup(host, { all: true }).catch(() => [] as { address: string }[]);
      if (!ips.length) throw new Error('O endereço do aviso não foi encontrado (DNS).');
      if (ips.some((i) => ipPrivado(i.address))) throw new Error('O endereço do aviso aponta para uma rede interna.');
    }
    const momento = Math.floor(Date.now() / 1000);
    const assinatura = createHmac('sha256', segredo).update(`${momento}.${corpo}`).digest('hex');
    const r = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(ESPERA_RESPOSTA_MS),
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Flow-Entregas-Webhook/1', 'X-Flow-Evento': evento, 'X-Flow-Id': idAviso, 'X-Flow-Momento': String(momento), 'X-Flow-Assinatura': `sha256=${assinatura}` },
      body: corpo,
    });
    await r.arrayBuffer().catch(() => undefined);
    return r.status;
  }

  // Chamadas pela API ------------------------------------------------------------------------

  private paraIntegracao(c: ChamadaParaIntegracao): ChamadaIntegracao {
    const terminou = c.situacao === 'CONCLUIDA' || c.situacao === 'CANCELADA';
    const caminho = caminhoDoRastreio(c.rastreioCifrado);
    const url = config().urlPublica;
    return {
      id: c.id,
      numero: c.numero,
      referencia: c.referenciaExterna,
      tipo: c.tipo as TipoChamada,
      situacao: c.situacao as SituacaoChamada,
      situacaoTexto: textoParaCliente(c.tipo as TipoChamada, c.situacao as SituacaoChamada),
      valorCentavos: c.valorCentavos,
      paradaAtual: c.paradaAtual,
      paradas: 1 + c._count.paradas,
      entregador: c.entregador ? { nome: primeiroNome(c.entregador.nome), veiculo: ROTULO_VEICULO[c.entregador.veiculo as TipoVeiculo] ?? c.entregador.veiculo, placa: c.entregador.placa } : null,
      codigoConfirmacao: terminou || c.paradaAtual > 0 || c.devolucao || c.assinatura === 'NO_LUGAR_DO_CODIGO' ? null : c.codigoConfirmacao,
      rastreio: caminho ? (url ? `${url}${caminho}` : caminho) : null,
      criadaEm: c.criadoEm.toISOString(),
      coletadaEm: c.coletadaEm?.toISOString() ?? null,
      concluidaEm: c.concluidaEm?.toISOString() ?? null,
    };
  }

  async obter(empresaId: string, id: string): Promise<ChamadaIntegracao> {
    const c = await this.prisma.chamadaEntrega.findFirst({ where: { id, empresaId }, include: INCLUIR });
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    return this.paraIntegracao(c);
  }

  async porReferencia(empresaId: string, referencia: string): Promise<ChamadaIntegracao> {
    const ref = referenciaLimpa(referencia);
    if (!ref) throw new BadRequestException('Informe a referência.');
    const c = await this.prisma.chamadaEntrega.findFirst({ where: { empresaId, referenciaExterna: ref }, include: INCLUIR });
    if (!c) throw new NotFoundException('Nenhuma chamada com essa referência.');
    return this.paraIntegracao(c);
  }

  /** Ponto pelo endereço quando o sistema não manda lat/lon. */
  private async parada(p: ParadaIntegracaoDto, nome: string): Promise<ParadaChamada> {
    let { lat, lon } = p;
    let endereco = p.endereco.trim();
    if (lat == null || lon == null) {
      const achados = await this.mapas.geocodificar(endereco);
      if (!achados.length) throw new BadRequestException(`Não encontramos o endereço de ${nome} no mapa: mande lat e lon.`);
      lat = achados[0].lat;
      lon = achados[0].lon;
    }
    endereco = endereco.slice(0, 300);
    return { lat, lon, endereco, contato: (p.contato ?? '').trim().slice(0, 80), telefone: (p.telefone ?? '').replace(/\D/g, '').slice(0, 20), instrucoes: (p.instrucoes ?? '').trim().slice(0, 300) };
  }

  private async montar(empresaId: string, dto: NovaChamadaIntegracaoDto): Promise<NovaChamadaDto> {
    const tipo = dto.tipo ?? 'ENTREGA';
    let origem: ParadaChamada;
    if (dto.origem) origem = await this.parada(dto.origem, 'coleta');
    else {
      const { base } = await this.empresas.config(empresaId);
      if (!base) throw new ConflictException('A empresa não marcou o ponto de partida (Entregas > Configuração): mande a origem.');
      origem = { lat: base.lat, lon: base.lon, endereco: base.endereco || 'Empresa', contato: '', telefone: '', instrucoes: '' };
    }
    const destino = await this.parada(dto.destino, 'destino');
    const paradas: ParadaChamada[] = [];
    for (const [i, p] of (dto.paradas ?? []).entries()) paradas.push(await this.parada(p, `a parada ${i + 1}`));
    if (paradas.length && tipo !== 'ENTREGA') throw new BadRequestException('Paradas só no tipo ENTREGA.');
    return { tipo, origem, destino, serieEsperada: null, observacao: (dto.observacao ?? '').slice(0, 500), distribuir: dto.distribuir, paradasExtras: paradas, valorDeclaradoCentavos: dto.valorDeclaradoCentavos ?? null, agendadaPara: dto.agendadaPara ?? null } as NovaChamadaDto;
  }

  async previa(empresaId: string, dto: NovaChamadaIntegracaoDto): Promise<PreviaChamada> {
    return this.chamadas.previa(empresaId, await this.montar(empresaId, dto));
  }

  /** A mesma referência devolve a chamada que já existe (o sistema pode repetir o pedido sem medo). */
  async criar(i: Integracao, dto: NovaChamadaIntegracaoDto): Promise<{ chamada: ChamadaIntegracao; criada: boolean }> {
    const referencia = referenciaLimpa(dto.referencia);
    if (referencia) {
      const existe = await this.prisma.chamadaEntrega.findFirst({ where: { empresaId: i.empresaId, referenciaExterna: referencia }, select: { id: true } });
      if (existe) return { chamada: await this.obter(i.empresaId, existe.id), criada: false };
    }
    const nova = await this.montar(i.empresaId, dto);
    try {
      const c = await this.chamadas.criar(i.empresaId, nova, null, { referenciaExterna: referencia, aberturaPor: `pela integração "${i.nome}"` });
      return { chamada: await this.obter(i.empresaId, c.id), criada: true };
    } catch (e) {
      if (referencia && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existe = await this.prisma.chamadaEntrega.findFirstOrThrow({ where: { empresaId: i.empresaId, referenciaExterna: referencia }, select: { id: true } });
        return { chamada: await this.obter(i.empresaId, existe.id), criada: false };
      }
      throw e;
    }
  }

  async cancelar(i: Integracao, id: string, motivo: string): Promise<ChamadaIntegracao> {
    await this.chamadas.cancelar(i.empresaId, id, `${motivo.trim()} (pela integração "${i.nome}")`, null);
    return this.obter(i.empresaId, id);
  }
}

// Rotas da empresa (tela) ------------------------------------------------------------------

@Controller('entregas/integracao')
export class IntegracaoEmpresaController {
  constructor(private readonly integracao: IntegracaoService) {}

  @Get('chaves')
  @RequerPermissao('entrega.configurar')
  chaves(@EmpresaAtual() empresaId: string): Promise<ChaveApiResumo[]> {
    return this.integracao.listarChaves(empresaId);
  }

  @Post('chaves')
  @HttpCode(200)
  @RequerPermissao('entrega.configurar')
  criar(@EmpresaAtual() empresaId: string, @Body() dto: NovaChaveDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<ChaveApiCriada> {
    return this.integracao.criarChave(empresaId, dto, u);
  }

  @Post('chaves/:id/webhook')
  @HttpCode(200)
  @RequerPermissao('entrega.configurar')
  webhook(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: WebhookDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<ChaveApiResumo[]> {
    return this.integracao.definirWebhook(empresaId, id, dto, u.id);
  }

  @Post('chaves/:id/revogar')
  @HttpCode(200)
  @RequerPermissao('entrega.configurar')
  revogar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao): Promise<ChaveApiResumo[]> {
    return this.integracao.revogar(empresaId, id, u.id);
  }

  @Post('chaves/:id/testar')
  @HttpCode(200)
  @RequerPermissao('entrega.configurar')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  testar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string): Promise<EnvioWebhookResumo> {
    return this.integracao.testar(empresaId, id);
  }

  @Get('chaves/:id/envios')
  @RequerPermissao('entrega.configurar')
  envios(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string): Promise<EnvioWebhookResumo[]> {
    return this.integracao.envios(empresaId, id);
  }
}

// API pública (sistema da empresa) ---------------------------------------------------------

@Publico()
@UseGuards(ChaveApiGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('integracao/entregas/v1')
export class IntegracaoApiController {
  constructor(private readonly integracao: IntegracaoService) {}

  @Post('previa')
  @HttpCode(200)
  previa(@IntegracaoAtual() i: Integracao, @Body() dto: NovaChamadaIntegracaoDto): Promise<PreviaChamada> {
    return this.integracao.previa(i.empresaId, dto);
  }

  @Post('chamadas')
  @HttpCode(200)
  criar(@IntegracaoAtual() i: Integracao, @Body() dto: NovaChamadaIntegracaoDto): Promise<{ chamada: ChamadaIntegracao; criada: boolean }> {
    return this.integracao.criar(i, dto);
  }

  @Get('chamadas')
  porReferencia(@IntegracaoAtual() i: Integracao, @Query('referencia') referencia: string): Promise<ChamadaIntegracao> {
    return this.integracao.porReferencia(i.empresaId, referencia ?? '');
  }

  @Get('chamadas/:id')
  obter(@IntegracaoAtual() i: Integracao, @Param('id', ParseUUIDPipe) id: string): Promise<ChamadaIntegracao> {
    return this.integracao.obter(i.empresaId, id);
  }

  @Post('chamadas/:id/cancelar')
  @HttpCode(200)
  cancelar(@IntegracaoAtual() i: Integracao, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelarDto): Promise<ChamadaIntegracao> {
    return this.integracao.cancelar(i, id, dto.motivo);
  }
}
