import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, ScrollView, Text, View } from 'react-native';
import type { PerfilEntregador } from '../../../packages/shared/src/entregas';
import { notificacoesPermitidas, prepararNotificacoes } from './avisos';
import { guiaJaVisto, marcarGuiaVisto } from './Bateria';
import { pedirPermissoes, situacaoPermissoes, type ProblemaPermissao } from './localizacao';
import { Botao, Cartao, cores, Texto, Titulo } from './ui';

/**
 * Guia Avisos: tudo o que falta ajustar no celular ou na conta, num lugar só, para o Início ficar só
 * com o trabalho (online, oferta, diárias). Cada item diz o que é, por que importa e tem o botão.
 */
export type IdPendencia = 'VERSAO' | 'LOCALIZACAO' | 'NOTIFICACOES' | 'BATERIA' | 'DIARIAS' | 'AVARIAS';

export interface Situacao {
  localizacao: ProblemaPermissao;
  notificacoes: boolean | null;
  bateriaVista: boolean;
}

const INTERVALO_CONFERENCIA_MS = 30_000;

/** Confere as permissões e o guia da bateria ao abrir, ao voltar para o app e a cada 30 s. */
export function useSituacaoDoCelular(): [Situacao | null, () => void] {
  const [s, setS] = useState<Situacao | null>(null);
  const conferir = useCallback(() => {
    void Promise.all([situacaoPermissoes(), notificacoesPermitidas(), guiaJaVisto()]).then(([localizacao, notificacoes, bateriaVista]) => setS({ localizacao, notificacoes, bateriaVista }));
  }, []);
  useEffect(() => {
    conferir();
    const t = setInterval(conferir, INTERVALO_CONFERENCIA_MS);
    const a = AppState.addEventListener('change', (estado) => estado === 'active' && conferir());
    return () => {
      clearInterval(t);
      a.remove();
    };
  }, [conferir]);
  return [s, conferir];
}

/** O que está pendente agora, na ordem de importância. */
export function pendencias(s: Situacao | null, perfil: PerfilEntregador, versaoNova: string | null): IdPendencia[] {
  const lista: IdPendencia[] = [];
  if (versaoNova) lista.push('VERSAO');
  if (s?.localizacao) lista.push('LOCALIZACAO');
  if (s?.notificacoes === false) lista.push('NOTIFICACOES');
  if (s && !s.bateriaVista) lista.push('BATERIA');
  if (!perfil.diariaHoje && perfil.saldoDiarias === 0) lista.push('DIARIAS');
  if ((perfil.avariasPendentes ?? 0) > 0) lista.push('AVARIAS');
  return lista;
}

const LOCALIZACAO: Record<NonNullable<ProblemaPermissao>, string> = {
  GPS_DESLIGADO: 'A localização (GPS) do celular está desligada.',
  NEGADA: 'O app não tem permissão de localização: sem ela, não dá para ficar online.',
  SEM_SEGUNDO_PLANO: 'Falta permitir a localização "o tempo todo": sem isso, você some do mapa quando a tela apaga.',
};

function Item({ titulo, texto, pendente, children }: { titulo: string; texto: string; pendente: boolean; children?: React.ReactNode }) {
  return (
    <Cartao>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }} accessibilityLabel={`${titulo}: ${pendente ? 'pendente' : 'tudo certo'}`}>
        <Text style={{ fontSize: 16, color: pendente ? cores.aviso : cores.ok }}>{pendente ? '●' : '✓'}</Text>
        <Text style={{ fontWeight: '700', color: cores.texto, flex: 1 }}>{titulo}</Text>
        <Text style={{ fontSize: 12, color: pendente ? cores.aviso : cores.ok }}>{pendente ? 'Pendente' : 'Tudo certo'}</Text>
      </View>
      <Texto suave>{texto}</Texto>
      {pendente && children ? <View style={{ marginTop: 8, gap: 8 }}>{children}</View> : null}
    </Cartao>
  );
}

export function TelaAvisos({
  situacao,
  conferir,
  perfil,
  versaoNova,
  baixarVersao,
  abrirGuia,
  irParaCreditos,
  abrirTermo,
  irParaExtrato,
}: {
  situacao: Situacao | null;
  conferir: () => void;
  perfil: PerfilEntregador;
  versaoNova: string | null;
  baixarVersao: () => void;
  abrirGuia: () => void;
  irParaCreditos: () => void;
  abrirTermo?: () => void;
  irParaExtrato?: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const lista = pendencias(situacao, perfil, versaoNova);

  async function permitirLocalizacao() {
    setOcupado(true);
    try {
      const p = await pedirPermissoes();
      // Recusada antes, o Android não pergunta de novo: só pelas configurações.
      if (p && Platform.OS !== 'web') await Linking.openSettings().catch(() => undefined);
    } finally {
      setOcupado(false);
      conferir();
    }
  }

  async function permitirNotificacoes() {
    setOcupado(true);
    try {
      if (!(await prepararNotificacoes().catch(() => false))) await Linking.openSettings().catch(() => undefined);
    } finally {
      setOcupado(false);
      conferir();
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Titulo>Avisos e ajustes</Titulo>
      <Texto suave>{lista.length ? `${lista.length === 1 ? 'Falta 1 ajuste' : `Faltam ${lista.length} ajustes`} para o app funcionar direito.` : 'Tudo certo: nada pendente.'}</Texto>
      <View style={{ height: 12 }} />

      {(perfil.avariasPendentes ?? 0) > 0 && (
        <Item titulo="Avaria esperando sua resposta" texto={`Uma empresa registrou ${perfil.avariasPendentes === 1 ? 'uma avaria' : `${perfil.avariasPendentes} avarias`} com desconto. Aceite ou conte por que não concorda.`} pendente>
          {irParaExtrato && <Botao titulo="Ver no Extrato" onPress={irParaExtrato} />}
        </Item>
      )}
      {versaoNova && (
        <Item titulo="Versão nova do app" texto={`A versão ${versaoNova} já está disponível. Baixe e instale por cima desta.`} pendente>
          <Botao titulo="Baixar a versão nova" onPress={baixarVersao} />
        </Item>
      )}
      <Item titulo="Localização" texto={situacao?.localizacao ? LOCALIZACAO[situacao.localizacao] : 'Liberada, inclusive com a tela apagada.'} pendente={!!situacao?.localizacao}>
        {situacao?.localizacao === 'GPS_DESLIGADO' ? (
          Platform.OS !== 'web' && <Botao titulo="Abrir as configurações" onPress={() => void Linking.openSettings()} />
        ) : (
          <Botao titulo="Permitir a localização" onPress={() => void permitirLocalizacao()} ocupado={ocupado} />
        )}
      </Item>
      {situacao?.notificacoes !== null && (
        <Item titulo="Notificações" texto={situacao?.notificacoes === false ? 'Sem notificações, a oferta de chamada só aparece com o app aberto na tela.' : 'Liberadas: a oferta toca mesmo com o celular bloqueado.'} pendente={situacao?.notificacoes === false}>
          <Botao titulo="Permitir as notificações" onPress={() => void permitirNotificacoes()} ocupado={ocupado} />
        </Item>
      )}
      <Item titulo="Bateria" texto={situacao && !situacao.bateriaVista ? 'Alguns celulares fecham o app com a tela apagada para economizar bateria, e você deixa de receber ofertas.' : 'Você já ajustou a bateria. Se o app parar de avisar, veja o guia de novo.'} pendente={!!situacao && !situacao.bateriaVista}>
        <Botao titulo="Ver como fazer" onPress={abrirGuia} />
        <Botao
          titulo="Já fiz"
          variante="secundario"
          onPress={() => {
            marcarGuiaVisto();
            conferir();
          }}
        />
      </Item>
      {situacao && situacao.bateriaVista && <Botao titulo="Ver o guia da bateria" variante="secundario" onPress={abrirGuia} />}
      {abrirTermo && (
        <Item titulo="Termo de custódia de máquinas" texto={perfil.termoCustodia ? 'Aceito: você pode receber chamadas de maquininha.' : 'Para receber chamadas de maquininha (coleta e devolução), leia e aceite o termo.'} pendente={!perfil.termoCustodia}>
          <Botao titulo="Ler o termo" onPress={abrirTermo} />
        </Item>
      )}
      <Item titulo="Diárias" texto={!perfil.diariaHoje && perfil.saldoDiarias === 0 ? 'Você está sem diárias: compre créditos para ficar online.' : `${perfil.saldoDiarias} ${perfil.saldoDiarias === 1 ? 'diária disponível' : 'diárias disponíveis'}.`} pendente={!perfil.diariaHoje && perfil.saldoDiarias === 0}>
        <Botao titulo="Comprar créditos" onPress={irParaCreditos} />
      </Item>
    </ScrollView>
  );
}
