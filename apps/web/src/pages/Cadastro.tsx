import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { formatarCnpj, validarCnpj } from '@etiquetas/shared';
import { api } from '../api';
import { Alerta, Botao, Campo } from '../components/ui';

export function Cadastro() {
  const [cnpj, setCnpj] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!validarCnpj(cnpj)) {
      setErro('CNPJ inválido. Confira os números.');
      return;
    }
    setEnviando(true);
    try {
      const r = await api<{ mensagem: string }>('/cadastros', { metodo: 'POST', corpo: { cnpj, email, senha } });
      setMensagem(r.mensagem);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível enviar o cadastro.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-blue-700">Cadastre-se</h1>
          {!mensagem && <p className="text-sm text-slate-500">Depois de enviar, um administrador precisa aprovar o seu acesso.</p>}
        </div>
        {mensagem ? (
          <Alerta tipo="info">{mensagem}</Alerta>
        ) : (
          <form onSubmit={enviar} className="space-y-4">
            {erro && <Alerta>{erro}</Alerta>}
            <Campo
              rotulo="CNPJ da empresa"
              required
              placeholder="00.000.000/0000-00"
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value)}
              onBlur={() => validarCnpj(cnpj) && setCnpj(formatarCnpj(cnpj))}
            />
            <Campo rotulo="E-mail" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <Campo rotulo="Senha" type="password" autoComplete="new-password" required minLength={8} value={senha} onChange={(e) => setSenha(e.target.value)} ajuda="Mínimo de 8 caracteres." />
            <Botao type="submit" className="w-full" disabled={enviando}>{enviando ? 'Enviando…' : 'Cadastrar'}</Botao>
          </form>
        )}
        <p className="text-center text-sm">
          <Link to="/" className="text-blue-700 hover:underline">Voltar para o login</Link>
        </p>
      </div>
    </div>
  );
}
