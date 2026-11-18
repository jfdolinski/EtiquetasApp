import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as Device from 'expo-device';
import type { SessaoEntregadorResposta, TipoVeiculo } from '../../../packages/shared/src/entregas';
import { aceitaHttp, pedir, servidorDoApp, versaoDoApp, type Sessao } from './api';
import { problemaNoCadastroEntregador, ROTULO_VEICULO, servidorValido, TIPOS_VEICULO, veiculoMotorizado } from './regras';
import { EsqueciSenha } from './EsqueciSenha';
import { Alerta, Botao, Campo, cores, Texto, Titulo } from './ui';

type Modo = 'entrar' | 'cadastro';

const dispositivo = () => [Device.manufacturer, Device.modelName].filter(Boolean).join(' ').slice(0, 80) || Platform.OS;

export function TelaEntrar({ motivo, aoEntrar }: { motivo: string | null; aoEntrar: (s: Sessao, r: SessaoEntregadorResposta) => void }) {
  const fixo = servidorDoApp();
  const [servidor, setServidor] = useState(fixo ?? (Platform.OS === 'web' && typeof window !== 'undefined' ? '' : ''));
  const [modo, setModo] = useState<Modo>('entrar');
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [c, setC] = useState({ nome: '', cpf: '', celular: '', email: '', senha: '', veiculo: 'MOTO' as TipoVeiculo, placa: '', chavePix: '', aceitaTermos: false });
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const endereco = fixo ?? servidorValido(servidor, aceitaHttp());

  async function enviar() {
    setErro(null);
    if (!endereco) return setErro('Informe o endereço do sistema (https://…).');
    if (modo === 'cadastro') {
      const problema = problemaNoCadastroEntregador(c);
      if (problema) return setErro(problema);
    }
    setOcupado(true);
    try {
      const r =
        modo === 'entrar'
          ? await pedir<SessaoEntregadorResposta>(endereco, '/entregador/login', { metodo: 'POST', corpo: { login, senha, dispositivo: dispositivo(), versao: versaoDoApp() } })
          : await pedir<SessaoEntregadorResposta>(endereco, '/entregador/cadastro', { metodo: 'POST', corpo: { ...c, placa: veiculoMotorizado(c.veiculo) ? c.placa : null, dispositivo: dispositivo(), versao: versaoDoApp() } });
      aoEntrar({ servidor: endereco, token: r.token }, r);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={estilos.tela} keyboardShouldPersistTaps="handled">
      <Text style={estilos.marca}>Flow Entregas</Text>
      <Texto suave>Fique online, receba chamadas de coleta e entrega das empresas e acompanhe o que tem a receber.</Texto>
      {motivo && <Alerta tipo="aviso">{motivo}</Alerta>}

      <View style={estilos.abas}>
        {(['entrar', 'cadastro'] as const).map((m) => (
          <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: modo === m }} onPress={() => { setModo(m); setErro(null); }} style={[estilos.aba, modo === m && estilos.abaAtiva]}>
            <Text style={[estilos.abaTexto, modo === m && { color: cores.azul }]}>{m === 'entrar' ? 'Entrar' : 'Quero me cadastrar'}</Text>
          </Pressable>
        ))}
      </View>

      {!fixo && <Campo rotulo="Endereço do sistema" value={servidor} onChangeText={setServidor} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://" />}

      {modo === 'entrar' ? (
        <>
          <Campo rotulo="E-mail ou CPF" value={login} onChangeText={setLogin} autoCapitalize="none" autoCorrect={false} />
          <Campo rotulo="Senha" value={senha} onChangeText={setSenha} secureTextEntry />
          <EsqueciSenha endereco={endereco} emailInicial={login.includes('@') ? login : ''} />
        </>
      ) : (
        <>
          <Titulo>Seus dados</Titulo>
          <Campo rotulo="Nome completo" value={c.nome} onChangeText={(v) => setC({ ...c, nome: v })} autoCapitalize="words" />
          <Campo rotulo="CPF" value={c.cpf} onChangeText={(v) => setC({ ...c, cpf: v })} keyboardType="number-pad" />
          <Campo rotulo="Celular com DDD" value={c.celular} onChangeText={(v) => setC({ ...c, celular: v })} keyboardType="phone-pad" />
          <Campo rotulo="E-mail" value={c.email} onChangeText={(v) => setC({ ...c, email: v })} autoCapitalize="none" keyboardType="email-address" autoCorrect={false} />
          <Campo rotulo="Senha (ao menos 8 caracteres)" value={c.senha} onChangeText={(v) => setC({ ...c, senha: v })} secureTextEntry />
          <Text style={estilos.rotulo}>Veículo</Text>
          <View style={estilos.chips}>
            {TIPOS_VEICULO.map((v) => (
              <Pressable key={v} accessibilityRole="radio" accessibilityState={{ checked: c.veiculo === v }} onPress={() => setC({ ...c, veiculo: v })} style={[estilos.chip, c.veiculo === v && estilos.chipAtivo]}>
                <Text style={{ color: c.veiculo === v ? cores.branco : cores.texto }}>{ROTULO_VEICULO[v]}</Text>
              </Pressable>
            ))}
          </View>
          {veiculoMotorizado(c.veiculo) && <Campo rotulo="Placa" value={c.placa} onChangeText={(v) => setC({ ...c, placa: v })} autoCapitalize="characters" />}
          <Campo rotulo="Chave Pix para receber das empresas" value={c.chavePix} onChangeText={(v) => setC({ ...c, chavePix: v })} autoCapitalize="none" />
          <View style={estilos.termos}>
            <Switch value={c.aceitaTermos} onValueChange={(v) => setC({ ...c, aceitaTermos: v })} accessibilityLabel="Aceito os termos" />
            <Text style={{ flex: 1, color: cores.texto }}>
              Aceito os termos: sou autônomo e escolho quando ficar online e quais chamadas aceitar; minha localização só é usada enquanto estou online; meus documentos são conferidos pela plataforma.
            </Text>
          </View>
        </>
      )}

      {erro && <Alerta>{erro}</Alerta>}
      <Botao titulo={modo === 'entrar' ? 'Entrar' : 'Criar cadastro'} onPress={() => void enviar()} ocupado={ocupado} />
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  tela: { padding: 20, paddingBottom: 40 },
  marca: { fontSize: 26, fontWeight: '800', color: cores.laranja, marginTop: 16, marginBottom: 8 },
  abas: { flexDirection: 'row', borderBottomWidth: 1, borderColor: cores.borda, marginVertical: 16 },
  aba: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderColor: 'transparent' },
  abaAtiva: { borderColor: cores.azul },
  abaTexto: { fontSize: 15, fontWeight: '600', color: cores.suave },
  rotulo: { fontSize: 14, fontWeight: '600', color: cores.texto, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: cores.borda, backgroundColor: cores.branco },
  chipAtivo: { backgroundColor: cores.azul, borderColor: cores.azul },
  termos: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 16 },
});
