import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PerfilResumo, UsuarioResumo } from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { ExigeEmpresa } from '../components/ExigeEmpresa';
import { Alerta, Botao, Cabecalho, Campo, Modal, Selecao, Selo, Tabela, formatarData } from '../components/ui';

type Edicao = { usuario: UsuarioResumo | null } | null;

export function Usuarios() {
  return (
    <ExigeEmpresa>
      <ListaUsuarios />
    </ExigeEmpresa>
  );
}

function ListaUsuarios() {
  const { empresaId, pode } = useAuth();
  const [edicao, setEdicao] = useState<Edicao>(null);
  const podeEditar = pode('usuario.editar');
  const { data: usuarios = [], isLoading, error } = useQuery({
    queryKey: ['usuarios', empresaId],
    queryFn: () => api<UsuarioResumo[]>('/usuarios'),
  });

  return (
    <>
      <Cabecalho
        titulo="Usuários"
        descricao="Pessoas com acesso a esta empresa. O perfil define o que cada uma pode fazer."
        acoes={podeEditar && <Botao onClick={() => setEdicao({ usuario: null })}>Novo usuário</Botao>}
      />
      {error && <Alerta>{error.message}</Alerta>}
      {podeEditar && <PedidosPendentes pedidos={usuarios.filter((u) => u.cadastroPendente)} />}
      {!isLoading && (
        <Tabela colunas={['Nome', 'E-mail', 'Perfil', 'Situação', 'Último acesso', '']} vazio={usuarios.length === 0}>
          {usuarios.filter((u) => podeEditar ? !u.cadastroPendente : true).map((u) => (
            <tr key={u.id}>
              <td className="px-4 py-2.5 font-medium">{u.nome}</td>
              <td className="px-4 py-2.5">{u.email}</td>
              <td className="px-4 py-2.5">{u.perfil?.nome ?? '—'}</td>
              <td className="px-4 py-2.5">
                <Selo cor={u.cadastroPendente ? 'amarelo' : u.ativo ? 'verde' : 'cinza'}>{u.cadastroPendente ? 'Aguardando aprovação' : u.ativo ? 'Ativo' : 'Desativado'}</Selo>
              </td>
              <td className="px-4 py-2.5 text-slate-500">{formatarData(u.ultimoLoginEm)}</td>
              <td className="px-4 py-2.5 text-right">
                {podeEditar && !u.cadastroPendente && (
                  <Botao variante="secundario" onClick={() => setEdicao({ usuario: u })}>
                    Editar
                  </Botao>
                )}
              </td>
            </tr>
          ))}
        </Tabela>
      )}

      <Modal titulo={edicao?.usuario ? 'Editar usuário' : 'Novo usuário'} aberto={edicao !== null} aoFechar={() => setEdicao(null)}>
        {edicao && <FormUsuario usuario={edicao.usuario} aoConcluir={() => setEdicao(null)} />}
      </Modal>
    </>
  );
}

/** Pedidos do "Cadastre-se": quem aprova escolhe o perfil. */
function PedidosPendentes({ pedidos }: { pedidos: UsuarioResumo[] }) {
  const { empresaId } = useAuth();
  const cliente = useQueryClient();
  const [perfilDe, setPerfilDe] = useState<Record<string, string>>({});
  const { data: perfis = [] } = useQuery({ queryKey: ['perfis', empresaId], queryFn: () => api<PerfilResumo[]>('/perfis'), enabled: pedidos.length > 0 });
  const atualizar = () => {
    void cliente.invalidateQueries({ queryKey: ['usuarios', empresaId] });
    void cliente.invalidateQueries({ queryKey: ['usuarios-pendentes', empresaId] });
  };
  const aprovar = useMutation({
    mutationFn: (u: UsuarioResumo) => api(`/usuarios/${u.id}/aprovar`, { metodo: 'POST', corpo: { perfilId: perfilDe[u.id] } }),
    onSuccess: atualizar,
  });
  const recusar = useMutation({ mutationFn: (u: UsuarioResumo) => api(`/usuarios/${u.id}/recusar`, { metodo: 'POST' }), onSuccess: atualizar });
  if (pedidos.length === 0) return null;

  return (
    <section className="mb-4 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h2 className="font-medium">Aguardando aprovação</h2>
      <p className="text-sm text-slate-600">Estas pessoas se cadastraram informando o CNPJ da empresa. Confira se são mesmo da equipe antes de aprovar.</p>
      {(aprovar.error ?? recusar.error) && <Alerta>{(aprovar.error ?? recusar.error)!.message}</Alerta>}
      <ul className="divide-y divide-amber-200">
        {pedidos.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium">{u.email}</p>
              <p className="text-xs text-slate-500">Pedido em {formatarData(u.criadoEm)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label={`Perfil de ${u.email}`} value={perfilDe[u.id] ?? ''} onChange={(e) => setPerfilDe({ ...perfilDe, [u.id]: e.target.value })} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
                <option value="">Escolha o perfil…</option>
                {perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
              <Botao aria-label={`Aprovar ${u.email}`} disabled={!perfilDe[u.id] || aprovar.isPending} onClick={() => aprovar.mutate(u)}>Aprovar</Botao>
              <Botao aria-label={`Recusar ${u.email}`} variante="secundario" disabled={recusar.isPending} onClick={() => window.confirm(`Recusar o pedido de ${u.email}? O pedido será apagado.`) && recusar.mutate(u)}>Recusar</Botao>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FormUsuario({ usuario, aoConcluir }: { usuario: UsuarioResumo | null; aoConcluir: () => void }) {
  const { empresaId, usuario: logado } = useAuth();
  const cliente = useQueryClient();
  const [f, setF] = useState({
    nome: usuario?.nome ?? '',
    email: usuario?.email ?? '',
    senha: '',
    perfilId: usuario?.perfil?.id ?? '',
    ativo: usuario?.ativo ?? true,
  });
  const { data: perfis = [] } = useQuery({
    queryKey: ['perfis', empresaId],
    queryFn: () => api<PerfilResumo[]>('/perfis'),
  });

  const mutacao = useMutation({
    mutationFn: () => {
      if (!usuario) return api('/usuarios', { metodo: 'POST', corpo: { nome: f.nome, email: f.email, senha: f.senha, perfilId: f.perfilId } });
      return api(`/usuarios/${usuario.id}`, {
        metodo: 'PATCH',
        corpo: { nome: f.nome, email: f.email, perfilId: f.perfilId || undefined, ativo: f.ativo, senha: f.senha || undefined },
      });
    },
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['usuarios', empresaId] });
      aoConcluir();
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    mutacao.mutate();
  }

  const ehProprio = usuario?.id === logado?.id;

  return (
    <form onSubmit={enviar} className="space-y-3">
      {mutacao.error && <Alerta>{mutacao.error.message}</Alerta>}
      <Campo rotulo="Nome" required value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
      <Campo rotulo="E-mail" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <Selecao rotulo="Perfil" required value={f.perfilId} onChange={(e) => setF({ ...f, perfilId: e.target.value })}>
        <option value="">Selecione…</option>
        {perfis.map((p) => (
          <option key={p.id} value={p.id}>{p.nome}</option>
        ))}
      </Selecao>
      <Campo
        rotulo={usuario ? 'Nova senha' : 'Senha inicial'}
        type="password"
        autoComplete="new-password"
        required={!usuario}
        minLength={8}
        value={f.senha}
        onChange={(e) => setF({ ...f, senha: e.target.value })}
        ajuda={usuario ? 'Deixe em branco para manter a senha atual.' : 'Mínimo de 8 caracteres.'}
      />
      {usuario && !ehProprio && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} />
          Usuário ativo
        </label>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Botao variante="secundario" onClick={aoConcluir}>Cancelar</Botao>
        <Botao type="submit" disabled={mutacao.isPending}>{mutacao.isPending ? 'Salvando…' : 'Salvar'}</Botao>
      </div>
    </form>
  );
}
