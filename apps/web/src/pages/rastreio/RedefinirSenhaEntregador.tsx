import { useState, type FormEvent } from 'react';

/** Link do e-mail do entregador: /entregador/redefinir-senha#token=… (o token fica depois do #, fora dos logs). */
export function RedefinirSenhaEntregador() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
  const [senha, setSenha] = useState('');
  const [repetida, setRepetida] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (senha !== repetida) return setErro('As duas senhas não são iguais.');
    setOcupado(true);
    try {
      const r = await fetch('/api/entregador/senha/redefinir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, senha }) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { message?: string }).message ?? 'Não foi possível trocar a senha.');
      setPronto(true);
    } catch (x) {
      setErro((x as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold">Nova senha · Flow Entregas</h1>
        {!token && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">Link incompleto. Abra de novo o link do e-mail.</p>}
        {pronto ? (
          <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-800" role="status">
            Senha trocada. Abra o aplicativo Flow Entregas e entre com a nova senha.
          </p>
        ) : (
          token && (
            <form onSubmit={enviar} className="space-y-3">
              <label className="block text-sm">
                <span className="font-medium">Nova senha</span>
                <input type="password" autoComplete="new-password" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" value={senha} onChange={(e) => setSenha(e.target.value)} />
              </label>
              <label className="block text-sm">
                <span className="font-medium">Repita a nova senha</span>
                <input type="password" autoComplete="new-password" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" value={repetida} onChange={(e) => setRepetida(e.target.value)} />
              </label>
              {erro && (
                <p role="alert" className="text-sm text-red-700">
                  {erro}
                </p>
              )}
              <button type="submit" disabled={ocupado || !senha} className="w-full rounded bg-blue-600 py-2 font-semibold text-white disabled:bg-slate-300">
                {ocupado ? 'Salvando…' : 'Salvar nova senha'}
              </button>
            </form>
          )
        )}
      </div>
    </div>
  );
}
