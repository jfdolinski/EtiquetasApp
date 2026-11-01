import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IniciarDoisFatoresResposta, SessaoResumo } from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { CodigoQr } from '../components/CodigoQr';
import { Alerta, Botao, Cabecalho, Campo, formatarData } from '../components/ui';
import { AplicativoCelular } from './minha-conta/AplicativoCelular';

export function MinhaConta() {
  const { usuario } = useAuth();
  return (
    <>
      <Cabecalho titulo="Minha conta" descricao={`${usuario?.nome} · ${usuario?.email}`} />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <AplicativoCelular />
        <DoisFatores />
        <Sessoes />
        <TrocarSenha />
      </div>
    </>
  );
}

function TrocarSenha() {
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
    <form onSubmit={enviar} className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="font-medium">Trocar senha</h2>
      {(erroLocal || mutacao.error) && <Alerta>{erroLocal ?? mutacao.error?.message}</Alerta>}
      {mutacao.isSuccess && <Alerta tipo="info">Senha alterada. As outras sessões foram encerradas.</Alerta>}
      <Campo rotulo="Senha atual" type="password" autoComplete="current-password" required value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} />
      <Campo rotulo="Nova senha" type="password" autoComplete="new-password" required minLength={8} value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} />
      <Campo rotulo="Confirme a nova senha" type="password" autoComplete="new-password" required value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} />
      <Botao type="submit" disabled={mutacao.isPending}>{mutacao.isPending ? 'Salvando…' : 'Trocar senha'}</Botao>
    </form>
  );
}

function DoisFatores() {
  const { usuario, recarregarUsuario } = useAuth();
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [inicio, setInicio] = useState<IniciarDoisFatoresResposta | null>(null);
  const [recuperacao, setRecuperacao] = useState<string[] | null>(null);

  const iniciar = useMutation({
    mutationFn: () => api<IniciarDoisFatoresResposta>('/auth/2fa/iniciar', { metodo: 'POST', corpo: { senha } }),
    onSuccess: (r) => {
      setInicio(r);
      setSenha('');
    },
  });
  const ativar = useMutation({
    mutationFn: () => api<{ codigosRecuperacao: string[] }>('/auth/2fa/ativar', { metodo: 'POST', corpo: { codigo } }),
    onSuccess: async (r) => {
      setRecuperacao(r.codigosRecuperacao);
      setInicio(null);
      setCodigo('');
      await recarregarUsuario();
    },
  });
  const desativar = useMutation({
    mutationFn: () => api('/auth/2fa/desativar', { metodo: 'POST', corpo: { senha, codigo } }),
    onSuccess: async () => {
      setSenha('');
      setCodigo('');
      setRecuperacao(null);
      await recarregarUsuario();
    },
  });
  const erro = iniciar.error ?? ativar.error ?? desativar.error;

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="font-medium">Verificação em duas etapas {usuario?.doisFatores && <span className="ml-1 rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">Ativa</span>}</h2>
      <p className="text-sm text-slate-500">Além da senha, o login pede um código do Google Authenticator, Microsoft Authenticator ou outro aplicativo parecido.</p>
      {usuario?.superAdmin && !usuario.doisFatores && <Alerta tipo="aviso">Sua conta acessa todas as empresas: recomendamos ativar.</Alerta>}
      {erro && <Alerta>{erro.message}</Alerta>}

      {recuperacao && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium">Guarde estes códigos agora. Eles não aparecem de novo.</p>
          <p className="text-sm">Cada um entra uma vez, se você perder o celular.</p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-sm">{recuperacao.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}

      {usuario?.doisFatores ? (
        <form onSubmit={(e) => { e.preventDefault(); desativar.mutate(); }} className="space-y-3">
          <Campo rotulo="Senha" type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
          <Campo rotulo="Código" autoComplete="one-time-code" required value={codigo} onChange={(e) => setCodigo(e.target.value)} />
          <Botao type="submit" variante="secundario" disabled={desativar.isPending}>Desativar</Botao>
        </form>
      ) : inicio ? (
        <form onSubmit={(e) => { e.preventDefault(); ativar.mutate(); }} className="space-y-3">
          <p className="text-sm">Leia este QR code no aplicativo autenticador e digite o código que aparecer.</p>
          <CodigoQr texto={inicio.uri} />
          <p className="break-all text-xs text-slate-500">Sem câmera, digite no aplicativo: <span className="font-mono">{inicio.segredo}</span></p>
          <Campo rotulo="Código" inputMode="numeric" autoComplete="one-time-code" required value={codigo} onChange={(e) => setCodigo(e.target.value)} />
          <Botao type="submit" disabled={ativar.isPending}>Ativar</Botao>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); iniciar.mutate(); }} className="space-y-3">
          <Campo rotulo="Confirme sua senha" type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
          <Botao type="submit" disabled={iniciar.isPending}>Começar</Botao>
        </form>
      )}
    </section>
  );
}

function Sessoes() {
  const cliente = useQueryClient();
  const chave = ['sessoes'];
  const { data: sessoes = [], error } = useQuery({ queryKey: chave, queryFn: () => api<SessaoResumo[]>('/auth/sessoes') });
  const atualizar = () => void cliente.invalidateQueries({ queryKey: chave });
  const encerrar = useMutation({ mutationFn: (id: string) => api(`/auth/sessoes/${id}`, { metodo: 'DELETE' }), onSuccess: atualizar });
  const encerrarOutras = useMutation({ mutationFn: () => api('/auth/sessoes/encerrar-outras', { metodo: 'POST' }), onSuccess: atualizar });
  const outras = sessoes.filter((s) => !s.atual).length;

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">Sessões abertas</h2>
        {outras > 0 && <Botao variante="secundario" disabled={encerrarOutras.isPending} onClick={() => encerrarOutras.mutate()}>Encerrar as outras</Botao>}
      </div>
      {(error ?? encerrar.error ?? encerrarOutras.error) && <Alerta>{(error ?? encerrar.error ?? encerrarOutras.error)!.message}</Alerta>}
      <ul className="divide-y divide-slate-100">
        {sessoes.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate" title={s.descricao ?? undefined}>{navegadorDe(s.descricao)}{s.atual && <span className="ml-2 text-xs text-green-700">esta sessão</span>}</p>
              <p className="text-xs text-slate-500">{s.ip ?? 'IP desconhecido'} · último uso {formatarData(s.ultimoUsoEm)}</p>
            </div>
            {!s.atual && <Botao variante="secundario" disabled={encerrar.isPending} onClick={() => encerrar.mutate(s.id)}>Encerrar</Botao>}
          </li>
        ))}
        {sessoes.length === 0 && <li className="py-2 text-sm text-slate-500">Esta sessão começou antes desta função: ela aparece no próximo login.</li>}
      </ul>
    </section>
  );
}

function navegadorDe(agente: string | null): string {
  if (!agente) return 'Navegador desconhecido';
  const navegador = /Edg\//.test(agente) ? 'Edge' : /OPR\//.test(agente) ? 'Opera' : /Chrome\//.test(agente) ? 'Chrome' : /Firefox\//.test(agente) ? 'Firefox' : /Safari\//.test(agente) ? 'Safari' : 'Navegador';
  const sistema = /Windows/.test(agente) ? 'Windows' : /Android/.test(agente) ? 'Android' : /iPhone|iPad/.test(agente) ? 'iOS' : /Mac OS/.test(agente) ? 'macOS' : /Linux/.test(agente) ? 'Linux' : '';
  return sistema ? `${navegador} no ${sistema}` : navegador;
}
