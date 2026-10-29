import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CodigoPermissao, PerfilResumo, PermissaoResumo } from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { ExigeEmpresa } from '../components/ExigeEmpresa';
import { Alerta, Botao, Cabecalho, Campo, Modal, Tabela } from '../components/ui';

type Edicao = { perfil: PerfilResumo | null } | null;

export function Perfis() {
  return (
    <ExigeEmpresa>
      <ListaPerfis />
    </ExigeEmpresa>
  );
}

function ListaPerfis() {
  const { empresaId, pode } = useAuth();
  const cliente = useQueryClient();
  const [edicao, setEdicao] = useState<Edicao>(null);
  const podeEditar = pode('perfil.editar');
  const { data: perfis = [], isLoading, error } = useQuery({
    queryKey: ['perfis', empresaId],
    queryFn: () => api<PerfilResumo[]>('/perfis'),
  });

  const excluir = useMutation({
    mutationFn: (id: string) => api(`/perfis/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['perfis', empresaId] }),
  });

  return (
    <>
      <Cabecalho
        titulo="Perfis e permissões"
        descricao="Cada usuário tem um perfil; o perfil reúne as permissões."
        acoes={podeEditar && <Botao onClick={() => setEdicao({ perfil: null })}>Novo perfil</Botao>}
      />
      {(error || excluir.error) && <Alerta>{(error ?? excluir.error)!.message}</Alerta>}
      {!isLoading && (
        <Tabela colunas={['Perfil', 'Permissões', 'Usuários', '']} vazio={perfis.length === 0}>
          {perfis.map((p) => (
            <tr key={p.id}>
              <td className="px-4 py-2.5">
                <div className="font-medium">{p.nome}</div>
                {p.descricao && <div className="text-xs text-slate-500">{p.descricao}</div>}
              </td>
              <td className="px-4 py-2.5">{p.permissoes.length}</td>
              <td className="px-4 py-2.5">{p.totalUsuarios}</td>
              <td className="space-x-2 whitespace-nowrap px-4 py-2.5 text-right">
                {podeEditar && (
                  <>
                    <Botao variante="secundario" onClick={() => setEdicao({ perfil: p })}>Editar</Botao>
                    <Botao
                      variante="secundario"
                      disabled={p.totalUsuarios > 0 || excluir.isPending}
                      title={p.totalUsuarios > 0 ? 'Mova os usuários para outro perfil antes de excluir.' : undefined}
                      onClick={() => window.confirm(`Excluir o perfil "${p.nome}"?`) && excluir.mutate(p.id)}
                    >
                      Excluir
                    </Botao>
                  </>
                )}
              </td>
            </tr>
          ))}
        </Tabela>
      )}

      <Modal titulo={edicao?.perfil ? 'Editar perfil' : 'Novo perfil'} aberto={edicao !== null} aoFechar={() => setEdicao(null)}>
        {edicao && <FormPerfil perfil={edicao.perfil} aoConcluir={() => setEdicao(null)} />}
      </Modal>
    </>
  );
}

function FormPerfil({ perfil, aoConcluir }: { perfil: PerfilResumo | null; aoConcluir: () => void }) {
  const { empresaId } = useAuth();
  const cliente = useQueryClient();
  const [nome, setNome] = useState(perfil?.nome ?? '');
  const [descricao, setDescricao] = useState(perfil?.descricao ?? '');
  const [marcadas, setMarcadas] = useState<Set<CodigoPermissao>>(new Set(perfil?.permissoes ?? []));

  const { data: catalogo = [] } = useQuery({
    queryKey: ['permissoes'],
    queryFn: () => api<PermissaoResumo[]>('/permissoes'),
    staleTime: Infinity,
  });
  const grupos = useMemo(() => {
    const mapa = new Map<string, PermissaoResumo[]>();
    for (const p of catalogo) mapa.set(p.grupo, [...(mapa.get(p.grupo) ?? []), p]);
    return [...mapa];
  }, [catalogo]);

  const mutacao = useMutation({
    mutationFn: () => {
      const corpo = { nome, descricao, permissoes: [...marcadas] };
      return perfil ? api(`/perfis/${perfil.id}`, { metodo: 'PATCH', corpo }) : api('/perfis', { metodo: 'POST', corpo });
    },
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['perfis', empresaId] });
      aoConcluir();
    },
  });

  function alternar(codigo: CodigoPermissao) {
    const nova = new Set(marcadas);
    if (nova.has(codigo)) nova.delete(codigo);
    else nova.add(codigo);
    setMarcadas(nova);
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    mutacao.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      {mutacao.error && <Alerta>{mutacao.error.message}</Alerta>}
      <Campo rotulo="Nome" required value={nome} onChange={(e) => setNome(e.target.value)} />
      <Campo rotulo="Descrição" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
      <div className="max-h-80 space-y-3 overflow-y-auto rounded-md border border-slate-200 p-3">
        {grupos.map(([grupo, itens]) => (
          <fieldset key={grupo}>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{grupo}</legend>
            {itens.map((p) => (
              <label key={p.codigo} className="flex items-center gap-2 py-0.5 text-sm">
                <input type="checkbox" checked={marcadas.has(p.codigo)} onChange={() => alternar(p.codigo)} />
                {p.descricao}
                <code className="text-xs text-slate-400">{p.codigo}</code>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Botao variante="secundario" onClick={aoConcluir}>Cancelar</Botao>
        <Botao type="submit" disabled={mutacao.isPending}>{mutacao.isPending ? 'Salvando…' : 'Salvar'}</Botao>
      </div>
    </form>
  );
}
