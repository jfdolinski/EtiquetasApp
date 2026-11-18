import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import type { ChamadaEntregador, SituacaoChamada } from '../../../packages/shared/src/entregas-chamadas';
import { ErroApi, type Api } from './api';
import { ROTULO_SITUACAO_CHAMADA } from './regras';

/**
 * Etapas da chamada feitas sem internet (chegada, coleta, entrega, com a foto). Ficam num arquivo do
 * aparelho e vão para a API, na ordem, quando a internet volta, com a hora em que aconteceram
 * (`em`). Ofertas, ocorrência e emergência continuam exigindo internet.
 */
export interface EtapaGuardada {
  chamadaId: string;
  corpo: Record<string, unknown> & { para: SituacaoChamada; em: string };
}

const ARQUIVO = 'etapas-sem-internet.json';
const CHAVE_WEB = `flow.entregador.${ARQUIVO}`;

export const semInternet = (e: unknown) => e instanceof ErroApi && e.status === 0;

export async function etapasGuardadas(): Promise<EtapaGuardada[]> {
  try {
    const texto = Platform.OS === 'web' ? localStorage.getItem(CHAVE_WEB) : (() => {
      const f = new File(Paths.document, ARQUIVO);
      return f.exists ? f.text() : null;
    })();
    const t = await texto;
    return t ? (JSON.parse(t) as EtapaGuardada[]) : [];
  } catch {
    return [];
  }
}

function gravar(lista: EtapaGuardada[]) {
  try {
    const texto = JSON.stringify(lista);
    if (Platform.OS === 'web') {
      if (lista.length) localStorage.setItem(CHAVE_WEB, texto);
      else localStorage.removeItem(CHAVE_WEB);
      return;
    }
    const f = new File(Paths.document, ARQUIVO);
    if (!lista.length) {
      if (f.exists) f.delete();
    } else f.write(texto);
  } catch {
    // Sem onde guardar: a etapa fica perdida e o entregador refaz quando a internet voltar.
  }
}

export async function guardarEtapa(e: EtapaGuardada): Promise<void> {
  gravar([...(await etapasGuardadas()), e]);
}

let enviando = false;

/**
 * Manda as guardadas, na ordem. Sem internet, para e tenta no próximo ciclo; recusada pela API
 * (código errado, longe do ponto), sai da fila e a mensagem volta para o entregador ver.
 */
export async function enviarGuardadas(api: Api): Promise<{ enviadas: number; recusas: string[] }> {
  if (enviando) return { enviadas: 0, recusas: [] };
  enviando = true;
  let enviadas = 0;
  const recusas: string[] = [];
  try {
    let lista = await etapasGuardadas();
    while (lista.length) {
      const [e, ...resto] = lista;
      try {
        await api<ChamadaEntregador>(`/entregador/chamadas/${e.chamadaId}/avancar`, { metodo: 'POST', corpo: e.corpo });
        enviadas++;
      } catch (erro) {
        if (semInternet(erro)) break;
        recusas.push(`"${ROTULO_SITUACAO_CHAMADA[e.corpo.para]}" não foi aceita: ${(erro as Error).message}`);
      }
      lista = resto;
      gravar(lista);
    }
  } finally {
    enviando = false;
  }
  return { enviadas, recusas };
}

/** O que a tela mostra enquanto a etapa espera a internet: o próximo passo, como se tivesse ido. */
export function aplicarLocal(c: ChamadaEntregador, para: SituacaoChamada): ChamadaEntregador {
  if (para === 'NA_COLETA' || para === 'NO_DESTINO') return { ...c, situacao: para, chegouNoPontoEm: new Date().toISOString() };
  if (para !== 'CONCLUIDA') return { ...c, situacao: para, chegouNoPontoEm: null };
  // Voltando à origem: entregar lá termina a chamada inteira.
  if (c.devolvendo) return { ...c, situacao: 'CONCLUIDA' };
  const destinos = c.destinos ?? [];
  const atual = c.paradaAtual ?? 0;
  if (atual < destinos.length - 1) {
    const proxima = atual + 1;
    return { ...c, situacao: 'COLETADA', paradaAtual: proxima, destino: destinos[proxima].parada, destinos: destinos.map((d) => (d.ordem === atual ? { ...d, entregue: true } : d)) };
  }
  return { ...c, situacao: 'CONCLUIDA' };
}
