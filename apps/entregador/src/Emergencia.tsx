import { useState } from 'react';
import { Linking, View } from 'react-native';
import type { ChamadaEntregador } from '../../../packages/shared/src/entregas-chamadas';
import type { Api } from './api';
import { posicaoAtual } from './localizacao';
import { Alerta, Botao, Campo, Cartao } from './ui';

const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/**
 * Botão de emergência da chamada: avisa a empresa na hora (com a posição, se der) e oferece
 * ligar para o 190. Dois toques, para não disparar sem querer.
 */
export function Emergencia({ api, chamada, aoMudar }: { api: Api; chamada: ChamadaEntregador; aoMudar: (c: ChamadaEntregador) => void }) {
  const [confirmando, setConfirmando] = useState(false);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar() {
    setErro(null);
    setOcupado(true);
    try {
      // A posição ajuda, mas não pode atrasar o pedido de ajuda.
      const p = await Promise.race([posicaoAtual().catch(() => null), new Promise<null>((ok) => setTimeout(() => ok(null), 8000))]);
      aoMudar(await api<ChamadaEntregador>(`/entregador/chamadas/${chamada.id}/emergencia`, { metodo: 'POST', corpo: { lat: p?.coords.latitude ?? null, lon: p?.coords.longitude ?? null, texto } }));
      setConfirmando(false);
      setTexto('');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <View style={{ marginTop: 16, gap: 8 }}>
      {chamada.emergenciaEm && <Alerta>Pedido de ajuda enviado à empresa às {hora(chamada.emergenciaEm)}. Em perigo, ligue para o 190.</Alerta>}
      {confirmando ? (
        <Cartao>
          <Campo rotulo="O que está acontecendo? (opcional)" value={texto} onChangeText={setTexto} placeholder="Acidente, assalto, mal-estar…" />
          {erro && <Alerta>{erro}</Alerta>}
          <View style={{ gap: 8 }}>
            <Botao titulo="Confirmar emergência" variante="perigo" onPress={() => void enviar()} ocupado={ocupado} />
            <Botao titulo="Voltar" variante="secundario" onPress={() => setConfirmando(false)} />
          </View>
        </Cartao>
      ) : (
        <Botao titulo={chamada.emergenciaEm ? 'Pedir ajuda de novo' : 'Emergência'} variante="perigo" onPress={() => setConfirmando(true)} />
      )}
      <Botao titulo="Ligar 190 (Polícia)" variante="secundario" onPress={() => void Linking.openURL('tel:190')} />
    </View>
  );
}
