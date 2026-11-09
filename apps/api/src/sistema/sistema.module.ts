import { ArgumentsHost, Catch, Controller, Get, HttpException, Injectable, Logger, Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { APP_FILTER, BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import type { SaudeSistema } from '@etiquetas/shared';
import { AgentesModule } from '../agentes/agentes.module';
import { AgentesGateway } from '../agentes/agentes.gateway';
import { ApenasSuperAdmin } from '../auth/decorators';
import type { RequisicaoAutenticada } from '../auth/usuario-requisicao';
import { config } from '../config';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';

const DIA_MS = 86_400_000;
const LOTE_CONTEUDO = 200;
const RETENCAO_ERROS_DIAS = 30;
const RETENCAO_LISTAS_DIAS = 180;
const RETENCAO_FOTOS_TELA_DIAS = 60;
/** Pedido terminado há mais que isto perde os dados pessoais do cliente. */
const RETENCAO_DADOS_PEDIDO_DIAS = 180;
/** Sessões e links vencidos não servem para nada depois de um tempo. */
const RETENCAO_VENCIDOS_DIAS = 30;

export const CONTEUDO_APAGADO = new Uint8Array(0);

/** Erro inesperado (500) vira registro para a tela Saúde; a resposta ao cliente segue a padrão. */
@Catch()
export class FiltroErros extends BaseExceptionFilter {
  private readonly log = new Logger('Erros');

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  override catch(erro: unknown, host: ArgumentsHost) {
    if (host.getType() === 'http' && !(erro instanceof HttpException && erro.getStatus() < 500)) {
      const req = host.switchToHttp().getRequest<RequisicaoAutenticada & Request>();
      const e = erro as Error;
      this.log.error(`${req.method} ${req.path}: ${e?.message}`, e?.stack);
      // Sem corpo nem query: podem ter senha e dados do cliente.
      void this.prisma.erroSistema
        .create({
          data: {
            metodo: req.method,
            rota: req.path.slice(0, 300),
            mensagem: String(e?.message ?? erro).slice(0, 1000),
            pilha: e?.stack?.slice(0, 4000) ?? null,
            empresaId: req.usuario?.empresaId ?? null,
            usuarioId: req.usuario?.id ?? null,
          },
        })
        .catch(() => undefined);
    }
    super.catch(erro, host);
  }
}

export interface ResultadoManutencao {
  em: string;
  conteudos: number;
  auditoria: number;
  listas: number;
  erro?: string;
}

/** Faxina diária: sem ela, conteúdo dos trabalhos e auditoria só fazem o banco crescer. */
@Injectable()
export class ManutencaoService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Manutencao');
  private relogio?: NodeJS.Timeout;
  private inicio?: NodeJS.Timeout;
  ultima: ResultadoManutencao | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    this.inicio = setTimeout(() => void this.executar(), 10 * 60_000);
    this.relogio = setInterval(() => void this.executar(), DIA_MS);
    this.inicio.unref();
    this.relogio.unref();
  }

  onModuleDestroy() {
    clearTimeout(this.inicio);
    clearInterval(this.relogio);
  }

  async executar(agora = new Date()): Promise<ResultadoManutencao> {
    const antes = (dias: number) => new Date(agora.getTime() - dias * DIA_MS);
    const cfg = config();
    const r: ResultadoManutencao = { em: agora.toISOString(), conteudos: 0, auditoria: 0, listas: 0 };
    try {
      r.conteudos = await this.apagarConteudos(antes(cfg.retencaoConteudoDias), agora);
      r.auditoria = (await this.prisma.logAuditoria.deleteMany({ where: { criadoEm: { lt: antes(cfg.retencaoAuditoriaDias) } } })).count;
      r.listas = (await this.prisma.listaDiaria.deleteMany({ where: { data: { lt: antes(RETENCAO_LISTAS_DIAS) } } })).count;
      await this.prisma.erroSistema.deleteMany({ where: { criadoEm: { lt: antes(RETENCAO_ERROS_DIAS) } } });
      await this.prisma.sessaoUsuario.deleteMany({ where: { expiraEm: { lt: antes(RETENCAO_VENCIDOS_DIAS) } } });
      await this.prisma.redefinicaoSenha.deleteMany({ where: { expiraEm: { lt: antes(RETENCAO_VENCIDOS_DIAS) } } });
      await this.prisma.codigoVinculoApp.deleteMany({ where: { expiraEm: { lt: antes(RETENCAO_VENCIDOS_DIAS) } } });
      await this.prisma.pedidoVinculoTela.deleteMany({ where: { expiraEm: { lt: antes(RETENCAO_VENCIDOS_DIAS) } } });
      await this.prisma.quedaTela.deleteMany({ where: { fim: { lt: antes(RETENCAO_LISTAS_DIAS) } } });
      // Foto em uso é conferida todo mês: parada há dois meses, nenhum conteúdo a pede mais.
      await this.prisma.fotoProdutoTela.deleteMany({ where: { verificadoEm: { lt: antes(RETENCAO_FOTOS_TELA_DIAS) } } });
      // Pedido terminado guarda número e valores; nome, telefone, endereço e observação do cliente saem (LGPD).
      await this.prisma.pedido.updateMany({
        where: { situacao: { in: ['CONCLUIDO', 'CANCELADO'] }, atualizadoEm: { lt: antes(RETENCAO_DADOS_PEDIDO_DIAS) }, clienteTelefone: { not: '' } },
        data: { clienteNome: 'Dados apagados', clienteTelefone: '', endereco: Prisma.DbNull, observacao: '' },
      });
      this.log.log(`Faxina: ${r.conteudos} conteúdo(s), ${r.auditoria} registro(s) de auditoria, ${r.listas} lista(s).`);
    } catch (e) {
      r.erro = (e as Error).message;
      this.log.error(`Faxina: ${r.erro}`);
    }
    this.ultima = r;
    return r;
  }

  /** O histórico fica; só os bytes saem. Só de trabalho terminado, em lotes para não travar o banco. */
  private async apagarConteudos(limite: Date, agora: Date): Promise<number> {
    let total = 0;
    for (;;) {
      const lote = await this.prisma.trabalhoImpressao.findMany({
        where: { criadoEm: { lt: limite }, conteudoApagadoEm: null, status: { in: ['CONCLUIDO', 'CANCELADO', 'ERRO'] } },
        select: { id: true },
        take: LOTE_CONTEUDO,
      });
      if (lote.length === 0) return total;
      const { count } = await this.prisma.trabalhoImpressao.updateMany({ where: { id: { in: lote.map((t) => t.id) } }, data: { conteudo: CONTEUDO_APAGADO, conteudoApagadoEm: agora } });
      total += count;
    }
  }
}

@Controller('sistema')
export class SistemaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly manutencao: ManutencaoService,
    private readonly gateway: AgentesGateway,
    private readonly email: EmailService,
  ) {}

  @Get('saude')
  @ApenasSuperAdmin()
  async saude(): Promise<SaudeSistema> {
    const dia = new Date(Date.now() - DIA_MS);
    const [banco, tabelas, erros24h, erros, fila, agentes] = await Promise.all([
      this.prisma.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database()) AS bytes`,
      this.prisma.$queryRaw<{ nome: string; bytes: bigint }[]>`
        SELECT c.relname AS nome, pg_total_relation_size(c.oid) AS bytes
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = current_schema()
        ORDER BY bytes DESC LIMIT 8`,
      this.prisma.erroSistema.count({ where: { criadoEm: { gte: dia } } }),
      this.prisma.erroSistema.findMany({ orderBy: { criadoEm: 'desc' }, take: 30, select: { id: true, metodo: true, rota: true, mensagem: true, criadoEm: true } }),
      this.prisma.trabalhoImpressao.count({ where: { status: { in: ['PENDENTE', 'ENVIANDO'] } } }),
      this.prisma.agente.findMany({ where: { ativo: true, tokenHash: { not: null } }, select: { id: true } }),
    ]);
    const cfg = config();
    return {
      agora: new Date().toISOString(),
      noArHaSegundos: Math.round(process.uptime()),
      memoriaMb: Math.round(process.memoryUsage().rss / 1_048_576),
      bancoBytes: Number(banco[0].bytes),
      tabelas: tabelas.map((t) => ({ nome: t.nome, bytes: Number(t.bytes) })),
      erros24h,
      erros: erros.map((e) => ({ ...e, criadoEm: e.criadoEm.toISOString() })),
      filaImpressao: fila,
      agentes: { ativados: agentes.length, online: agentes.filter((a) => this.gateway.estaOnline(a.id)).length },
      emailConfigurado: this.email.disponivel,
      pushConfigurado: cfg.fcm !== null,
      retencao: { conteudoDias: cfg.retencaoConteudoDias, auditoriaDias: cfg.retencaoAuditoriaDias },
      ultimaFaxina: this.manutencao.ultima,
    };
  }
}

@Module({
  imports: [AgentesModule],
  controllers: [SistemaController],
  providers: [ManutencaoService, { provide: APP_FILTER, useClass: FiltroErros }],
})
export class SistemaModule {}
