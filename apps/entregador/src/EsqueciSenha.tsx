import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { pedir } from './api';
import { Alerta, Botao, Campo, cores } from './ui';

/** "Esqueci minha senha": só aparece se o servidor envia e-mail; a troca é feita pelo link do e-mail. */
export function EsqueciSenha({ endereco, emailInicial }: { endereco: string | null; emailInicial: string }) {
  const [disponivel, setDisponivel] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [email, setEmail] = useState(emailInicial);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!endereco) return setDisponivel(false);
    let vivo = true;
    pedir<{ esqueciSenha: boolean }>(endereco, '/entregador/recursos').then(
      (r) => vivo && setDisponivel(r.esqueciSenha),
      () => vivo && setDisponivel(false),
    );
    return () => {
      vivo = false;
    };
  }, [endereco]);

  if (!disponivel || !endereco) return null;

  async function enviar() {
    setErro(null);
    setOcupado(true);
    try {
      await pedir(endereco!, '/entregador/senha/esqueci', { metodo: 'POST', corpo: { email } });
      setEnviado(true);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (!aberto) {
    return (
      <Pressable accessibilityRole="button" onPress={() => { setAberto(true); setEmail(emailInicial); }} style={{ paddingVertical: 8 }}>
        <Text style={{ color: cores.azul, textDecorationLine: 'underline' }}>Esqueci minha senha</Text>
      </Pressable>
    );
  }
  return (
    <View style={{ gap: 8, marginBottom: 12 }}>
      {enviado ? (
        <Alerta tipo="ok">Se o e-mail estiver cadastrado, enviamos um link para criar a nova senha. Ele vale por 1 hora.</Alerta>
      ) : (
        <>
          <Campo rotulo="E-mail do cadastro" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoCorrect={false} />
          {erro && <Alerta>{erro}</Alerta>}
          <Botao titulo="Enviar link por e-mail" variante="secundario" onPress={() => void enviar()} ocupado={ocupado} disabled={!email.includes('@')} />
        </>
      )}
    </View>
  );
}
