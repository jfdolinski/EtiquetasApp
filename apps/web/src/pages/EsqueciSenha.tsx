import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { Alerta, Botao, Campo } from '../components/ui';

function Quadro({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-blue-700">{titulo}</h1>
        {children}
        <p className="text-center text-sm">
          <Link to="/" className="text-blue-700 hover:underline">Voltar para o login</Link>
        </p>
      </div>
    </div>
  );
}

export function EsqueciSenha() {
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api('/auth/esqueci-senha', { metodo: 'POST', corpo: { email } });
      setEnviado(true);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível enviar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Quadro titulo="Esqueci minha senha">
      {enviado ? (
        <Alerta tipo="info">Se este e-mail tiver cadastro, enviamos um link para criar uma nova senha. Ele vale por 1 hora.</Alerta>
      ) : (
        <form onSubmit={enviar} className="space-y-4">
          {erro && <Alerta>{erro}</Alerta>}
          <Campo rotulo="E-mail" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Botao type="submit" className="w-full" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar link'}</Botao>
        </form>
      )}
    </Quadro>
  );
}

export function RedefinirSenha() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (senha !== confirmacao) {
      setErro('A confirmação não confere com a nova senha.');
      return;
    }
    setEnviando(true);
    try {
      await api('/auth/redefinir-senha', { metodo: 'POST', corpo: { token, novaSenha: senha } });
      setPronto(true);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Quadro titulo="Criar nova senha">
      {pronto ? (
        <Alerta tipo="info">Senha alterada. Todas as sessões abertas foram encerradas.</Alerta>
      ) : !token ? (
        <Alerta>Link inválido. Peça um novo em “Esqueci minha senha”.</Alerta>
      ) : (
        <form onSubmit={enviar} className="space-y-4">
          {erro && <Alerta>{erro}</Alerta>}
          <Campo rotulo="Nova senha" type="password" autoComplete="new-password" required minLength={8} value={senha} onChange={(e) => setSenha(e.target.value)} />
          <Campo rotulo="Confirme a nova senha" type="password" autoComplete="new-password" required value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} />
          <Botao type="submit" className="w-full" disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar senha'}</Botao>
        </form>
      )}
    </Quadro>
  );
}
