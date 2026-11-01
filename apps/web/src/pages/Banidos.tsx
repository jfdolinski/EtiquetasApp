import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { normalizarCodigoBarras, type BanirResposta, type ProdutoBanidoResumo } from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { ExigeEmpresa } from '../components/ExigeEmpresa';
import { Alerta, Botao, Cabecalho, Campo, Tabela, formatarData } from '../components/ui';

export function Banidos() {
  return (
    <ExigeEmpresa>
      <ListaBanidos />
    </ExigeEmpresa>
  );
}

function ListaBanidos() {
  const { empresaId, pode } = useAuth();
  const podeEditar = pode('produto_banido.editar');
  const cliente = useQueryClient();
  const chave = ['banidos', empresaId];
  const [codigos, setCodigos] = useState('');
  const [motivo, setMotivo] = useState('');
  const [filtro, setFiltro] = useState('');
  const [resultado, setResultado] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set());

  const { data: banidos = [], isLoading, error } = useQuery({ queryKey: chave, queryFn: () => api<ProdutoBanidoResumo[]>('/banidos') });

  const visiveis = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    if (!f) return banidos;
    const codigo = normalizarCodigoBarras(f);
    return banidos.filter((b) => b.codigoBarras.includes(codigo) || (b.motivo ?? '').toLowerCase().includes(f));
  }, [banidos, filtro]);

  const banir = useMutation({
    mutationFn: () =>
      api<BanirResposta>('/banidos', {
        metodo: 'POST',
        corpo: { codigos: codigos.split(/[\s,;]+/).filter(Boolean), motivo: motivo || undefined },
      }),
    onSuccess: (r) => {
      setResultado(`${r.incluidos} código(s) banido(s).` + (r.jaBanidos ? ` ${r.jaBanidos} já estava(m) na lista.` : ''));
      setCodigos('');
      setMotivo('');
      void cliente.invalidateQueries({ queryKey: chave });
    },
  });
  const liberar = useMutation({
    mutationFn: (codigo: string) => api(`/banidos/${encodeURIComponent(codigo)}`, { metodo: 'DELETE' }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: chave }),
  });

  // Só o que está na tela conta: o filtro não deixa liberar o que a pessoa não está vendo.
  const selecionados = visiveis.filter((b) => marcados.has(b.codigoBarras)).map((b) => b.codigoBarras);
  const todosMarcados = visiveis.length > 0 && selecionados.length === visiveis.length;

  const liberarMarcados = useMutation({
    mutationFn: () => api<{ liberados: number }>('/banidos/liberar', { metodo: 'POST', corpo: { codigos: selecionados } }),
    onSuccess: (r) => {
      setResultado(`${r.liberados} código(s) liberado(s).`);
      setMarcados(new Set());
      void cliente.invalidateQueries({ queryKey: chave });
    },
  });

  function alternar(codigo: string) {
    const novos = new Set(marcados);
    if (!novos.delete(codigo)) novos.add(codigo);
    setMarcados(novos);
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    setResultado(null);
    banir.mutate();
  }

  return (
    <>
      <Cabecalho
        titulo="Produtos banidos"
        descricao="Estes códigos de barras não saem em etiqueta nenhuma desta empresa: lista do dia, etiqueta avulsa e agendamentos deixam o produto de fora."
      />
      <div className="space-y-4">
        {(error ?? banir.error ?? liberar.error ?? liberarMarcados.error) && <Alerta>{(error ?? banir.error ?? liberar.error ?? liberarMarcados.error)!.message}</Alerta>}
        {resultado && <Alerta tipo="info">{resultado}</Alerta>}
        {podeEditar && (
          <form onSubmit={enviar} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
            <label className="block text-sm font-medium text-slate-700">
              Códigos de barras
              <textarea
                required
                rows={3}
                value={codigos}
                onChange={(e) => setCodigos(e.target.value)}
                placeholder="Um ou vários, separados por espaço, vírgula ou linha"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm font-normal"
              />
            </label>
            <Campo rotulo="Motivo (opcional)" value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} />
            <div className="flex justify-end">
              <Botao type="submit" disabled={banir.isPending || !codigos.trim()}>{banir.isPending ? 'Salvando…' : 'Banir'}</Botao>
            </div>
          </form>
        )}
        {banidos.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Procurar por código ou motivo…"
              aria-label="Procurar por código ou motivo"
              className="w-72 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
            {podeEditar && (
              <>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={todosMarcados} onChange={() => setMarcados(todosMarcados ? new Set() : new Set(visiveis.map((b) => b.codigoBarras)))} />
                  Marcar todos
                </label>
                <Botao
                  variante="secundario"
                  disabled={selecionados.length === 0 || liberarMarcados.isPending}
                  onClick={() => window.confirm(`Liberar ${selecionados.length} código(s)? As etiquetas deles voltam a ser impressas.`) && liberarMarcados.mutate()}
                >
                  Liberar selecionados{selecionados.length ? ` (${selecionados.length})` : ''}
                </Botao>
              </>
            )}
          </div>
        )}
        {!isLoading && (
          <Tabela colunas={['Código de barras', 'Motivo', 'Banido por', 'Em', '']} vazio={visiveis.length === 0}>
            {visiveis.map((b) => (
              <tr key={b.codigoBarras}>
                <td className="px-4 py-2.5 font-mono text-sm">
                  {podeEditar && <input type="checkbox" className="mr-2" aria-label={`Selecionar ${b.codigoBarras}`} checked={marcados.has(b.codigoBarras)} onChange={() => alternar(b.codigoBarras)} />}
                  {b.codigoBarras}
                </td>
                <td className="px-4 py-2.5">{b.motivo ?? '—'}</td>
                <td className="px-4 py-2.5 text-slate-500">{b.criadoPor ?? '—'}</td>
                <td className="px-4 py-2.5 text-slate-500">{formatarData(b.criadoEm)}</td>
                <td className="px-4 py-2.5 text-right">
                  {podeEditar && (
                    <Botao
                      variante="secundario"
                      disabled={liberar.isPending}
                      onClick={() => window.confirm(`Liberar o código ${b.codigoBarras}? As etiquetas dele voltam a ser impressas.`) && liberar.mutate(b.codigoBarras)}
                    >
                      Liberar
                    </Botao>
                  )}
                </td>
              </tr>
            ))}
          </Tabela>
        )}
      </div>
    </>
  );
}
