import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alerta, Botao, Campo } from '../components/ui';

export function Login() {
  const { entrar } = useAuth();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [precisaCodigo, setPrecisaCodigo] = useState(false);
  const [esqueciSenha, setEsqueciSenha] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api<{ esqueciSenha: boolean }>('/auth/opcoes')
      .then((o) => setEsqueciSenha(o.esqueciSenha))
      .catch(() => undefined);
  }, []);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const entrou = await entrar(email, senha, precisaCodigo ? codigo : undefined);
      if (!entrou) setPrecisaCodigo(true);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível entrar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={enviar} className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <img src="/favicon.svg" alt="" className="h-8 w-8" />
            Flow
          </h1>
          <p className="text-sm text-slate-500">{precisaCodigo ? 'Digite o código do seu aplicativo autenticador.' : 'Entre com seu e-mail e senha.'}</p>
        </div>
        {erro && <Alerta>{erro}</Alerta>}
        {precisaCodigo ? (
          <Campo rotulo="Código" autoComplete="one-time-code" autoFocus required value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="6 dígitos ou código de recuperação" />
        ) : (
          <>
            <Campo rotulo="E-mail" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <Campo rotulo="Senha" type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
          </>
        )}
        <Botao type="submit" className="w-full" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </Botao>
        {!precisaCodigo && (
          <div className="space-y-1 text-center text-sm">
            <p>
              Ainda não tem acesso? <Link to="/cadastro" className="font-medium text-blue-700 hover:underline">Cadastre-se</Link>
            </p>
            {esqueciSenha && (
              <p>
                <Link to="/esqueci-senha" className="text-blue-700 hover:underline">Esqueci minha senha</Link>
              </p>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
