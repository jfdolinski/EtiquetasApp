import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { formatarCnpj, STATUS_ASSINATURA, type EmpresaResumo, type StatusAssinatura } from '@etiquetas/shared';
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

  return (
    <>
      <Cabecalho
        titulo="Empresas"
        descricao="Clientes da plataforma. Ao cadastrar, é criado o perfil Administrador e o primeiro usuário."
        acoes={<Botao onClick={() => setEdicao({ modo: 'nova' })}>Nova empresa</Botao>}
      />
      {error && <Alerta>{error.message}</Alerta>}
      {!isLoading && (
        <Tabela colunas={['Empresa', 'CNPJ', 'Plano', 'Assinatura', 'Usuários', 'Criada em', '']} vazio={empresas.length === 0}>
          {empresas.map((e) => (
            <tr key={e.id} className={e.ativa ? '' : 'text-slate-400'}>
              <td className="px-4 py-2.5">
                <div className="font-medium">{e.nomeFantasia || e.razaoSocial}</div>
                {e.nomeFantasia && <div className="text-xs text-slate-500">{e.razaoSocial}</div>}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs">{formatarCnpj(e.cnpj)}</td>
              <td className="px-4 py-2.5">{e.plano}</td>
              <td className="px-4 py-2.5">
                <Selo cor={e.ativa ? COR_STATUS[e.statusAssinatura] : 'cinza'}>
                  {e.ativa ? ROTULO_STATUS[e.statusAssinatura] : 'Desativada'}
                </Selo>
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

function FormNovaEmpresa({ aoConcluir }: { aoConcluir: () => void }) {
  const cliente = useQueryClient();
  const [f, setF] = useState({ razaoSocial: '', nomeFantasia: '', cnpj: '', codigoErp: '', adminNome: '', adminEmail: '', adminSenha: '' });
  const mutacao = useMutation({
    mutationFn: () =>
      api<EmpresaResumo>('/empresas', {
        metodo: 'POST',
        corpo: {
          razaoSocial: f.razaoSocial,
          nomeFantasia: f.nomeFantasia || undefined,
          cnpj: f.cnpj,
          codigoErp: f.codigoErp || undefined,
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
      <Campo rotulo="Razão social" required {...campo('razaoSocial')} />
      <Campo rotulo="Nome fantasia" {...campo('nomeFantasia')} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="CNPJ" required placeholder="00.000.000/0000-00" {...campo('cnpj')} ajuda="Aceita CNPJ alfanumérico." />
        <Campo rotulo="Código no ERP" {...campo('codigoErp')} />
      </div>
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
  });
  const mutacao = useMutation({
    mutationFn: () => api<EmpresaResumo>(`/empresas/${empresa.id}`, { metodo: 'PATCH', corpo: f }),
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
      <Campo rotulo="Razão social" required value={f.razaoSocial} onChange={(e) => setF({ ...f, razaoSocial: e.target.value })} />
      <Campo rotulo="Nome fantasia" value={f.nomeFantasia} onChange={(e) => setF({ ...f, nomeFantasia: e.target.value })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="CNPJ" required value={f.cnpj} onChange={(e) => setF({ ...f, cnpj: e.target.value })} />
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
