import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

export interface DadosCep {
  cep: string;
  rua: string;
  bairro: string;
  cidade: string;
  uf: string;
}

type Json = Record<string, unknown>;
type Resultado = { tipo: 'ok'; dados: DadosCep } | { tipo: 'inexistente' } | { tipo: 'falha'; motivo: string };

export interface ProvedorCep {
  nome: string;
  url: (cep: string) => string;
  /** Nulo: o provedor disse que o CEP não existe. */
  converter: (cep: string, json: Json) => DadosCep | null;
}

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Gratuitos e sem chave, em ordem: o segundo só é chamado se o primeiro falhar. */
export const PROVEDORES_CEP: ProvedorCep[] = [
  {
    nome: 'ViaCEP',
    url: (cep) => `https://viacep.com.br/ws/${cep}/json/`,
    // O ViaCEP responde 200 com {"erro": true} para CEP que não existe.
    converter: (cep, j) => (j.erro ? null : { cep, rua: texto(j.logradouro), bairro: texto(j.bairro), cidade: texto(j.localidade), uf: texto(j.uf) }),
  },
  {
    nome: 'BrasilAPI',
    url: (cep) => `https://brasilapi.com.br/api/cep/v1/${cep}`,
    converter: (cep, j) => (texto(j.city) ? { cep, rua: texto(j.street), bairro: texto(j.neighborhood), cidade: texto(j.city), uf: texto(j.state) } : null),
  },
];

const TEMPO_LIMITE_MS = 6000;
const GUARDAR_MS = 24 * 3600_000;
const MAX_GUARDADOS = 5000;

/**
 * Busca de endereço pelo CEP, feita pela API e não pelo navegador do cliente: a página não precisa
 * liberar outros endereços e o limite de consultas fica do nosso lado. CEP de cidade pequena pode
 * vir sem rua e sem bairro: o cliente completa.
 */
@Injectable()
export class CepService {
  private readonly log = new Logger(CepService.name);
  private readonly guardados = new Map<string, { dados: DadosCep | null; em: number }>();
  provedores = PROVEDORES_CEP;

  /** `cep` já normalizado (8 dígitos). */
  async consultar(cep: string): Promise<DadosCep> {
    const guardado = this.guardados.get(cep);
    if (guardado && Date.now() - guardado.em < GUARDAR_MS) {
      if (!guardado.dados) throw new NotFoundException('CEP não encontrado. Confira ou preencha o endereço à mão.');
      return guardado.dados;
    }
    let inexistente = false;
    for (const p of this.provedores) {
      const r = await this.consultarEm(p, cep);
      if (r.tipo === 'ok') {
        this.guardar(cep, r.dados);
        return r.dados;
      }
      if (r.tipo === 'inexistente') inexistente = true;
      else this.log.warn(`CEP em ${p.nome}: ${r.motivo}`);
    }
    if (inexistente) {
      this.guardar(cep, null);
      throw new NotFoundException('CEP não encontrado. Confira ou preencha o endereço à mão.');
    }
    throw new ServiceUnavailableException('A busca de CEP está fora do ar. Preencha o endereço à mão.');
  }

  private guardar(cep: string, dados: DadosCep | null) {
    if (this.guardados.size >= MAX_GUARDADOS) this.guardados.delete(this.guardados.keys().next().value!);
    this.guardados.set(cep, { dados, em: Date.now() });
  }

  private async consultarEm(p: ProvedorCep, cep: string): Promise<Resultado> {
    try {
      const r = await fetch(p.url(cep), { headers: { Accept: 'application/json', 'User-Agent': 'EtiquetasSaaS/1.0' }, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
      if (r.status === 404 || r.status === 400) return { tipo: 'inexistente' };
      if (!r.ok) return { tipo: 'falha', motivo: `HTTP ${r.status}` };
      const dados = p.converter(cep, (await r.json()) as Json);
      return dados ? { tipo: 'ok', dados } : { tipo: 'inexistente' };
    } catch (e) {
      return { tipo: 'falha', motivo: e instanceof Error ? e.message : String(e) };
    }
  }
}
