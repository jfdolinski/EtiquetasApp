import { Linking, Platform, ScrollView, Text } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { Botao, Cartao, cores, Texto, Titulo } from './ui';

/**
 * Guia de bateria: Xiaomi, Samsung, Motorola e outros fecham apps em segundo plano para economizar,
 * e aí o entregador para de mandar a posição e de receber ofertas com a tela apagada.
 */
const MARCAS: { marca: string; passos: string[] }[] = [
  { marca: 'Todos os Android', passos: ['Toque em "Abrir as configurações de bateria" abaixo.', 'Procure o Flow Entregas e escolha "Não otimizar" (ou "Sem restrições").'] },
  { marca: 'Xiaomi, Redmi e Poco', passos: ['Configurações > Apps > Gerenciar apps > Flow Entregas.', 'Economia de bateria: "Sem restrições".', 'Inicialização automática: ligada.', 'Na tela de apps recentes, segure o Flow Entregas e toque no cadeado.'] },
  { marca: 'Samsung', passos: ['Configurações > Apps > Flow Entregas > Bateria: "Sem restrições".', 'Configurações > Assistência do aparelho > Bateria > Limites de uso em segundo plano: tire o Flow Entregas dos apps em suspensão.'] },
  { marca: 'Motorola', passos: ['Configurações > Apps > Flow Entregas > Bateria: "Sem restrições" (ou desligue "Otimizar uso da bateria").'] },
  { marca: 'Outras marcas', passos: ['Procure nas configurações do app por "Bateria", "Segundo plano" ou "Inicialização automática" e libere o Flow Entregas.'] },
];

async function abrirConfiguracoes() {
  try {
    if (Platform.OS === 'android') return await Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
  } catch {
    // Alguns aparelhos não têm essa tela: vai para as configurações do app.
  }
  await Linking.openSettings().catch(() => undefined);
}

export function GuiaBateria({ aoFechar }: { aoFechar: () => void }) {
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Titulo>Deixar o app sempre ligado</Titulo>
      <Texto suave>Sem isso, o celular pode fechar o Flow Entregas quando a tela desliga: você para de receber ofertas e a empresa perde a sua posição no meio da entrega.</Texto>
      <Botao titulo="Abrir as configurações de bateria" onPress={() => void abrirConfiguracoes()} />
      {MARCAS.map((m) => (
        <Cartao key={m.marca}>
          <Text style={{ fontWeight: '700', color: cores.texto, marginBottom: 4 }}>{m.marca}</Text>
          {m.passos.map((p, i) => (
            <Texto key={i}>
              {i + 1}. {p}
            </Texto>
          ))}
        </Cartao>
      ))}
      <Botao titulo="Pronto" variante="secundario" onPress={aoFechar} />
    </ScrollView>
  );
}

// "Já fiz" fica guardado no aparelho: a bateria sai das pendências da guia Avisos.
const ARQUIVO = 'guia-bateria-visto.txt';
const CHAVE_WEB = `flow.entregador.${ARQUIVO}`;

export async function guiaJaVisto(): Promise<boolean> {
  try {
    if (Platform.OS === 'web') return localStorage.getItem(CHAVE_WEB) === '1';
    return new File(Paths.document, ARQUIVO).exists;
  } catch {
    return false;
  }
}

export function marcarGuiaVisto() {
  try {
    if (Platform.OS === 'web') localStorage.setItem(CHAVE_WEB, '1');
    else new File(Paths.document, ARQUIVO).write('1');
  } catch {
    // Sem onde guardar: o aviso volta na próxima vez, sem problema.
  }
}
