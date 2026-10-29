import { AgenteDesconectado, ErroDoAgente, SessaoAgente, type SocketAgente, TempoEsgotadoAgente } from './sessao-agente';

function socketFalso(): SocketAgente & { enviados: { tipo: string; id: string; dados: unknown }[] } {
  const enviados: { tipo: string; id: string; dados: unknown }[] = [];
  return {
    readyState: 1,
    enviados,
    send: (texto: string) => void enviados.push(JSON.parse(texto)),
    ping: jest.fn(),
    close: jest.fn(),
  };
}

describe('SessaoAgente', () => {
  it('casa a resposta com a requisição pelo id', async () => {
    const socket = socketFalso();
    const sessao = new SessaoAgente('a1', 'e1', socket);
    const promessa = sessao.requisitar<{ linhas: number }>('consultar', { sql: 'select 1' }, 1000);
    const { id, tipo } = socket.enviados[0];
    expect(tipo).toBe('consultar');

    sessao.receberResposta({ tipo: 'resposta', id: 'outro-id', dados: { ok: true, resultado: { linhas: 99 } } });
    sessao.receberResposta({ tipo: 'resposta', id, dados: { ok: true, resultado: { linhas: 1 } } });
    await expect(promessa).resolves.toEqual({ linhas: 1 });
  });

  it('propaga o erro devolvido pelo agente', async () => {
    const socket = socketFalso();
    const sessao = new SessaoAgente('a1', 'e1', socket);
    const promessa = sessao.requisitar('consultar', {}, 1000);
    sessao.receberResposta({
      tipo: 'resposta',
      id: socket.enviados[0].id,
      dados: { ok: false, erro: { codigo: 'sql', mensagem: 'relation "x" does not exist' } },
    });
    await expect(promessa).rejects.toThrow(ErroDoAgente);
    await expect(promessa).rejects.toThrow('relation "x" does not exist');
  });

  it('esgota o tempo quando o agente não responde', async () => {
    jest.useFakeTimers();
    try {
      const sessao = new SessaoAgente('a1', 'e1', socketFalso());
      const promessa = sessao.requisitar('consultar', {}, 500);
      jest.advanceTimersByTime(501);
      await expect(promessa).rejects.toThrow(TempoEsgotadoAgente);
    } finally {
      jest.useRealTimers();
    }
  });

  it('falha requisições pendentes quando o socket fecha', async () => {
    const sessao = new SessaoAgente('a1', 'e1', socketFalso());
    const promessa = sessao.requisitar('consultar', {}, 1000);
    sessao.encerrar();
    await expect(promessa).rejects.toThrow(AgenteDesconectado);
  });

  it('não envia por socket fechado', async () => {
    const socket = socketFalso();
    socket.readyState = 3;
    const sessao = new SessaoAgente('a1', 'e1', socket);
    await expect(sessao.requisitar('consultar', {}, 1000)).rejects.toThrow(AgenteDesconectado);
  });
});
