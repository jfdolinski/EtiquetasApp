import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { OpcoesConexao } from '@etiquetas/shared';
import { type WebSocket, WebSocketServer } from 'ws';
import { empresaBloqueada } from '../auth/acesso-empresa';
import { config } from '../config';
import { decifrar, sha256 } from '../cripto';
import { PrismaService } from '../prisma/prisma.service';
import { CAMINHO_WS_AGENTE, type DadosConfiguracao, type DadosOla, type DadosResposta, type Mensagem } from './protocolo';
import { AgenteDesconectado, SessaoAgente } from './sessao-agente';

const INTERVALO_HEARTBEAT_MS = 30_000;
const TAMANHO_MAXIMO_MENSAGEM = 32 * 1024 * 1024;

/** Códigos de fechamento próprios (faixa 4000–4999 é livre para aplicações). */
export const FECHAMENTO = {
  SUBSTITUIDO: 4000,
  REVOGADO: 4001,
  BLOQUEADO: 4003,
} as const;

/** Resultado da autenticação do upgrade, separado do socket para poder testar. */
export type Autenticacao =
  | { ok: true; agenteId: string; empresaId: string }
  | { ok: false; status: 401 | 403; mensagem: string };

/**
 * Servidor WebSocket dos agentes, pendurado no mesmo servidor HTTP da API.
 * Cada agente tem no máximo uma sessão; uma conexão nova substitui a antiga.
 *
 * O mapa de sessões é em memória: com mais de uma réplica da API seria preciso
 * rotear as requisições para a réplica que segura o socket (ex.: Redis pub/sub).
 */
@Injectable()
export class AgentesGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Agentes');
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: TAMANHO_MAXIMO_MENSAGEM });
  private readonly sessoes = new Map<string, SessaoAgente>();
  private heartbeat?: NodeJS.Timeout;
  private readonly ouvintesConexao: ((agenteId: string) => void)[] = [];

  constructor(
    private readonly adaptador: HttpAdapterHost,
    private readonly prisma: PrismaService,
  ) {}

  onApplicationBootstrap() {
    const servidor = this.adaptador.httpAdapter?.getHttpServer();
    if (!servidor) return; // testes sem servidor HTTP
    servidor.on('upgrade', (req: IncomingMessage, socket: Duplex, cabeca: Buffer) => {
      const caminho = (req.url ?? '').split('?')[0];
      if (caminho !== CAMINHO_WS_AGENTE) {
        socket.destroy();
        return;
      }
      void this.aoPedirUpgrade(req, socket, cabeca);
    });
    this.heartbeat = setInterval(() => void this.verificarSessoes(), INTERVALO_HEARTBEAT_MS);
  }

  onModuleDestroy() {
    clearInterval(this.heartbeat);
    for (const sessao of this.sessoes.values()) sessao.fechar(1001, 'Servidor reiniciando.');
    this.wss.close();
  }

  /** Chamado sempre que um agente conecta (ex.: despachar trabalhos de impressão pendentes). */
  quandoConectar(ouvinte: (agenteId: string) => void) {
    this.ouvintesConexao.push(ouvinte);
  }

  estaOnline(agenteId: string): boolean {
    return this.sessoes.has(agenteId);
  }

  /** Sessão do agente, ou erro se estiver offline. */
  sessao(agenteId: string): SessaoAgente {
    const sessao = this.sessoes.get(agenteId);
    if (!sessao) throw new AgenteDesconectado('O agente está offline.');
    return sessao;
  }

  desconectar(agenteId: string, codigo: number, motivo: string) {
    this.sessoes.get(agenteId)?.fechar(codigo, motivo);
    this.sessoes.delete(agenteId);
  }

  /** Reenvia as conexões de banco ao agente, se estiver online. */
  async enviarConfiguracao(agenteId: string) {
    const sessao = this.sessoes.get(agenteId);
    if (!sessao) return;
    try {
      sessao.enviar({ tipo: 'configuracao', dados: await this.montarConfiguracao(agenteId) });
    } catch (erro) {
      this.log.warn(`Falha ao enviar configuração ao agente ${agenteId}: ${(erro as Error).message}`);
    }
  }

  async autenticar(cabecalhoAutorizacao: string | undefined): Promise<Autenticacao> {
    const [tipo, token] = (cabecalhoAutorizacao ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) return { ok: false, status: 401, mensagem: 'Token do agente ausente.' };

    const agente = await this.prisma.agente.findUnique({
      where: { tokenHash: sha256(token) },
      select: { id: true, empresaId: true, ativo: true, empresa: { select: { ativa: true, statusAssinatura: true } } },
    });
    if (!agente || !agente.ativo) return { ok: false, status: 401, mensagem: 'Token do agente inválido ou revogado.' };
    if (empresaBloqueada(agente.empresa)) return { ok: false, status: 403, mensagem: 'Empresa bloqueada.' };
    return { ok: true, agenteId: agente.id, empresaId: agente.empresaId };
  }

  async montarConfiguracao(agenteId: string): Promise<DadosConfiguracao> {
    const agente = await this.prisma.agente.findUniqueOrThrow({
      where: { id: agenteId },
      select: {
        nome: true,
        empresa: { select: { razaoSocial: true, nomeFantasia: true } },
        conexoes: { where: { ativo: true }, orderBy: { nome: 'asc' } },
      },
    });
    const chave = config().chaveCriptografia;
    return {
      agenteNome: agente.nome,
      empresaNome: agente.empresa.nomeFantasia || agente.empresa.razaoSocial,
      conexoes: agente.conexoes.map((c) => ({
        id: c.id,
        nome: c.nome,
        tipo: c.tipo,
        host: c.host,
        porta: c.porta,
        banco: c.banco,
        usuario: c.usuario,
        senha: c.senhaCifrada ? decifrar(c.senhaCifrada, chave) : '',
        opcoes: c.opcoes as OpcoesConexao,
      })),
    };
  }

  private async aoPedirUpgrade(req: IncomingMessage, socket: Duplex, cabeca: Buffer) {
    let auth: Autenticacao;
    try {
      auth = await this.autenticar(req.headers.authorization);
    } catch (erro) {
      this.log.error(`Erro ao autenticar agente: ${(erro as Error).message}`);
      return recusar(socket, 500, 'Erro interno.');
    }
    if (!auth.ok) return recusar(socket, auth.status, auth.mensagem);

    this.wss.handleUpgrade(req, socket, cabeca, (ws) => this.aoConectar(ws, auth.agenteId, auth.empresaId));
  }

  private aoConectar(ws: WebSocket, agenteId: string, empresaId: string) {
    const anterior = this.sessoes.get(agenteId);
    if (anterior) anterior.fechar(FECHAMENTO.SUBSTITUIDO, 'Outra instância deste agente conectou.');

    const sessao = new SessaoAgente(agenteId, empresaId, ws);
    this.sessoes.set(agenteId, sessao);
    this.log.log(`Agente ${agenteId} conectado.`);

    ws.on('pong', () => {
      sessao.vivo = true;
    });
    ws.on('message', (bruto) => void this.aoReceber(sessao, bruto.toString()));
    ws.on('close', () => {
      sessao.encerrar();
      // Só remove se ainda for a sessão atual (pode ter sido substituída).
      if (this.sessoes.get(agenteId) === sessao) {
        this.sessoes.delete(agenteId);
        this.log.log(`Agente ${agenteId} desconectado.`);
        void this.registrarContato(agenteId);
      }
    });
    ws.on('error', (erro) => this.log.warn(`Erro no socket do agente ${agenteId}: ${erro.message}`));

    void this.registrarContato(agenteId);
    void this.enviarConfiguracao(agenteId);
    for (const ouvinte of this.ouvintesConexao) ouvinte(agenteId);
  }

  private async aoReceber(sessao: SessaoAgente, texto: string) {
    let mensagem: Mensagem;
    try {
      mensagem = JSON.parse(texto) as Mensagem;
    } catch {
      return this.log.warn(`Mensagem inválida do agente ${sessao.agenteId}.`);
    }

    switch (mensagem.tipo) {
      case 'resposta':
        sessao.receberResposta(mensagem as Mensagem<DadosResposta>);
        break;
      case 'ola': {
        const dados = (mensagem.dados ?? {}) as Partial<DadosOla>;
        await this.prisma.agente.update({
          where: { id: sessao.agenteId },
          data: {
            versao: texto255(dados.versao),
            hostname: texto255(dados.hostname),
            sistemaOperacional: texto255(dados.sistemaOperacional),
            ultimoContatoEm: new Date(),
          },
        });
        break;
      }
      default:
        this.log.warn(`Tipo de mensagem desconhecido do agente ${sessao.agenteId}: ${mensagem.tipo}`);
    }
  }

  /**
   * A cada intervalo: derruba sessões que não responderam ao ping anterior e revalida
   * agente/empresa no banco (desativação ou bloqueio derrubam o agente em até 30 s).
   */
  private async verificarSessoes() {
    for (const [agenteId, sessao] of this.sessoes) {
      if (!sessao.vivo) {
        this.log.warn(`Agente ${agenteId} sem resposta ao heartbeat.`);
        this.desconectar(agenteId, 1001, 'Sem resposta ao heartbeat.');
        continue;
      }
      sessao.ping();

      const agente = await this.prisma.agente
        .update({
          where: { id: agenteId },
          data: { ultimoContatoEm: new Date() },
          select: { ativo: true, tokenHash: true, empresa: { select: { ativa: true, statusAssinatura: true } } },
        })
        .catch(() => null);
      if (!agente || !agente.ativo || !agente.tokenHash) {
        this.desconectar(agenteId, FECHAMENTO.REVOGADO, 'Agente desativado ou token revogado.');
      } else if (empresaBloqueada(agente.empresa)) {
        this.desconectar(agenteId, FECHAMENTO.BLOQUEADO, 'Empresa bloqueada.');
      }
    }
  }

  private async registrarContato(agenteId: string) {
    await this.prisma.agente
      .update({ where: { id: agenteId }, data: { ultimoContatoEm: new Date() } })
      .catch(() => undefined);
  }
}

function texto255(valor: unknown): string | undefined {
  return typeof valor === 'string' ? valor.slice(0, 255) : undefined;
}

function recusar(socket: Duplex, status: number, mensagem: string) {
  const corpo = JSON.stringify({ statusCode: status, message: mensagem });
  const titulo = status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Internal Server Error';
  socket.end(
    `HTTP/1.1 ${status} ${titulo}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(corpo)}\r\nConnection: close\r\n\r\n${corpo}`,
  );
}
