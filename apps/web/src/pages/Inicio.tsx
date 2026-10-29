import { formatarCnpj } from '@etiquetas/shared';
import { useAuth } from '../auth';
import { Cabecalho } from '../components/ui';

export function Inicio() {
  const { usuario } = useAuth();
  if (!usuario) return null;

  return (
    <>
      <Cabecalho titulo={`Olá, ${usuario.nome.split(' ')[0]}`} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {usuario.empresa && (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Empresa</div>
            <div className="mt-1 font-medium">{usuario.empresa.nomeFantasia || usuario.empresa.razaoSocial}</div>
            <div className="text-sm text-slate-500">CNPJ {formatarCnpj(usuario.empresa.cnpj)}</div>
          </div>
        )}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Perfil</div>
          <div className="mt-1 font-medium">{usuario.superAdmin ? 'Super-admin da plataforma' : (usuario.perfil?.nome ?? 'Sem perfil')}</div>
          {!usuario.superAdmin && <div className="text-sm text-slate-500">{usuario.permissoes.length} permissões</div>}
        </div>
      </div>
      <p className="mt-8 text-sm text-slate-500">
        A lista de etiquetas do dia aparece aqui a partir da Fase 5.
      </p>
    </>
  );
}
