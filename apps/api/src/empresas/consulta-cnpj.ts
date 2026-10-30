import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { DadosCnpj } from '@etiquetas/shared';

type Dados = Omit<DadosCnpj, 'empresaExistenteId'>;
type Json = Record<string, any>;

/** Resposta de um provedor: dados, "não existe" ou falha (rede, limite de requisições, formato inesperado). */
type Resultado = { tipo: 'ok'; dados: Dados } | { tipo: 'inexistente' } | { tipo: 'falha'; motivo: string };

export interface Provedor {
  nome: string;
  url: (cnpj: string) => string;
  converter: (cnpj: string, json: Json) => Dados | null;
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Provedores gratuitos, sem chave, consultados em ordem até um responder.
 * Todos têm limite de requisições (ReceitaWS e CNPJ.ws: 3 por minuto), por isso há mais de um.
 */
export const PROVEDORES_CNPJ: Provedor[] = [
  {
    nome: 'BrasilAPI',
    url: (cnpj) => `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
    converter: (cnpj, j) =>
      texto(j.razao_social)
        ? {
            cnpj,
            razaoSocial: texto(j.razao_social)!,
            nomeFantasia: texto(j.nome_fantasia),
            situacao: texto(j.descricao_situacao_cadastral),
            municipio: texto(j.municipio),
            uf: texto(j.uf),
            fonte: 'BrasilAPI',
          }
        : null,
  },
  {
    nome: 'CNPJ.ws',
    url: (cnpj) => `https://publica.cnpj.ws/cnpj/${cnpj}`,
    converter: (cnpj, j) =>
      texto(j.razao_social)
        ? {
            cnpj,
            razaoSocial: texto(j.razao_social)!,
            nomeFantasia: texto(j.estabelecimento?.nome_fantasia),
            situacao: texto(j.estabelecimento?.situacao_cadastral),
            municipio: texto(j.estabelecimento?.cidade?.nome),
            uf: texto(j.estabelecimento?.estado?.sigla),
            fonte: 'CNPJ.ws',
          }
        : null,
  },
  {
    nome: 'ReceitaWS',
    url: (cnpj) => `https://receitaws.com.br/v1/cnpj/${cnpj}`,
    // Responde 200 com { status: "ERROR" } para CNPJ inexistente: tratado como "sem dados".
    converter: (cnpj, j) =>
      j.status !== 'ERROR' && texto(j.nome)
        ? {
            cnpj,
            razaoSocial: texto(j.nome)!,
            nomeFantasia: texto(j.fantasia),
            situacao: texto(j.situacao),
            municipio: texto(j.municipio),
            uf: texto(j.uf),
            fonte: 'ReceitaWS',
          }
        : null,
  },
];

const TEMPO_LIMITE_MS = 8000;

/** Busca razão social e nome fantasia pelo CNPJ em APIs públicas, para agilizar o cadastro de empresas. */
@Injectable()
export class ConsultaCnpjService {
  private readonly log = new Logger(ConsultaCnpjService.name);
  private readonly provedores = PROVEDORES_CNPJ;

  /** `cnpj` já normalizado e validado. CNPJ alfanumérico ainda não existe nessas bases e cai em "não encontrado". */
  async consultar(cnpj: string): Promise<Dados> {
    let algumDisseInexistente = false;
    for (const provedor of this.provedores) {
      const r = await this.consultarEm(provedor, cnpj);
      if (r.tipo === 'ok') return r.dados;
      if (r.tipo === 'inexistente') algumDisseInexistente = true;
      else this.log.warn(`Consulta de CNPJ em ${provedor.nome} falhou: ${r.motivo}`);
    }
    if (algumDisseInexistente) throw new NotFoundException('CNPJ não encontrado na Receita Federal.');
    throw new ServiceUnavailableException('A consulta de CNPJ está indisponível no momento. Preencha os dados à mão ou tente de novo em instantes.');
  }

  private async consultarEm(provedor: Provedor, cnpj: string): Promise<Resultado> {
    try {
      const resposta = await fetch(provedor.url(cnpj), {
        headers: { Accept: 'application/json', 'User-Agent': 'EtiquetasSaaS/1.0' },
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      });
      if (resposta.status === 404) return { tipo: 'inexistente' };
      if (!resposta.ok) return { tipo: 'falha', motivo: `HTTP ${resposta.status}` };
      const dados = provedor.converter(cnpj, (await resposta.json()) as Json);
      return dados ? { tipo: 'ok', dados } : { tipo: 'inexistente' };
    } catch (erro) {
      return { tipo: 'falha', motivo: erro instanceof Error ? erro.message : String(erro) };
    }
  }
}
