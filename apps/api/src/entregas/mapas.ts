import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigMapa, Ponto, ResultadoEndereco } from '@etiquetas/shared';
import { coordenadaValida, rotaEstimada } from '@etiquetas/shared';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Tudo o que as entregas pedem a um serviço de mapas. Hoje OpenStreetMap; trocar pelo Google
 * é outra implementação desta interface, sem mexer nas regras.
 */
export interface ProvedorMapas {
  geocodificar(texto: string): Promise<ResultadoEndereco[]>;
  /** Distância e tempo pela rua; `estimada` quando veio da linha reta. */
  rota(de: Ponto, para: Ponto): Promise<Rota>;
  configuracaoDoMapa(): ConfigMapa;
}

export interface Rota {
  metros: number;
  segundos: number;
  estimada: boolean;
}

/** O Nominatim público aceita no máximo uma requisição por segundo. */
const INTERVALO_MINIMO_MS = 1100;
const TEMPO_LIMITE_MS = 8000;
/** Endereço guardado há mais que isso é perguntado de novo. */
const VALIDADE_CACHE_MS = 90 * 86_400_000;

export function chaveDoEndereco(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface RespostaNominatim {
  lat?: string;
  lon?: string;
  display_name?: string;
}

@Injectable()
export class MapasService implements ProvedorMapas {
  private readonly log = new Logger('Mapas');
  /** Fila: uma busca por vez, com intervalo entre elas. */
  private fila: Promise<unknown> = Promise.resolve();
  private ultimaEm = 0;

  constructor(private readonly prisma: PrismaService) {}

  configuracaoDoMapa(): ConfigMapa {
    const m = config().mapas;
    return { blocos: m.blocos, atribuicao: m.atribuicao, zoomMaximo: 19 };
  }

  async geocodificar(texto: string): Promise<ResultadoEndereco[]> {
    const chave = chaveDoEndereco(texto);
    if (chave.length < 4) return [];
    const guardado = await this.prisma.cacheGeocodificacao.findUnique({ where: { chave } });
    if (guardado && Date.now() - guardado.criadoEm.getTime() < VALIDADE_CACHE_MS) return guardado.resultados as unknown as ResultadoEndereco[];

    const resultados = await this.naFila(() => this.buscar(texto));
    await this.prisma.cacheGeocodificacao.upsert({
      where: { chave },
      create: { chave, resultados: resultados as never },
      update: { resultados: resultados as never, criadoEm: new Date() },
    });
    return resultados;
  }

  async rota(de: Ponto, para: Ponto): Promise<Rota> {
    const osrm = config().mapas.osrmUrl;
    if (osrm) {
      try {
        const r = await fetch(`${osrm}/route/v1/driving/${de.lon},${de.lat};${para.lon},${para.lat}?overview=false`, { signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
        const j = (await r.json()) as { code?: string; routes?: { distance: number; duration: number }[] };
        const melhor = j.routes?.[0];
        if (r.ok && j.code === 'Ok' && melhor) return { metros: Math.round(melhor.distance), segundos: Math.round(melhor.duration), estimada: false };
        this.log.warn(`Rota respondeu ${r.status} ${j.code ?? ''}`);
      } catch (e) {
        this.log.warn(`Rota falhou: ${(e as Error).message}`);
      }
    }
    return { ...rotaEstimada(de, para), estimada: true };
  }

  /** Soma dos trechos, na ordem (sem reordenar as paradas). Estimada se algum trecho foi. */
  async rotaPorPontos(pontos: Ponto[]): Promise<Rota> {
    let total: Rota = { metros: 0, segundos: 0, estimada: false };
    for (let i = 1; i < pontos.length; i++) {
      const r = await this.rota(pontos[i - 1], pontos[i]);
      total = { metros: total.metros + r.metros, segundos: total.segundos + r.segundos, estimada: total.estimada || r.estimada };
    }
    return total;
  }

  private naFila<T>(f: () => Promise<T>): Promise<T> {
    const vez = this.fila.then(async () => {
      const espera = this.ultimaEm + INTERVALO_MINIMO_MS - Date.now();
      if (espera > 0) await new Promise((r) => setTimeout(r, espera));
      try {
        return await f();
      } finally {
        this.ultimaEm = Date.now();
      }
    });
    this.fila = vez.catch(() => undefined);
    return vez;
  }

  private async buscar(texto: string): Promise<ResultadoEndereco[]> {
    const m = config().mapas;
    const url = `${m.nominatimUrl}/search?${new URLSearchParams({ format: 'jsonv2', q: texto, countrycodes: 'br', limit: '5', 'accept-language': 'pt-BR' })}`;
    let resposta: Response;
    try {
      resposta = await fetch(url, { headers: { 'User-Agent': m.agenteUsuario, Accept: 'application/json' }, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
    } catch (e) {
      this.log.warn(`Busca de endereço falhou: ${(e as Error).message}`);
      throw new ServiceUnavailableException('A busca de endereço está fora do ar. Marque o ponto clicando no mapa.');
    }
    if (!resposta.ok) {
      this.log.warn(`Busca de endereço respondeu ${resposta.status}`);
      throw new ServiceUnavailableException('A busca de endereço está fora do ar. Marque o ponto clicando no mapa.');
    }
    const lista = (await resposta.json().catch(() => [])) as RespostaNominatim[];
    return (Array.isArray(lista) ? lista : [])
      .map((r) => ({ lat: Number(r.lat), lon: Number(r.lon), endereco: String(r.display_name ?? '').slice(0, 300) }))
      .filter((r) => coordenadaValida(r) && r.endereco);
  }
}
