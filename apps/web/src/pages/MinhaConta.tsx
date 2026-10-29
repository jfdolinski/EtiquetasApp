import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alerta, Botao, Cabecalho, Campo } from '../components/ui';

export function MinhaConta() {
  const { usuario } = useAuth();
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erroLocal, setErroLocal] = useState<string | null>(null);

  const mutacao = useMutation({
    mutationFn: () => api('/auth/trocar-senha', { metodo: 'POST', corpo: { senhaAtual, novaSenha } }),
    onSuccess: () => {
      setSenhaAtual('');
      setNovaSenha('');
      setConfirmacao('');
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    setErroLocal(null);
    if (novaSenha !== confirmacao) {
      setErroLocal('A confirmação não confere com a nova senha.');
      return;
    }
    mutacao.mutate();
  }

  return (
    <>
      <Cabecalho titulo="Minha conta" descricao={`${usuario?.nome} · ${usuario?.email}`} />
      <form onSubmit={enviar} className="max-w-sm space-y-3 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-medium">Trocar senha</h2>
        {(erroLocal || mutacao.error) && <Alerta>{erroLocal ?? mutacao.error?.message}</Alerta>}
        {mutacao.isSuccess && <Alerta tipo="info">Senha alterada.</Alerta>}
        <Campo rotulo="Senha atual" type="password" autoComplete="current-password" required value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} />
        <Campo rotulo="Nova senha" type="password" autoComplete="new-password" required minLength={8} value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} />
        <Campo rotulo="Confirme a nova senha" type="password" autoComplete="new-password" required value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} />
        <Botao type="submit" disabled={mutacao.isPending}>{mutacao.isPending ? 'Salvando…' : 'Trocar senha'}</Botao>
      </form>
    </>
  );
}
