import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CodigoVinculoResposta, DispositivoResumo } from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { CodigoQr } from '../../components/CodigoQr';
import { Alerta, Botao, formatarData } from '../../components/ui';

/** Endereço lido pelo celular. O próprio site diz qual é o servidor: o usuário não digita nada. */
export function conteudoDoQr(servidor: string, codigo: string): string {
  return `etiquetas://vincular?servidor=${encodeURIComponent(servidor)}&codigo=${codigo}`;
}

export function AplicativoCelular() {
  const { usuario, empresaId } = useAuth();
  const cliente = useQueryClient();
  const chave = ['dispositivos'];
  const [vinculo, setVinculo] = useState<CodigoVinculoResposta | null>(null);
  const [agora, setAgora] = useState(Date.now());
  const urlApk = `${window.location.origin}/downloads/etiquetas-app.apk`;

  const { data: aparelhos = [], error } = useQuery({
    queryKey: chave,
    queryFn: () => api<DispositivoResumo[]>('/app/dispositivos'),
    // Enquanto o QR está na tela, o celular novo aparece sozinho na lista.
    refetchInterval: vinculo ? 3000 : false,
  });
  const quantosAoGerar = useState({ n: 0 })[0];

  const gerar = useMutation({
    mutationFn: () => api<CodigoVinculoResposta>('/app/vinculos', { metodo: 'POST' }),
    onSuccess: (r) => {
      quantosAoGerar.n = aparelhos.length;
      setVinculo(r);
    },
  });
  const desvincular = useMutation({
    mutationFn: (id: string) => api(`/app/dispositivos/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: chave }),
  });

  const restante = vinculo ? Math.max(0, Math.round((new Date(vinculo.expiraEm).getTime() - agora) / 1000)) : 0;
  useEffect(() => {
    if (!vinculo) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [vinculo]);
  useEffect(() => {
    if (vinculo && aparelhos.length > quantosAoGerar.n) setVinculo(null);
  }, [aparelhos.length, vinculo, quantosAoGerar]);

  const semEmpresa = usuario?.superAdmin && !empresaId;

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="font-medium">Aplicativo no celular</h2>
      <p className="text-sm text-slate-500">Receba os avisos, veja o Início e aprove a lista do dia pelo celular.</p>
      {(error ?? gerar.error ?? desvincular.error) && <Alerta>{(error ?? gerar.error ?? desvincular.error)!.message}</Alerta>}
      {semEmpresa && <Alerta tipo="aviso">Selecione uma empresa: o aplicativo vai operar nela.</Alerta>}

      <details className="text-sm">
        <summary className="cursor-pointer text-blue-700">1. Instalar o aplicativo (Android)</summary>
        <div className="mt-2 flex flex-wrap items-start gap-4">
          <CodigoQr texto={urlApk} tamanho={140} />
          <div className="max-w-xs space-y-1 text-slate-600">
            <p>Aponte a câmera do celular para este QR code e baixe o instalador, ou <a className="text-blue-700 underline" href={urlApk}>baixe aqui</a>.</p>
            <p>O Android vai pedir permissão para instalar de fora da Play Store. É só permitir para o navegador usado.</p>
          </div>
        </div>
      </details>

      <div className="space-y-2 text-sm">
        <p className="text-blue-700">2. Vincular a sua conta</p>
        {vinculo && restante > 0 ? (
          <div className="flex flex-wrap items-start gap-4">
            <CodigoQr texto={conteudoDoQr(window.location.origin, vinculo.codigo)} />
            <div className="space-y-1 text-slate-600">
              <p>Abra o aplicativo e leia este QR code.</p>
              <p>Sem câmera? Digite o endereço <span className="font-mono">{window.location.origin}</span> e o código:</p>
              <p className="font-mono text-lg tracking-wider text-slate-900">{vinculo.codigo}</p>
              <p className="text-xs">Vale por mais {Math.floor(restante / 60)}:{String(restante % 60).padStart(2, '0')} e funciona uma vez só.</p>
              <Botao variante="secundario" onClick={() => setVinculo(null)}>Fechar</Botao>
            </div>
          </div>
        ) : (
          <Botao disabled={gerar.isPending || Boolean(semEmpresa)} onClick={() => gerar.mutate()}>{gerar.isPending ? 'Gerando…' : 'Mostrar QR code'}</Botao>
        )}
      </div>

      {aparelhos.length > 0 && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {aparelhos.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate">{a.nome}</p>
                <p className="text-xs text-slate-500">
                  {a.plataforma === 'IOS' ? 'iPhone' : 'Android'} · último uso {formatarData(a.ultimoUsoEm)} · {a.recebeAvisos ? 'recebe avisos' : 'sem avisos com o app fechado'}
                </p>
              </div>
              <Botao
                variante="secundario"
                disabled={desvincular.isPending}
                onClick={() => window.confirm(`Desvincular ${a.nome}? O aplicativo deixa de funcionar nesse celular na hora.`) && desvincular.mutate(a.id)}
              >
                Desvincular
              </Botao>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
