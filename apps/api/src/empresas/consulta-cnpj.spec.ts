import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConsultaCnpjService, PROVEDORES_CNPJ } from './consulta-cnpj';

const CNPJ = '11222333000181';

function resposta(status: number, corpo: unknown = {}) {
  return { status, ok: status >= 200 && status < 300, json: async () => corpo } as Response;
}

describe('ConsultaCnpjService', () => {
  const fetchOriginal = global.fetch;
  let chamadas: string[];

  function simular(porHost: Record<string, Response | Error>) {
    chamadas = [];
    global.fetch = jest.fn(async (url: string | URL | Request) => {
      const host = new URL(String(url)).host;
      chamadas.push(host);
      const r = porHost[host];
      if (!r) throw new Error(`host inesperado ${host}`);
      if (r instanceof Error) throw r;
      return r;
    }) as typeof fetch;
  }

  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  it('usa a BrasilAPI quando ela responde', async () => {
    simular({
      'brasilapi.com.br': resposta(200, {
        razao_social: 'ACME LTDA',
        nome_fantasia: '',
        descricao_situacao_cadastral: 'ATIVA',
        municipio: 'PORTO ALEGRE',
        uf: 'RS',
      }),
    });
    await expect(new ConsultaCnpjService().consultar(CNPJ)).resolves.toEqual({
      cnpj: CNPJ,
      razaoSocial: 'ACME LTDA',
      nomeFantasia: null,
      situacao: 'ATIVA',
      municipio: 'PORTO ALEGRE',
      uf: 'RS',
      fonte: 'BrasilAPI',
    });
    expect(chamadas).toEqual(['brasilapi.com.br']);
  });

  it('passa para o próximo provedor em falha ou limite de requisições', async () => {
    simular({
      'brasilapi.com.br': new Error('timeout'),
      'publica.cnpj.ws': resposta(429),
      'receitaws.com.br': resposta(200, { status: 'OK', nome: 'ACME LTDA', fantasia: 'ACME', situacao: 'ATIVA', municipio: 'X', uf: 'SP' }),
    });
    const dados = await new ConsultaCnpjService().consultar(CNPJ);
    expect(dados).toMatchObject({ razaoSocial: 'ACME LTDA', nomeFantasia: 'ACME', fonte: 'ReceitaWS' });
    expect(chamadas).toEqual(['brasilapi.com.br', 'publica.cnpj.ws', 'receitaws.com.br']);
  });

  it('lê o formato do CNPJ.ws', async () => {
    simular({
      'brasilapi.com.br': resposta(500),
      'publica.cnpj.ws': resposta(200, {
        razao_social: 'ACME LTDA',
        estabelecimento: { nome_fantasia: 'ACME', situacao_cadastral: 'Ativa', cidade: { nome: 'Canoas' }, estado: { sigla: 'RS' } },
      }),
    });
    await expect(new ConsultaCnpjService().consultar(CNPJ)).resolves.toMatchObject({
      nomeFantasia: 'ACME',
      municipio: 'Canoas',
      uf: 'RS',
      fonte: 'CNPJ.ws',
    });
  });

  it('responde 404 se um provedor diz que o CNPJ não existe e nenhum o encontra', async () => {
    simular({
      'brasilapi.com.br': resposta(404),
      'publica.cnpj.ws': resposta(429),
      'receitaws.com.br': resposta(200, { status: 'ERROR', message: 'CNPJ inválido' }),
    });
    await expect(new ConsultaCnpjService().consultar(CNPJ)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('responde 503 se todos os provedores falham', async () => {
    simular(Object.fromEntries(PROVEDORES_CNPJ.map((p) => [new URL(p.url(CNPJ)).host, resposta(503)])));
    await expect(new ConsultaCnpjService().consultar(CNPJ)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
