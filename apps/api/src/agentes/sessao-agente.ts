import { randomUUID } from 'node:crypto';
import type { DadosResposta, Mensagem } from './protocolo';

/** O mínimo do `ws.WebSocket` que a sessão usa (facilita os testes). */
export interface SocketAgente {
  readyState: number;
  send(dados: string): void;
  ping(): void;
  close(codigo?: number, motivo?: string): void;
}

const ABERTO = 1;

/** Erro devolvido pelo agente (ex.: falha de login no banco, SQL inválido). */
export class ErroDoAgente extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export class TempoEsgotadoAgente extends Error {}
export class AgenteDesconectado extends Error {
  /** true: a requisição já tinha sido enviada (o agente pode ter executado). */
  constructor(
    mensagem: string,
    readonly duranteOperacao = false,
  ) {
    super(mensagem);
  }
}

interface Pendente {
  resolver: (valor: unknown) => void;
  rejeitar: (erro: Error) => void;
  temporizador: NodeJS.Timeout;
}

/** Uma conexão WebSocket autenticada de um agente, com requisição/resposta por `id`. */
export class SessaoAgente {
  private readonly pendentes = new Map<string, Pendente>();
  vivo = true;

  constructor(
    readonly agenteId: string,
    readonly empresaId: string,
    private readonly socket: SocketAgente,
  ) {}

  enviar(mensagem: Mensagem) {
    if (this.socket.readyState !== ABERTO) throw new AgenteDesconectado('Agente desconectado.');
    this.socket.send(JSON.stringify(mensagem));
  }

  requisitar<T>(tipo: string, dados: unknown, tempoLimiteMs: number): Promise<T> {
    const id = randomUUID();
    return new Promise<T>((resolver, rejeitar) => {
      const temporizador = setTimeout(() => {
        this.pendentes.delete(id);
        rejeitar(new TempoEsgotadoAgente('O agente não respondeu a tempo.'));
      }, tempoLimiteMs);
      this.pendentes.set(id, { resolver: resolver as (v: unknown) => void, rejeitar, temporizador });
      try {
        this.enviar({ tipo, id, dados });
      } catch (erro) {
        clearTimeout(temporizador);
        this.pendentes.delete(id);
        rejeitar(erro as Error);
      }
    });
  }

  /** Entrega uma `resposta` à requisição correspondente. Respostas sem dono são ignoradas. */
  receberResposta(mensagem: Mensagem<DadosResposta>) {
    const pendente = mensagem.id ? this.pendentes.get(mensagem.id) : undefined;
    if (!pendente || !mensagem.dados) return;
    this.pendentes.delete(mensagem.id!);
    clearTimeout(pendente.temporizador);
    const dados = mensagem.dados;
    if (dados.ok) pendente.resolver(dados.resultado);
    else pendente.rejeitar(new ErroDoAgente(dados.erro?.codigo ?? 'erro', dados.erro?.mensagem ?? 'Erro no agente.'));
  }

  /** Falha todas as requisições em andamento (socket fechado). */
  encerrar() {
    for (const [id, pendente] of this.pendentes) {
      clearTimeout(pendente.temporizador);
      pendente.rejeitar(new AgenteDesconectado('O agente desconectou durante a operação.', true));
      this.pendentes.delete(id);
    }
  }

  /** Envia ping; `vivo` volta a true quando o pong chegar. */
  ping() {
    this.vivo = false;
    if (this.socket.readyState === ABERTO) this.socket.ping();
  }

  fechar(codigo: number, motivo: string) {
    this.encerrar();
    this.socket.close(codigo, motivo);
  }
}
