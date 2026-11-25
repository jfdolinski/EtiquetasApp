import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PerfilEntregador, RespostaPosicao } from '../../../packages/shared/src/entregas';
import type { Api } from './api';
import type { ChamadaEntregador } from '../../../packages/shared/src/entregas-chamadas';
import { PegarNoBalcao } from './Balcao';
import { prepararNotificacoes } from './avisos';
import { aoReceberResposta, enviarPosicao, iniciarRastreio, pararRastreio, pedirPermissoes, posicaoAtual, rastreando, type ProblemaPermissao } from './localizacao';
import { Alerta, Botao, cores, Numero } from './ui';

const AVISO: Record<NonNullable<RespostaPosicao['aviso']>, string> = {
  SEM_CREDITO: 'Você ficou sem diárias. Compre créditos na guia Créditos para ficar online.',
  GPS_FALSO: 'Detectamos um aplicativo de localização falsa. Desligue-o para continuar online.',
  NAO_APROVADO: 'Seu cadastro não está liberado para ficar online.',
};

const PERMISSAO: Record<NonNullable<ProblemaPermissao>, string> = {
  GPS_DESLIGADO: 'A localização do celular está desligada. Ligue o GPS e tente de novo.',
  NEGADA: 'Sem permissão de localização não dá para ficar online. Permita nas configurações do aplicativo.',
  SEM_SEGUNDO_PLANO: 'Para continuar online com a tela apagada, permita a localização "o tempo todo" nas configurações do aplicativo.',
};

export function TelaInicio({ api, perfil, aoMudar, irParaCreditos, oferta, irParaAvisos, aoPegar }: { api: Api; perfil: PerfilEntregador; aoMudar: (p: PerfilEntregador) => void; irParaCreditos: () => void; oferta?: ReactNode; irParaAvisos?: () => void; aoPegar?: (c: ChamadaEntregador) => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [permissao, setPermissao] = useState<ProblemaPermissao>(null);
  const [ultimoEnvio, setUltimoEnvio] = useState<Date | null>(null);

  // O servidor diz que está online mas o rastreio parou (app reiniciado, celular religado): retoma.
  useEffect(() => {
    if (!perfil.online) return;
    void rastreando().then(async (ativo) => {
      if (!ativo) {
        const p = await pedirPermissoes();
        if (p === 'NEGADA' || p === 'GPS_DESLIGADO') return setPermissao(p);
        await iniciarRastreio().catch((e: Error) => setAviso(e.message));
      }
    });
  }, [perfil.online]);

  useEffect(
    () =>
      aoReceberResposta((r) => {
        if ('erro' in r) return;
        setUltimoEnvio(new Date());
        if (r.aviso) setAviso(AVISO[r.aviso]);
        if (r.online !== perfil.online || r.saldoDiarias !== perfil.saldoDiarias) aoMudar({ ...perfil, online: r.online, saldoDiarias: r.saldoDiarias });
      }),
    [perfil, aoMudar],
  );

  async function ficarOnline() {
    setAviso(null);
    setPermissao(null);
    setOcupado(true);
    try {
      const p = await pedirPermissoes();
      setPermissao(p);
      // Sem a permissão de notificação, a oferta só aparece com o app aberto.
      await prepararNotificacoes().catch(() => false);
      if (p === 'NEGADA' || p === 'GPS_DESLIGADO') return;
      const r = await enviarPosicao(await posicaoAtual(), true);
      if (r.aviso) setAviso(AVISO[r.aviso]);
      if (r.online) {
        setUltimoEnvio(new Date());
        await iniciarRastreio();
      }
      aoMudar(await api<PerfilEntregador>('/entregador/eu'));
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function ficarOffline() {
    setOcupado(true);
    try {
      await pararRastreio();
      await api('/entregador/offline', { metodo: 'POST' });
      aoMudar({ ...perfil, online: false });
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const semDiaria = !perfil.diariaHoje && perfil.saldoDiarias === 0;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <View style={[estilos.status, { backgroundColor: perfil.online ? cores.okFundo : cores.fundo, borderColor: perfil.online ? '#86efac' : cores.borda }]}>
        <Text style={[estilos.statusTitulo, { color: perfil.online ? cores.ok : cores.texto }]}>{perfil.online ? 'Você está online' : 'Você está offline'}</Text>
        <Text style={{ color: cores.suave, textAlign: 'center' }}>
          {perfil.online ? 'As empresas por perto veem que há um entregador disponível.' : 'Fique online para aparecer para as empresas e receber chamadas.'}
        </Text>
        {perfil.online && ultimoEnvio && <Text style={estilos.envio}>Última localização enviada às {ultimoEnvio.toLocaleTimeString('pt-BR')}</Text>}
      </View>

      {oferta}
      {perfil.online && aoPegar && <PegarNoBalcao api={api} aoPegar={aoPegar} />}
      {aviso && <Alerta tipo="aviso">{aviso}</Alerta>}
      {/* Só o recado curto: o ajuste em si fica na guia Avisos. */}
      {permissao && <Alerta tipo="aviso">{PERMISSAO[permissao]}</Alerta>}
      {permissao && irParaAvisos && (
        <View style={{ marginBottom: 12 }}>
          <Botao titulo="Ver em Avisos" variante="secundario" onPress={irParaAvisos} />
        </View>
      )}

      {perfil.online ? (
        <Botao titulo="Ficar offline" variante="perigo" onPress={() => void ficarOffline()} ocupado={ocupado} />
      ) : semDiaria ? (
        <>
          <Alerta tipo="aviso">Compre créditos para ficar online. Cada dia em que você fica online usa uma diária.</Alerta>
          <Botao titulo="Comprar créditos" onPress={irParaCreditos} />
        </>
      ) : (
        <Botao titulo="Ficar online" onPress={() => void ficarOnline()} ocupado={ocupado} />
      )}

      <View style={estilos.numeros}>
        <Numero rotulo="Diárias disponíveis" valor={perfil.saldoDiarias} alerta={perfil.saldoDiarias === 0} />
        <Numero rotulo="Diária de hoje" valor={perfil.diariaHoje ? 'Paga' : 'Não usada'} detalhe={perfil.diariaHoje ? 'Fique online à vontade hoje.' : 'É descontada ao ficar online.'} />
      </View>

    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  status: { borderWidth: 1, borderRadius: 12, padding: 20, alignItems: 'center', marginBottom: 16, gap: 6 },
  statusTitulo: { fontSize: 22, fontWeight: '800' },
  envio: { fontSize: 12, color: cores.suave, marginTop: 4 },
  numeros: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 16 },
});
