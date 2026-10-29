import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatarCnpj, type CopiaModeloResultado, type EmpresaResumo, type ModeloEtiquetaResumo, type ModeloExportado } from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Alerta, Botao } from '../../components/ui';

function baixarJson(nome: string, dados: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nome.replace(/[\\/:*?"<>|]+/g, '_')}.etiqueta.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exportarModelo(m: ModeloEtiquetaResumo) {
  baixarJson(m.nome, await api<ModeloExportado>(`/modelos/${m.id}/exportar`));
}

/** Botão + resultado da importação de um arquivo exportado (de outra empresa). */
export function ImportarModelo() {
  const { empresaId } = useAuth();
  const cliente = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const importar = useMutation({
    mutationFn: async (arquivo: File) => {
      let dados: unknown;
      try {
        dados = JSON.parse(await arquivo.text());
      } catch {
        throw new Error('O arquivo não é um JSON válido.');
      }
      return api<{ modelo: ModeloEtiquetaResumo; avisos: string[] }>('/modelos/importar', { metodo: 'POST', corpo: { arquivo: dados } });
    },
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['modelos', empresaId] }),
  });

  return (
    <div className="space-y-2">
      <input
        ref={entrada}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importar.mutate(f);
          e.target.value = '';
        }}
      />
      <Botao variante="secundario" disabled={importar.isPending} onClick={() => entrada.current?.click()}>
        {importar.isPending ? 'Importando…' : 'Importar modelo'}
      </Botao>
      {importar.error && <Alerta>{importar.error.message}</Alerta>}
      {importar.data && (
        <Alerta tipo={importar.data.avisos.length ? 'aviso' : 'info'}>
          Modelo “{importar.data.modelo.nome}” importado.
          {importar.data.avisos.map((a) => (
            <div key={a}>{a}</div>
          ))}
        </Alerta>
      )}
    </div>
  );
}

/** Super-admin: copia o modelo da empresa atual para outras empresas. */
export function CopiarParaEmpresas({ modelo, aoFechar }: { modelo: ModeloEtiquetaResumo; aoFechar: () => void }) {
  const { empresaId } = useAuth();
  const { data: empresas = [] } = useQuery({ queryKey: ['empresas'], queryFn: () => api<EmpresaResumo[]>('/empresas') });
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [filtro, setFiltro] = useState('');
  const copiar = useMutation({
    mutationFn: () => api<CopiaModeloResultado[]>(`/modelos/${modelo.id}/copiar`, { metodo: 'POST', corpo: { empresaIds: [...marcadas] } }),
  });
  const destinos = empresas.filter(
    (e) => e.id !== empresaId && `${e.razaoSocial} ${e.nomeFantasia ?? ''} ${e.cnpj}`.toLowerCase().includes(filtro.toLowerCase()),
  );

  if (copiar.data) {
    return (
      <div className="space-y-3">
        <ul className="divide-y divide-slate-100 text-sm">
          {copiar.data.map((r) => (
            <li key={r.empresaId} className="py-2">
              <strong>{r.empresaNome}</strong>: {r.erro ? <span className="text-red-700">{r.erro}</span> : <>copiado como “{r.nome}”</>}
              {r.avisos.map((a) => (
                <div key={a} className="text-xs text-amber-800">{a}</div>
              ))}
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <Botao onClick={aoFechar}>Concluir</Botao>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        O layout é copiado e a consulta é vinculada à equivalente de cada empresa (mesmo template do ERP ou mesmo nome). Impressora e lista do dia ficam para
        cada empresa definir.
      </p>
      {copiar.error && <Alerta>{copiar.error.message}</Alerta>}
      <input
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        placeholder="Filtrar empresas"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <div className="max-h-72 overflow-auto rounded border border-slate-200">
        {destinos.map((e) => (
          <label key={e.id} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-0">
            <input
              type="checkbox"
              checked={marcadas.has(e.id)}
              onChange={(ev) => {
                const n = new Set(marcadas);
                if (ev.target.checked) n.add(e.id);
                else n.delete(e.id);
                setMarcadas(n);
              }}
            />
            {e.nomeFantasia || e.razaoSocial}
            <span className="font-mono text-xs text-slate-400">{formatarCnpj(e.cnpj)}</span>
          </label>
        ))}
        {destinos.length === 0 && <p className="px-3 py-4 text-sm text-slate-500">Nenhuma outra empresa.</p>}
      </div>
      <div className="flex justify-end gap-2">
        <Botao variante="secundario" onClick={aoFechar}>Cancelar</Botao>
        <Botao disabled={copiar.isPending || marcadas.size === 0} onClick={() => copiar.mutate()}>
          {copiar.isPending ? 'Copiando…' : `Copiar para ${marcadas.size} empresa(s)`}
        </Botao>
      </div>
    </div>
  );
}
