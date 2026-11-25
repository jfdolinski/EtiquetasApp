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
    <div className="grid min-h-screen md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* O lado grafite: a etiqueta grande é a marca do Flow (o mesmo desenho do item ativo do menu). */}
      <div className="relative hidden overflow-hidden bg-grafite p-12 md:flex md:flex-col md:justify-between">
        <div className="flex items-center gap-2.5 font-display text-xl font-extrabold text-white">
          <img src="/favicon.svg" alt="" className="h-9 w-9" />
          Flow
        </div>
        <div className="etiqueta-ativa max-w-md py-8 pr-8 pl-14">
          <p className="font-display text-3xl leading-tight font-extrabold text-white">Etiqueta, preço na tela, pedido e entrega.</p>
          <p className="mt-3 text-base text-blue-50">Tudo lendo direto do ERP da sua loja.</p>
        </div>
        <p className="text-sm text-slate-400">Para lojas que trocam preço todo dia.</p>
      </div>
      <div className="flex items-center justify-center px-4 py-10">
      <form onSubmit={enviar} className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-extrabold text-slate-900">
            <img src="/favicon.svg" alt="" className="h-8 w-8 md:hidden" />
            Entrar no Flow
          </h1>
          <p className="mt-1 text-sm text-slate-500">{precisaCodigo ? 'Digite o código do seu aplicativo autenticador.' : 'Entre com seu e-mail e senha.'}</p>
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
    </div>
  );
}
