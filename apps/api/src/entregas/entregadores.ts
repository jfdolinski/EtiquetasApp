import { BadRequestException, Body, CanActivate, ConflictException, Controller, createParamDecorator, Delete, ExecutionContext, ForbiddenException, Get, HttpCode, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy, Param, ParseUUIDPipe, Post, Put, UnauthorizedException, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import {
  coordenadaValida,
  diaNoFuso,
  documentosExigidos,
  formatarCpf,
  MINUTOS_OFFLINE_AUTOMATICO,
  caminhoRedefinirSenhaEntregador,
  primeiroNome,
  SENHA_ENTREGADOR_MINIMO,
  normalizarCelular,
  normalizarCpf,
  normalizarPlaca,
  problemaNoCadastroEntregador,
  TIPOS_DOCUMENTO_ENTREGADOR,
  TIPOS_VEICULO,
  veiculoMotorizado,
  VERSAO_TERMOS_ENTREGADOR,
  type CreditosEntregador,
  type PedidoCreditoResumo,
  type PerfilEntregador,
  type RespostaPosicao,
  type SessaoEntregadorResposta,
  type SituacaoEntregador,
  type TipoDocumentoEntregador,
  type TipoVeiculo,
} from '@etiquetas/shared';
import { hashDoToken } from '../auth/conta.service';
import { Publico } from '../auth/decorators';
import { compararComHashFicticio, conferirSenha, gerarHashSenha, aposSenhaErrada, MENSAGEM_SENHA_BLOQUEADA, senhaBloqueada } from '../auth/senha';
import { sha256 } from '../cripto';
import { EmailService } from '../email/email.service';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { ChamadasService } from './chamadas';
import { CreditosService } from './creditos';
import { EntregadorAtual, EntregadorGuard, PREFIXO_TOKEN } from './guarda';
import { imagemDoDataUrl } from './imagens';

const INTERVALO_RELOGIO_MS = 60_000;

// DTOs -------------------------------------------------------------------------------------

class CadastroEntregadorDto {
  @IsString() @MaxLength(120) nome: string;
  @IsString() @MaxLength(20) cpf: string;
  @IsString() @MaxLength(20) celular: string;
  @IsString() @MaxLength(160) email: string;
  @IsString() @MaxLength(200) senha: string;
  @IsIn(TIPOS_VEICULO, { message: 'Escolha o veículo.' }) veiculo: TipoVeiculo;
  @IsOptional() @IsString() @MaxLength(10) placa?: string | null;
  @IsString() @MaxLength(77) chavePix: string;
  @IsBoolean() aceitaTermos: boolean;
  @IsOptional() @IsString() @MaxLength(80) dispositivo?: string;
  @IsOptional() @IsString() @MaxLength(40) versao?: string;
}

class EsqueciSenhaEntregadorDto {
  @IsString() @MinLength(3) @MaxLength(160) email: string;
}

class RedefinirSenhaEntregadorDto {
  @IsString() @MinLength(20) @MaxLength(200) token: string;
  @IsString() @MaxLength(200) senha: string;
}

class LoginEntregadorDto {
  @IsString() @MinLength(3) @MaxLength(160) login: string;
  @IsString() @MinLength(1) @MaxLength(200) senha: string;
  @IsOptional() @IsString() @MaxLength(80) dispositivo?: string;
  @IsOptional() @IsString() @MaxLength(40) versao?: string;
}

class DadosEntregadorDto {
  @IsOptional() @IsString() @MaxLength(20) celular?: string;
  @IsOptional() @IsString() @MaxLength(77) chavePix?: string;
  @IsOptional() @IsIn(TIPOS_VEICULO, { message: 'Escolha o veículo.' }) veiculo?: TipoVeiculo;
  @IsOptional() @IsString() @MaxLength(10) placa?: string | null;
}

class ImagemDto {
  @IsString() @MaxLength(7_200_000) imagem: string;
}

class PagamentoDto {
  @IsOptional() @IsString() @MaxLength(7_200_000) comprovante?: string | null;
}

class PedidoCreditoDto {
  @IsUUID('all', { message: 'Pacote inválido.' }) pacoteId: string;
}

export class PosicaoDto {
  @IsNumber() @Min(-90) @Max(90) lat: number;
  @IsNumber() @Min(-180) @Max(180) lon: number;
  @IsOptional() @IsNumber() @Min(0) precisao?: number | null;
  /** O Android informa quando a posição vem de um aplicativo de GPS falso. */
  @IsOptional() @IsBoolean() simulada?: boolean;
  @IsOptional() @IsString() @MaxLength(40) versao?: string;
}

// Serviço ----------------------------------------------------------------------------------

type EntregadorDoBanco = Prisma.EntregadorGetPayload<{ include: { documentos: { select: { tipo: true; criadoEm: true } } } }>;

export function documentosFaltando(veiculo: TipoVeiculo, enviados: string[]): TipoDocumentoEntregador[] {
  return documentosExigidos(veiculo).filter((t) => !enviados.includes(t));
}

/** Dia da diária como data do banco (coluna DATE). */
const dataDoDia = (dia: string) => new Date(`${dia}T00:00:00Z`);

@Injectable()
export class EntregadoresService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Entregadores');
  private relogio?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly creditos: CreditosService,
    private readonly chamadas: ChamadasService,
    private readonly email: EmailService,
  ) {}

  onApplicationBootstrap() {
    this.relogio = setInterval(() => void this.desligarSemAviso(), INTERVALO_RELOGIO_MS);
  }

  onModuleDestroy() {
    clearInterval(this.relogio);
  }

  /** App fechado à força ou sem internet: sem aviso por 10 min, sai do mapa. */
  async desligarSemAviso(agora = new Date()): Promise<number> {
    try {
      const { count } = await this.prisma.entregador.updateMany({
        where: { online: true, OR: [{ avisoEm: null }, { avisoEm: { lt: new Date(agora.getTime() - MINUTOS_OFFLINE_AUTOMATICO * 60_000) } }] },
        data: { online: false, onlineDesde: null },
      });
      return count;
    } catch (e) {
      this.log.error(`Falha ao desligar entregadores sem aviso: ${(e as Error).message}`);
      return 0;
    }
  }

  // Conta ----------------------------------------------------------------------------------

  async cadastrar(dto: CadastroEntregadorDto): Promise<SessaoEntregadorResposta> {
    const problema = problemaNoCadastroEntregador(dto);
    if (problema) throw new BadRequestException(problema);
    const cpf = normalizarCpf(dto.cpf);
    const email = dto.email.trim().toLowerCase();
    try {
      const e = await this.prisma.entregador.create({
        data: {
          nome: dto.nome.trim().replace(/\s+/g, ' '),
          cpf,
          email,
          celular: normalizarCelular(dto.celular)!,
          senhaHash: await gerarHashSenha(dto.senha),
          veiculo: dto.veiculo,
          placa: veiculoMotorizado(dto.veiculo) ? normalizarPlaca(dto.placa ?? '') : null,
          chavePix: dto.chavePix.trim(),
          termosVersao: VERSAO_TERMOS_ENTREGADOR,
          termosAceitosEm: new Date(),
          versaoApp: dto.versao ?? null,
        },
      });
      return this.abrirSessao(e.id, dto.dispositivo);
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        throw new ConflictException('Já existe um cadastro com este CPF ou e-mail. Entre com sua senha.');
      }
      throw erro;
    }
  }

  async entrar(dto: LoginEntregadorDto): Promise<SessaoEntregadorResposta> {
    const login = dto.login.trim().toLowerCase();
    const cpf = normalizarCpf(login);
    const e = await this.prisma.entregador.findFirst({ where: login.includes('@') ? { email: login } : { cpf }, select: { id: true, senhaHash: true, senhaFalhas: true, senhaBloqueadaAte: true } });
    const ok = e ? await conferirSenha(dto.senha, e.senhaHash) : await compararComHashFicticio(dto.senha);
    // Bloqueio por conta (o limite por IP não segura tentativas de vários endereços).
    if (e && senhaBloqueada(e.senhaBloqueadaAte)) throw new HttpException(MENSAGEM_SENHA_BLOQUEADA, HttpStatus.TOO_MANY_REQUESTS);
    if (e && !ok) {
      const { senhaFalhas } = await this.prisma.entregador.update({ where: { id: e.id }, data: { senhaFalhas: { increment: 1 } }, select: { senhaFalhas: true } });
      const bloqueio = aposSenhaErrada(senhaFalhas);
      if (bloqueio) await this.prisma.entregador.update({ where: { id: e.id }, data: bloqueio });
    }
    if (!e || !ok) throw new UnauthorizedException('E-mail/CPF ou senha incorretos.');
    if (e.senhaFalhas > 0) await this.prisma.entregador.update({ where: { id: e.id }, data: { senhaFalhas: 0 } });
    if (dto.versao) await this.prisma.entregador.update({ where: { id: e.id }, data: { versaoApp: dto.versao } });
    return this.abrirSessao(e.id, dto.dispositivo);
  }

  private async abrirSessao(entregadorId: string, dispositivo?: string): Promise<SessaoEntregadorResposta> {
    const token = `${PREFIXO_TOKEN}${randomBytes(32).toString('base64url')}`;
    await this.prisma.sessaoEntregador.create({ data: { entregadorId, tokenHash: hashDoToken(token), dispositivo: (dispositivo ?? '').slice(0, 80) } });
    return { token, perfil: await this.perfil(entregadorId) };
  }

  async sair(entregadorId: string, sessaoId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.sessaoEntregador.update({ where: { id: sessaoId }, data: { encerradaEm: new Date() } }),
      this.prisma.entregador.update({ where: { id: entregadorId }, data: { online: false, onlineDesde: null } }),
    ]);
  }

  async perfil(id: string): Promise<PerfilEntregador> {
    const e = await this.prisma.entregador.findUnique({ where: { id }, include: { documentos: { select: { tipo: true, criadoEm: true } } } });
    if (!e) throw new UnauthorizedException('Cadastro não encontrado.');
    const agora = new Date();
    const [saldo, diaria] = await Promise.all([
      this.creditos.saldo(id, agora),
      this.prisma.diariaEntregador.count({ where: { entregadorId: id, dia: dataDoDia(diaNoFuso(agora, config().fusoHorario)) } }),
    ]);
    return this.montarPerfil(e, saldo, diaria > 0);
  }

  private montarPerfil(e: EntregadorDoBanco, saldo: number, diariaHoje: boolean): PerfilEntregador {
    return {
      id: e.id,
      nome: e.nome,
      cpf: formatarCpf(e.cpf),
      celular: e.celular,
      email: e.email,
      veiculo: e.veiculo as TipoVeiculo,
      placa: e.placa,
      chavePix: e.chavePix,
      situacao: e.situacao as SituacaoEntregador,
      motivo: e.motivo,
      documentos: e.documentos.map((d) => ({ tipo: d.tipo as TipoDocumentoEntregador, enviadoEm: d.criadoEm.toISOString() })),
      documentosFaltando: documentosFaltando(e.veiculo as TipoVeiculo, e.documentos.map((d) => d.tipo)),
      online: e.online,
      diariaHoje,
      saldoDiarias: saldo,
    };
  }

  /** Celular e chave Pix mudam sempre; veículo e placa só antes da aprovação (a análise valeu para eles). */
  async alterarDados(id: string, dto: DadosEntregadorDto): Promise<PerfilEntregador> {
    const e = await this.prisma.entregador.findUniqueOrThrow({ where: { id } });
    const data: Prisma.EntregadorUpdateInput = {};
    if (dto.celular !== undefined) {
      const celular = normalizarCelular(dto.celular);
      if (!celular) throw new BadRequestException('Informe um celular com DDD.');
      data.celular = celular;
    }
    if (dto.chavePix !== undefined) {
      if (dto.chavePix.trim().length < 3) throw new BadRequestException('Informe a chave Pix.');
      data.chavePix = dto.chavePix.trim();
    }
    if (dto.veiculo !== undefined || dto.placa !== undefined) {
      if (e.situacao === 'APROVADO' || e.situacao === 'SUSPENSO') throw new ForbiddenException('Para trocar o veículo depois da aprovação, fale com o suporte.');
      const veiculo = dto.veiculo ?? (e.veiculo as TipoVeiculo);
      const placa = veiculoMotorizado(veiculo) ? normalizarPlaca(dto.placa ?? e.placa ?? '') : null;
      if (veiculoMotorizado(veiculo) && !placa) throw new BadRequestException('Placa inválida.');
      data.veiculo = veiculo;
      data.placa = placa;
    }
    await this.prisma.entregador.update({ where: { id }, data });
    return this.perfil(id);
  }

  async enviarDocumento(id: string, tipo: string, dados: string): Promise<PerfilEntregador> {
    if (!TIPOS_DOCUMENTO_ENTREGADOR.includes(tipo as TipoDocumentoEntregador)) throw new NotFoundException('Documento desconhecido.');
    const e = await this.prisma.entregador.findUniqueOrThrow({ where: { id }, select: { situacao: true } });
    if (e.situacao === 'APROVADO' || e.situacao === 'SUSPENSO') throw new ForbiddenException('Para trocar um documento depois da aprovação, fale com o suporte.');
    const { bytes, mime } = imagemDoDataUrl(dados, 'O documento');
    await this.prisma.documentoEntregador.upsert({
      where: { entregadorId_tipo: { entregadorId: id, tipo } },
      create: { entregadorId: id, tipo, mime, bytes },
      update: { mime, bytes, criadoEm: new Date() },
    });
    return this.perfil(id);
  }

  /** Recusado corrigiu: volta para a fila de aprovação. */
  async reenviarParaAnalise(id: string): Promise<PerfilEntregador> {
    const p = await this.perfil(id);
    if (p.situacao !== 'RECUSADO') throw new ConflictException('O cadastro não está recusado.');
    if (p.documentosFaltando.length) throw new BadRequestException('Envie todos os documentos antes.');
    await this.prisma.entregador.updateMany({ where: { id, situacao: 'RECUSADO' }, data: { situacao: 'PENDENTE' } });
    return this.perfil(id);
  }

  // Diária e posição -------------------------------------------------------------------------

  /** Desconta a diária de hoje se ainda não foi; false = sem saldo. */
  async garantirDiaria(entregadorId: string, agora = new Date()): Promise<boolean> {
    const dia = dataDoDia(diaNoFuso(agora, config().fusoHorario));
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (await tx.diariaEntregador.findUnique({ where: { entregadorId_dia: { entregadorId, dia } } })) return true;
        for (let tentativa = 0; tentativa < 3; tentativa++) {
          const lote = await tx.loteCredito.findFirst({ where: { entregadorId, restante: { gt: 0 }, venceEm: { gt: agora } }, orderBy: { venceEm: 'asc' } });
          if (!lote) return false;
          const { count } = await tx.loteCredito.updateMany({ where: { id: lote.id, restante: { gt: 0 } }, data: { restante: { decrement: 1 } } });
          if (!count) continue;
          await tx.diariaEntregador.create({ data: { entregadorId, dia, loteId: lote.id } });
          return true;
        }
        return false;
      });
    } catch (erro) {
      // Dois avisos ao mesmo tempo: o outro já descontou (a transação deste foi desfeita).
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') return true;
      throw erro;
    }
  }

  /** Ficar online e cada aviso de posição passam por aqui. Virou o dia, desconta a diária nova. */
  async posicao(id: string, dto: PosicaoDto, ficarOnline: boolean): Promise<RespostaPosicao> {
    const agora = new Date();
    const e = await this.prisma.entregador.findUniqueOrThrow({ where: { id }, select: { situacao: true, online: true, onlineDesde: true } });
    const saldo = () => this.creditos.saldo(id, agora);
    if (e.situacao !== 'APROVADO') {
      if (e.online) await this.prisma.entregador.update({ where: { id }, data: { online: false, onlineDesde: null } });
      return { online: false, aviso: 'NAO_APROVADO', saldoDiarias: await saldo(), oferta: null, chamadaId: null };
    }
    if (!e.online && !ficarOnline) return { online: false, aviso: null, saldoDiarias: await saldo(), oferta: null, chamadaId: null };
    if (dto.simulada || !coordenadaValida(dto)) {
      // Não grava a posição; o aviso conta como sinal de vida.
      await this.prisma.entregador.update({ where: { id }, data: { avisoEm: agora } });
      return { online: e.online, aviso: dto.simulada ? 'GPS_FALSO' : null, saldoDiarias: await saldo(), ...(await this.deTrabalho(id, e.online)) };
    }
    if (!(await this.garantirDiaria(id, agora))) {
      await this.prisma.entregador.update({ where: { id }, data: { online: false, onlineDesde: null, avisoEm: agora } });
      return { online: false, aviso: 'SEM_CREDITO', saldoDiarias: 0, oferta: null, chamadaId: await this.chamadas.chamadaAtivaId(id) };
    }
    await this.prisma.entregador.update({
      where: { id },
      data: {
        online: true,
        onlineDesde: e.online ? e.onlineDesde : agora,
        lat: dto.lat,
        lon: dto.lon,
        precisaoMetros: dto.precisao ?? null,
        posicaoEm: agora,
        avisoEm: agora,
        ...(dto.versao ? { versaoApp: dto.versao } : {}),
      },
    });
    const trabalho = await this.deTrabalho(id, true);
    for (const chamadaId of trabalho.chamadaIds) await this.chamadas.gravarRastro(chamadaId, dto, agora).catch(() => undefined);
    return { online: true, aviso: null, saldoDiarias: await saldo(), ...trabalho };
  }

  /** O aviso de posição leva a oferta pendente: sem Firebase, é assim que o app fica sabendo. */
  private async deTrabalho(id: string, online: boolean) {
    const [oferta, chamadaIds] = await Promise.all([online ? this.chamadas.ofertaPendente(id) : null, this.chamadas.chamadasAtivasIds(id)]);
    return { oferta, chamadaId: chamadaIds[0] ?? null, chamadaIds };
  }

  // Senha esquecida ------------------------------------------------------------------------

  /** Sem e-mail configurado, o app nem mostra "Esqueci a senha". */
  recursos(): { esqueciSenha: boolean } {
    return { esqueciSenha: this.email.disponivel && Boolean(config().urlPublica) };
  }

  /** Responde igual exista ou não o e-mail; o token vai depois do # (fora de logs). */
  async pedirRedefinicao(email: string): Promise<void> {
    const url = config().urlPublica;
    if (!this.email.disponivel || !url) return;
    const e = await this.prisma.entregador.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true, nome: true, email: true, situacao: true } });
    if (!e || e.situacao === 'SUSPENSO') return;
    const recentes = await this.prisma.redefinicaoSenhaEntregador.count({ where: { entregadorId: e.id, criadoEm: { gt: new Date(Date.now() - 3_600_000) } } });
    if (recentes >= 3) return;
    const token = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      this.prisma.redefinicaoSenhaEntregador.updateMany({ where: { entregadorId: e.id, usadoEm: null }, data: { usadoEm: new Date() } }),
      this.prisma.redefinicaoSenhaEntregador.create({ data: { entregadorId: e.id, tokenHash: sha256(token), expiraEm: new Date(Date.now() + 3_600_000) } }),
    ]);
    void this.email.enviar(
      e.email,
      'Nova senha - Flow Entregas',
      `Olá, ${primeiroNome(e.nome)}.\n\nPara criar uma nova senha do Flow Entregas, abra este link em até 1 hora:\n${url}${caminhoRedefinirSenhaEntregador(token)}\n\nSe não foi você quem pediu, ignore este e-mail: sua senha continua a mesma.`,
    );
  }

  /** Nova senha: o link vale uma vez e encerra todas as sessões (o app pede para entrar de novo). */
  async redefinirSenha(token: string, senha: string): Promise<void> {
    if (senha.length < SENHA_ENTREGADOR_MINIMO) throw new BadRequestException(`A senha precisa ter ao menos ${SENHA_ENTREGADOR_MINIMO} caracteres.`);
    const pedido = await this.prisma.redefinicaoSenhaEntregador.findUnique({ where: { tokenHash: sha256(token) } });
    if (!pedido || pedido.usadoEm || pedido.expiraEm < new Date()) throw new BadRequestException('Este link já foi usado ou expirou. Peça um novo no aplicativo.');
    const agora = new Date();
    const senhaHash = await gerarHashSenha(senha);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.redefinicaoSenhaEntregador.updateMany({ where: { id: pedido.id, usadoEm: null }, data: { usadoEm: agora } });
      if (!count) throw new BadRequestException('Este link já foi usado ou expirou. Peça um novo no aplicativo.');
      await tx.entregador.update({ where: { id: pedido.entregadorId }, data: { senhaHash, senhaFalhas: 0, senhaBloqueadaAte: null } });
      await tx.sessaoEntregador.updateMany({ where: { entregadorId: pedido.entregadorId, encerradaEm: null }, data: { encerradaEm: agora } });
    });
  }

  async ficarOffline(id: string): Promise<void> {
    if (await this.chamadas.chamadaAtivaId(id)) throw new ConflictException('Termine a chamada em andamento (ou registre uma ocorrência) antes de ficar offline.');
    // Oferta esperando resposta dele volta para a empresa.
    const pendentes = await this.prisma.ofertaChamada.findMany({ where: { entregadorId: id, resultado: 'PENDENTE' }, select: { chamadaId: true } });
    await this.prisma.ofertaChamada.updateMany({ where: { entregadorId: id, resultado: 'PENDENTE' }, data: { resultado: 'RECUSADA', respondidaEm: new Date() } });
    // Em distribuição: segue para o próximo sem esperar o prazo.
    if (pendentes.length) await this.prisma.chamadaEntrega.updateMany({ where: { id: { in: pendentes.map((p) => p.chamadaId) }, distribuicaoAtiva: true }, data: { proximaTentativaEm: new Date() } });
    await this.prisma.entregador.update({ where: { id }, data: { online: false, onlineDesde: null } });
  }
}

// Rotas do app ---------------------------------------------------------------------------------

@Publico()
@Controller('entregador')
export class EntregadorPublicoController {
  constructor(private readonly entregadores: EntregadoresService) {}

  @Post('cadastro')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  cadastrar(@Body() dto: CadastroEntregadorDto): Promise<SessaoEntregadorResposta> {
    return this.entregadores.cadastrar(dto);
  }

  @Get('recursos')
  recursos(): { esqueciSenha: boolean } {
    return this.entregadores.recursos();
  }

  @Post('senha/esqueci')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  esqueci(@Body() dto: EsqueciSenhaEntregadorDto): Promise<void> {
    return this.entregadores.pedirRedefinicao(dto.email);
  }

  @Post('senha/redefinir')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  redefinir(@Body() dto: RedefinirSenhaEntregadorDto): Promise<void> {
    return this.entregadores.redefinirSenha(dto.token, dto.senha);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  entrar(@Body() dto: LoginEntregadorDto): Promise<SessaoEntregadorResposta> {
    return this.entregadores.entrar(dto);
  }
}

@Publico()
@UseGuards(EntregadorGuard)
@Controller('entregador')
export class EntregadorAppController {
  constructor(
    private readonly entregadores: EntregadoresService,
    private readonly creditos: CreditosService,
  ) {}

  @Get('eu')
  eu(@EntregadorAtual() e: { id: string }): Promise<PerfilEntregador> {
    return this.entregadores.perfil(e.id);
  }

  @Post('sair')
  @HttpCode(204)
  sair(@EntregadorAtual() e: { id: string; sessaoId: string }): Promise<void> {
    return this.entregadores.sair(e.id, e.sessaoId);
  }

  @Put('dados')
  dados(@EntregadorAtual() e: { id: string }, @Body() dto: DadosEntregadorDto): Promise<PerfilEntregador> {
    return this.entregadores.alterarDados(e.id, dto);
  }

  @Put('documentos/:tipo')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  documento(@EntregadorAtual() e: { id: string }, @Param('tipo') tipo: string, @Body() dto: ImagemDto): Promise<PerfilEntregador> {
    return this.entregadores.enviarDocumento(e.id, tipo, dto.imagem);
  }

  @Post('reenviar')
  @HttpCode(200)
  reenviar(@EntregadorAtual() e: { id: string }): Promise<PerfilEntregador> {
    return this.entregadores.reenviarParaAnalise(e.id);
  }

  @Post('online')
  @HttpCode(200)
  online(@EntregadorAtual() e: { id: string }, @Body() dto: PosicaoDto): Promise<RespostaPosicao> {
    return this.entregadores.posicao(e.id, dto, true);
  }

  @Post('posicao')
  @HttpCode(200)
  posicao(@EntregadorAtual() e: { id: string }, @Body() dto: PosicaoDto): Promise<RespostaPosicao> {
    return this.entregadores.posicao(e.id, dto, false);
  }

  @Post('offline')
  @HttpCode(204)
  offline(@EntregadorAtual() e: { id: string }): Promise<void> {
    return this.entregadores.ficarOffline(e.id);
  }

  @Get('creditos')
  meusCreditos(@EntregadorAtual() e: { id: string }): Promise<CreditosEntregador> {
    return this.creditos.doEntregador(e.id);
  }

  @Post('creditos/pedidos')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async pedir(@EntregadorAtual() e: { id: string }, @Body() dto: PedidoCreditoDto): Promise<PedidoCreditoResumo> {
    const perfil = await this.entregadores.perfil(e.id);
    if (perfil.situacao !== 'APROVADO') throw new ForbiddenException('A compra de créditos libera depois da aprovação do cadastro.');
    return this.creditos.pedir(e.id, dto.pacoteId);
  }

  @Post('creditos/pedidos/:id/pagamento')
  @HttpCode(200)
  pagamento(@EntregadorAtual() e: { id: string }, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PagamentoDto): Promise<PedidoCreditoResumo> {
    return this.creditos.informarPagamento(e.id, id, dto.comprovante ?? null);
  }

  @Delete('creditos/pedidos/:id')
  @HttpCode(204)
  cancelar(@EntregadorAtual() e: { id: string }, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.creditos.cancelar(e.id, id);
  }
}
