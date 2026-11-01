import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { formatarCnpj, normalizarCnpj, STATUS_ASSINATURA, validarCnpj, type CadastrosPendentes, type DadosCnpj, type EmpresaResumo, type SistemaErpResumo, type StatusAssinatura } from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alerta, Botao, Cabecalho, Campo, Modal, Selecao, Selo, Tabela, formatarData } from '../components/ui';

const ROTULO_STATUS: Record<StatusAssinatura, string> = {
  ATIVA: 'Ativa',
  CARENCIA: 'Carência',
  BLOQUEADA: 'Bloqueada',
  CANCELADA: 'Cancelada',
};
const COR_STATUS = { ATIVA: 'verde', CARENCIA: 'amarelo', BLOQUEADA: 'vermelho', CANCELADA: 'cinza' } as const;

type Edicao = { modo: 'nova' } | { modo: 'editar'; empresa: EmpresaResumo } | null;

export function Empresas() {
  const { selecionarEmpresa } = useAuth();
  const navegar = useNavigate();
  const [edicao, setEdicao] = useState<Edicao>(null);
  const { data: empresas = [], isLoading, error } = useQuery({
    queryKey: ['empresas'],
    queryFn: () => api<EmpresaResumo[]>('/empresas'),
  });
  const { data: erps = [] } = useQuery({ queryKey: ['erps'], queryFn: () => api<SistemaErpResumo[]>('/erps') });
  const nomeErp = new Map(erps.map((e) => [e.id, e.nome]));

  return (
    <>
      <Cabecalho
        titulo="Empresas"
        descricao="Clientes da plataforma. Ao cadastrar, é criado o perfil Administrador e o primeiro usuário."
        acoes={<Botao onClick={() => setEdicao({ modo: 'nova' })}>Nova empresa</Botao>}
      />
      {error && <Alerta>{error.message}</Alerta>}
      <CadastrosAguardando aoOperar={(id) => { selecionarEmpresa(id); navegar('/usuarios'); }} />
      {!isLoading && (
        <Tabela colunas={['Empresa', 'CNPJ', 'ERP', 'Plano', 'Assinatura', 'Usuários', 'Criada em', '']} vazio={empresas.length === 0}>
          {empresas.map((e) => (
            <tr key={e.id} className={e.ativa ? '' : 'text-slate-400'}>
              <td className="px-4 py-2.5">
                <div className="font-medium">{e.nomeFantasia || e.razaoSocial}</div>
                {e.nomeFantasia && <div className="text-xs text-slate-500">{e.razaoSocial}</div>}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs">{formatarCnpj(e.cnpj)}</td>
              <td className="px-4 py-2.5">{(e.sistemaErpId && nomeErp.get(e.sistemaErpId)) ?? '—'}</td>
              <td className="px-4 py-2.5">{e.plano}</td>
              <td className="px-4 py-2.5">
                {e.aprovacaoPendente ? (
                  <Selo cor="amarelo">Aguardando aprovação</Selo>
                ) : (
                  <Selo cor={e.ativa ? COR_STATUS[e.statusAssinatura] : 'cinza'}>
                    {e.ativa ? ROTULO_STATUS[e.statusAssinatura] : 'Desativada'}
                  </Selo>
                )}
              </td>
              <td className="px-4 py-2.5">{e.totalUsuarios}</td>
              <td className="px-4 py-2.5 text-slate-500">{formatarData(e.criadoEm)}</td>
              <td className="space-x-2 whitespace-nowrap px-4 py-2.5 text-right">
                <Botao
                  variante="secundario"
                  onClick={() => {
                    selecionarEmpresa(e.id);
                    navegar('/usuarios');
                  }}
                >
                  Operar
                </Botao>
                <Botao variante="secundario" onClick={() => setEdicao({ modo: 'editar', empresa: e })}>
                  Editar
                </Botao>
              </td>
            </tr>
          ))}
        </Tabela>
      )}

      <Modal titulo="Nova empresa" aberto={edicao?.modo === 'nova'} aoFechar={() => setEdicao(null)}>
        <FormNovaEmpresa aoConcluir={() => setEdicao(null)} />
      </Modal>
      <Modal titulo="Editar empresa" aberto={edicao?.modo === 'editar'} aoFechar={() => setEdicao(null)}>
        {edicao?.modo === 'editar' && <FormEditarEmpresa empresa={edicao.empresa} aoConcluir={() => setEdicao(null)} />}
      </Modal>
    </>
  );
}

/** Fila do "Cadastre-se". Os dados vêm da busca de CNPJ; se ela falhou, Editar permite completar antes de aprovar. */
function CadastrosAguardando({ aoOperar }: { aoOperar: (empresaId: string) => void }) {
  const cliente = useQueryClient();
  const { data } = useQuery({ queryKey: ['cadastros-pendentes'], queryFn: () => api<CadastrosPendentes>('/cadastros/pendentes') });
  const atualizar = () => {
    void cliente.invalidateQueries({ queryKey: ['cadastros-pendentes'] });
    void cliente.invalidateQueries({ queryKey: ['empresas'] });
  };
  const aprovar = useMutation({ mutationFn: (id: string) => api(`/cadastros/empresas/${id}/aprovar`, { metodo: 'POST' }), onSuccess: atualizar });
  const recusar = useMutation({ mutationFn: (id: string) => api(`/cadastros/empresas/${id}/recusar`, { metodo: 'POST' }), onSuccess: atualizar });
  if (!data || (data.empresas.length === 0 && data.usuarios.length === 0)) return null;

  return (
    <section className="mb-4 space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h2 className="font-medium">Aguardando aprovação</h2>
      {(aprovar.error ?? recusar.error) && <Alerta>{(aprovar.error ?? recusar.error)!.message}</Alerta>}
      {data.empresas.length > 0 && (
        <ul className="divide-y divide-amber-200">
          {data.empresas.map((e) => {
            const irregular = e.situacaoReceita && !/^ativa$/i.test(e.situacaoReceita);
            return (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{e.nomeFantasia || e.razaoSocial}</p>
                  <p className="text-xs text-slate-600"><span className="font-mono">{formatarCnpj(e.cnpj)}</span> · pedido em {formatarData(e.criadoEm)}</p>
                  <p className={`text-xs ${irregular || !e.situacaoReceita ? 'font-medium text-amber-900' : 'text-slate-600'}`}>
                    {e.situacaoReceita ? `Situação na Receita: ${e.situacaoReceita}` : 'A consulta à Receita estava fora do ar: confira os dados em Editar.'}
                  </p>
                  <p className="text-xs text-slate-600">Administrador: {e.emails[0] ?? '—'}{e.emails.length > 1 && ` · mais ${e.emails.length - 1} pedido(s)`}</p>
                </div>
                <div className="flex gap-2">
                  <Botao aria-label={`Aprovar ${e.emails[0] ?? e.razaoSocial}`} disabled={aprovar.isPending} onClick={() => aprovar.mutate(e.id)}>Aprovar</Botao>
                  <Botao aria-label={`Recusar ${e.emails[0] ?? e.razaoSocial}`} variante="secundario" disabled={recusar.isPending} onClick={() => window.confirm(`Recusar ${e.razaoSocial}? A empresa e os pedidos serão apagados.`) && recusar.mutate(e.id)}>Recusar</Botao>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {data.usuarios.length > 0 && (
        <>
          <p className="text-sm text-slate-600">Pedidos em empresas que já existem, mas estão desativadas ou bloqueadas. A empresa continua como está:</p>
          <ul className="divide-y divide-amber-200">
            {data.usuarios.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{u.email}</p>
                  <p className="text-xs text-slate-600">{u.empresa.razaoSocial} · <span className="font-mono">{formatarCnpj(u.empresa.cnpj)}</span></p>
                </div>
                <Botao variante="secundario" onClick={() => aoOperar(u.empresa.id)}>Ver em Usuários</Botao>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** ERPs ativos para vincular à empresa (o template é copiado depois, nas Consultas SQL). */
function SelecaoErp({ valor, aoMudar }: { valor: string; aoMudar: (v: string) => void }) {
  const { data: erps = [] } = useQuery({ queryKey: ['erps'], queryFn: () => api<SistemaErpResumo[]>('/erps') });
  return (
    <Selecao rotulo="Sistema ERP" value={valor} onChange={(e) => aoMudar(e.target.value)}>
      <option value="">Nenhum</option>
      {erps.filter((e) => e.ativo || e.id === valor).map((e) => (
        <option key={e.id} value={e.id}>{e.nome}</option>
      ))}
    </Selecao>
  );
}

/**
 * CNPJ com busca dos dados públicos (BrasilAPI, CNPJ.ws ou ReceitaWS, consultados pela API).
 * Preenche razão social e nome fantasia; busca sozinho ao sair do campo se a razão social estiver vazia.
 */
function CampoCnpj({
  valor,
  aoMudar,
  aoEncontrar,
  buscarAoSair,
  empresaAtualId,
  ajuda,
}: {
  valor: string;
  aoMudar: (cnpj: string) => void;
  aoEncontrar: (dados: DadosCnpj) => void;
  buscarAoSair: boolean;
  empresaAtualId?: string;
  ajuda?: string;
}) {
  const busca = useMutation({
    mutationFn: (cnpj: string) => api<DadosCnpj>(`/empresas/consulta-cnpj/${encodeURIComponent(normalizarCnpj(cnpj))}`),
    onSuccess: (dados) => {
      aoMudar(formatarCnpj(dados.cnpj));
      aoEncontrar(dados);
    },
  });
  const dados = busca.data;
  const valido = validarCnpj(valor);

  function buscar() {
    if (valido && !busca.isPending) busca.mutate(valor);
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="flex-1">
          <Campo
            rotulo="CNPJ"
            required
            placeholder="00.000.000/0000-00"
            value={valor}
            onChange={(e) => {
              aoMudar(e.target.value);
              busca.reset();
            }}
            onBlur={() => buscarAoSair && buscar()}
            ajuda={ajuda}
          />
        </div>
        <Botao variante="secundario" className="mt-6 self-start" onClick={buscar} disabled={!valido || busca.isPending} title="Buscar razão social e nome fantasia na Receita Federal">
          {busca.isPending ? 'Buscando…' : 'Buscar dados'}
        </Botao>
      </div>
      {busca.error && <Alerta tipo="aviso">{busca.error.message}</Alerta>}
      {dados && (
        <Alerta tipo={dados.situacao && !/^ativa$/i.test(dados.situacao) ? 'aviso' : 'info'}>
          Dados preenchidos a partir da {dados.fonte}
          {dados.situacao && <> · situação <strong>{dados.situacao}</strong></>}
          {dados.municipio && <> · {dados.municipio}{dados.uf && `/${dados.uf}`}</>}
          {dados.empresaExistenteId && dados.empresaExistenteId !== empresaAtualId && (
            <div className="mt-1 font-medium text-amber-900">Já existe uma empresa cadastrada com este CNPJ.</div>
          )}
        </Alerta>
      )}
    </div>
  );
}

function FormNovaEmpresa({ aoConcluir }: { aoConcluir: () => void }) {
  const cliente = useQueryClient();
  const [f, setF] = useState({ razaoSocial: '', nomeFantasia: '', cnpj: '', codigoErp: '', sistemaErpId: '', adminNome: '', adminEmail: '', adminSenha: '' });
  const mutacao = useMutation({
    mutationFn: () =>
      api<EmpresaResumo>('/empresas', {
        metodo: 'POST',
        corpo: {
          razaoSocial: f.razaoSocial,
          nomeFantasia: f.nomeFantasia || undefined,
          cnpj: f.cnpj,
          codigoErp: f.codigoErp || undefined,
          sistemaErpId: f.sistemaErpId || undefined,
          admin: { nome: f.adminNome, email: f.adminEmail, senha: f.adminSenha },
        },
      }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['empresas'] });
      aoConcluir();
    },
  });
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });

  function enviar(e: FormEvent) {
    e.preventDefault();
    mutacao.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      {mutacao.error && <Alerta>{mutacao.error.message}</Alerta>}
      <CampoCnpj
        valor={f.cnpj}
        aoMudar={(cnpj) => setF((a) => ({ ...a, cnpj }))}
        aoEncontrar={(d) => setF((a) => ({ ...a, razaoSocial: d.razaoSocial, nomeFantasia: d.nomeFantasia ?? a.nomeFantasia }))}
        buscarAoSair={!f.razaoSocial}
        ajuda="Aceita CNPJ alfanumérico. A busca preenche razão social e nome fantasia."
      />
      <Campo rotulo="Razão social" required {...campo('razaoSocial')} />
      <Campo rotulo="Nome fantasia" {...campo('nomeFantasia')} />
      <Campo rotulo="Código no ERP" {...campo('codigoErp')} />
      <SelecaoErp valor={f.sistemaErpId} aoMudar={(sistemaErpId) => setF({ ...f, sistemaErpId })} />
      <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-700">Administrador da empresa</legend>
        <Campo rotulo="Nome" required {...campo('adminNome')} />
        <Campo rotulo="E-mail" type="email" required {...campo('adminEmail')} />
        <Campo rotulo="Senha inicial" type="password" required minLength={8} autoComplete="new-password" {...campo('adminSenha')} />
      </fieldset>
      <div className="flex justify-end gap-2 pt-2">
        <Botao variante="secundario" onClick={aoConcluir}>Cancelar</Botao>
        <Botao type="submit" disabled={mutacao.isPending}>{mutacao.isPending ? 'Salvando…' : 'Cadastrar'}</Botao>
      </div>
    </form>
  );
}

function FormEditarEmpresa({ empresa, aoConcluir }: { empresa: EmpresaResumo; aoConcluir: () => void }) {
  const cliente = useQueryClient();
  const [f, setF] = useState({
    razaoSocial: empresa.razaoSocial,
    nomeFantasia: empresa.nomeFantasia ?? '',
    cnpj: formatarCnpj(empresa.cnpj),
    codigoErp: empresa.codigoErp ?? '',
    plano: empresa.plano,
    statusAssinatura: empresa.statusAssinatura,
    ativa: empresa.ativa,
    sistemaErpId: empresa.sistemaErpId ?? '',
  });
  const mutacao = useMutation({
    mutationFn: () => api<EmpresaResumo>(`/empresas/${empresa.id}`, { metodo: 'PATCH', corpo: { ...f, sistemaErpId: f.sistemaErpId || null } }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['empresas'] });
      aoConcluir();
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    mutacao.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      {mutacao.error && <Alerta>{mutacao.error.message}</Alerta>}
      <CampoCnpj
        valor={f.cnpj}
        aoMudar={(cnpj) => setF((a) => ({ ...a, cnpj }))}
        aoEncontrar={(d) => setF((a) => ({ ...a, razaoSocial: d.razaoSocial, nomeFantasia: d.nomeFantasia ?? a.nomeFantasia }))}
        buscarAoSair={false}
        empresaAtualId={empresa.id}
      />
      <Campo rotulo="Razão social" required value={f.razaoSocial} onChange={(e) => setF({ ...f, razaoSocial: e.target.value })} />
      <Campo rotulo="Nome fantasia" value={f.nomeFantasia} onChange={(e) => setF({ ...f, nomeFantasia: e.target.value })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Código no ERP" value={f.codigoErp} onChange={(e) => setF({ ...f, codigoErp: e.target.value })} />
        <Campo rotulo="Plano" required value={f.plano} onChange={(e) => setF({ ...f, plano: e.target.value })} />
        <Selecao
          rotulo="Assinatura"
          value={f.statusAssinatura}
          onChange={(e) => setF({ ...f, statusAssinatura: e.target.value as StatusAssinatura })}
        >
          {STATUS_ASSINATURA.map((s) => (
            <option key={s} value={s}>{ROTULO_STATUS[s]}</option>
          ))}
        </Selecao>
      </div>
      <SelecaoErp valor={f.sistemaErpId} aoMudar={(sistemaErpId) => setF({ ...f, sistemaErpId })} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.ativa} onChange={(e) => setF({ ...f, ativa: e.target.checked })} />
        Empresa ativa (desmarcar bloqueia o acesso de todos os usuários)
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <Botao variante="secundario" onClick={aoConcluir}>Cancelar</Botao>
        <Botao type="submit" disabled={mutacao.isPending}>{mutacao.isPending ? 'Salvando…' : 'Salvar'}</Botao>
      </div>
    </form>
  );
}
