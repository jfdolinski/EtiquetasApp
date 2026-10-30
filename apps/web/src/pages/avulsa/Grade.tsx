import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  alterarEmMassa,
  COLUNA_QUANTIDADE,
  colunaNumerica,
  filtrarLinhas,
  normalizarEntrada,
  OPERACOES_NUMERICAS,
  ordenarLinhas,
  QUANTIDADE_MAXIMA_ITEM,
  ROTULO_OPERACAO,
  textoCelula,
  type Direcao,
  type LinhaAvulsa,
  type OperacaoMassa,
} from '@etiquetas/shared';
import { Alerta, Botao } from '../../components/ui';

const CLASSE_ENTRADA = 'w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-slate-300 focus:border-blue-500 focus:bg-white focus:outline-none';

interface Props {
  linhas: LinhaAvulsa[];
  colunas: string[];
  /** Troca a lista guardando a anterior para desfazer. */
  alterar: (novas: LinhaAvulsa[]) => void;
  /** Troca sem histórico (digitação em andamento). */
  substituir: (novas: LinhaAvulsa[]) => void;
  /** Guarda uma versão anterior no histórico (edição de célula terminada). */
  lembrar: (antes: LinhaAvulsa[]) => void;
  podeDesfazer: boolean;
  desfazer: () => void;
  novaLinha: () => void;
  focarId: string | null;
  /** Abaixo da grade, com as linhas visíveis (a impressão usa as mesmas). */
  rodape?: (visiveis: LinhaAvulsa[]) => ReactNode;
}

/**
 * Grade editável da etiqueta avulsa: filtro geral e por coluna, ordenação pelo cabeçalho,
 * edição na célula, seleção, exclusão, duplicação e alteração em massa.
 */
export function Grade({ linhas, colunas, alterar, substituir, lembrar, podeDesfazer, desfazer, novaLinha, focarId, rodape }: Props) {
  const [busca, setBusca] = useState('');
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  const [ordem, setOrdem] = useState<{ coluna: string; direcao: Direcao } | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [massaAberta, setMassaAberta] = useState(false);

  const visiveis = useMemo(() => filtrarLinhas(linhas, colunas, busca, filtros), [linhas, colunas, busca, filtros]);

  // Cada coluna na largura do maior valor (de 8 a 42 caracteres), para não cortar a descrição.
  const larguras = useMemo(
    () => Object.fromEntries(colunas.map((c) => [c, Math.min(42, Math.max(8, c.length + 3, ...linhas.map((l) => textoCelula(l.registro[c]).length + 2)))])),
    [linhas, colunas],
  );
  const idsVisiveis = new Set(visiveis.map((l) => l.id));
  const selecionadasVisiveis = [...selecionadas].filter((id) => idsVisiveis.has(id));
  const todasMarcadas = visiveis.length > 0 && selecionadasVisiveis.length === visiveis.length;
  const filtrando = busca.trim() !== '' || Object.values(filtros).some((f) => f.trim() !== '');

  // Desfazer por célula: guarda a lista ao entrar no campo e registra ao sair, se mudou.
  const antesDaEdicao = useRef<LinhaAvulsa[] | null>(null);
  const atual = useRef(linhas);
  atual.current = linhas;

  function editar(id: string, mudar: (l: LinhaAvulsa) => LinhaAvulsa) {
    substituir(atual.current.map((l) => (l.id === id ? mudar(l) : l)));
  }
  function comecarEdicao() {
    antesDaEdicao.current = atual.current;
  }
  function terminarEdicao(id: string, coluna?: string) {
    if (coluna) {
      // "5,49" vira "5.49" ao sair da célula (os formatos de moeda do modelo entendem).
      const l = atual.current.find((x) => x.id === id);
      const v = l?.registro[coluna];
      if (l && typeof v === 'string' && normalizarEntrada(v) !== v) editar(id, (x) => ({ ...x, registro: { ...x.registro, [coluna]: normalizarEntrada(v) } }));
    }
    const antes = antesDaEdicao.current;
    antesDaEdicao.current = null;
    if (antes && antes !== atual.current) lembrar(antes);
  }

  // Como numa planilha: ordenar reorganiza a lista uma vez (dá para desfazer). Ordem "ao
  // vivo" faria a linha pular de lugar enquanto o preço é digitado.
  function alternarOrdem(coluna: string) {
    const direcao: Direcao = ordem?.coluna === coluna && ordem.direcao === 'asc' ? 'desc' : 'asc';
    setOrdem({ coluna, direcao });
    alterar(ordenarLinhas(linhas, coluna, direcao));
  }

  function marcar(id: string, sim: boolean) {
    setSelecionadas((s) => {
      const n = new Set(s);
      if (sim) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  function excluir(ids: string[]) {
    const fora = new Set(ids);
    alterar(linhas.filter((l) => !fora.has(l.id)));
    setSelecionadas((s) => new Set([...s].filter((id) => !fora.has(id))));
  }

  function duplicar(l: LinhaAvulsa) {
    const i = linhas.findIndex((x) => x.id === l.id);
    const copia = { ...l, id: crypto.randomUUID(), registro: { ...l.registro } };
    alterar([...linhas.slice(0, i + 1), copia, ...linhas.slice(i + 1)]);
  }

  const seta = (c: string) => (ordem?.coluna === c ? (ordem.direcao === 'asc' ? ' ▲' : ' ▼') : '');
  const cabecalho = (c: string, rotulo: string, classe = '') => (
    <th key={c} className={`px-2 py-2 text-left font-medium text-slate-600 ${classe}`}>
      <button type="button" onClick={() => alternarOrdem(c)} className="whitespace-nowrap hover:text-blue-700" title="Ordenar a lista por esta coluna (clique de novo para inverter)">
        {rotulo}
        <span className="text-blue-700">{seta(c)}</span>
      </button>
    </th>
  );
  const filtroColuna = (c: string) => (
    <th key={c} className="px-2 pb-2">
      <input
        value={filtros[c] ?? ''}
        onChange={(e) => setFiltros({ ...filtros, [c]: e.target.value })}
        placeholder="filtrar…"
        title="Texto contido; !texto = não contém; >10, <5, >=, <=, = para números"
        className="w-full min-w-16 rounded border border-slate-300 px-1.5 py-0.5 text-xs font-normal"
      />
    </th>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Filtrar em todas as colunas…"
          className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          aria-label="Filtrar em todas as colunas"
        />
        <Botao variante="secundario" onClick={() => setMostrarFiltros(!mostrarFiltros)} aria-pressed={mostrarFiltros}>
          Filtros por coluna
        </Botao>
        {filtrando && (
          <button type="button" className="text-sm text-blue-700 hover:underline" onClick={() => (setBusca(''), setFiltros({}))}>
            Limpar filtros
          </button>
        )}
        <span className="mx-1 h-5 w-px bg-slate-300" />
        <Botao variante="secundario" onClick={novaLinha} disabled={colunas.length === 0}>
          + Nova linha
        </Botao>
        <Botao variante="secundario" onClick={() => setMassaAberta(!massaAberta)} aria-pressed={massaAberta} disabled={linhas.length === 0}>
          Alterar em massa
        </Botao>
        <Botao variante="secundario" onClick={() => excluir(selecionadasVisiveis)} disabled={selecionadasVisiveis.length === 0}>
          Excluir selecionadas{selecionadasVisiveis.length ? ` (${selecionadasVisiveis.length})` : ''}
        </Botao>
        <Botao variante="secundario" onClick={desfazer} disabled={!podeDesfazer} title="Desfaz a última alteração da lista">
          ↶ Desfazer
        </Botao>
        <span className="ml-auto text-xs text-slate-500">
          {filtrando ? `${visiveis.length} de ${linhas.length} linhas` : `${linhas.length} linha(s)`}
          {selecionadasVisiveis.length > 0 && ` · ${selecionadasVisiveis.length} selecionada(s)`}
        </span>
      </div>

      {massaAberta && (
        <AlteracaoEmMassa
          linhas={linhas}
          colunas={colunas}
          alvo={selecionadasVisiveis.length ? selecionadasVisiveis : visiveis.map((l) => l.id)}
          porSelecao={selecionadasVisiveis.length > 0}
          aplicar={alterar}
          fechar={() => setMassaAberta(false)}
        />
      )}

      <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr>
              <th className="w-8 px-2 py-2">
                <input
                  type="checkbox"
                  checked={todasMarcadas}
                  onChange={(e) => setSelecionadas(e.target.checked ? new Set([...selecionadas, ...idsVisiveis]) : new Set([...selecionadas].filter((id) => !idsVisiveis.has(id))))}
                  aria-label="Selecionar todas as linhas visíveis"
                />
              </th>
              {cabecalho(COLUNA_QUANTIDADE, 'Etiquetas', 'w-24')}
              {colunas.map((c) => cabecalho(c, c))}
              <th className="w-20 px-2 py-2" />
            </tr>
            {mostrarFiltros && (
              <tr>
                <th />
                {filtroColuna(COLUNA_QUANTIDADE)}
                {colunas.map(filtroColuna)}
                <th />
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visiveis.map((l) => (
              <tr key={l.id} className={selecionadas.has(l.id) ? 'bg-blue-50' : l.quantidade === 0 ? 'text-slate-400' : ''}>
                <td className="px-2 py-1">
                  <input type="checkbox" checked={selecionadas.has(l.id)} onChange={(e) => marcar(l.id, e.target.checked)} aria-label="Selecionar linha" />
                </td>
                <td className="px-2 py-1">
                  <input
                    type="number"
                    min={0}
                    max={QUANTIDADE_MAXIMA_ITEM}
                    value={l.quantidade}
                    onFocus={comecarEdicao}
                    onBlur={() => terminarEdicao(l.id)}
                    onChange={(e) => {
                      const q = Math.max(0, Math.min(QUANTIDADE_MAXIMA_ITEM, Math.floor(e.target.valueAsNumber || 0)));
                      editar(l.id, (x) => ({ ...x, quantidade: q }));
                    }}
                    className="w-20 rounded border border-slate-300 px-2 py-1 text-slate-900"
                    aria-label="Quantidade de etiquetas"
                  />
                </td>
                {colunas.map((c, i) => (
                  <td key={c} className="px-1 py-0.5">
                    <input
                      autoFocus={focarId === l.id && i === 0}
                      value={textoCelula(l.registro[c])}
                      onFocus={comecarEdicao}
                      onBlur={() => terminarEdicao(l.id, c)}
                      onChange={(e) => editar(l.id, (x) => ({ ...x, registro: { ...x.registro, [c]: e.target.value } }))}
                      className={CLASSE_ENTRADA}
                      style={{ width: `${larguras[c]}ch` }}
                      aria-label={c}
                    />
                  </td>
                ))}
                <td className="px-2 py-1 whitespace-nowrap text-right">
                  <button type="button" onClick={() => duplicar(l)} className="px-1 text-slate-500 hover:text-blue-700" title="Duplicar linha" aria-label="Duplicar linha">
                    ⧉
                  </button>
                  <button type="button" onClick={() => excluir([l.id])} className="px-1 text-slate-500 hover:text-red-700" title="Apagar linha" aria-label="Apagar linha">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {visiveis.length === 0 && (
              <tr>
                <td colSpan={colunas.length + 3} className="px-4 py-6 text-center text-slate-500">
                  {linhas.length === 0 ? 'A lista está vazia. Busque um produto ou clique em “+ Nova linha”.' : 'Nenhuma linha passa nos filtros.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rodape?.(visiveis)}
    </div>
  );
}

const OPERACOES_TEXTO: OperacaoMassa[] = ['definir', 'limpar', 'substituir', 'prefixo', 'sufixo', 'maiusculas', 'minusculas'];

function AlteracaoEmMassa({
  linhas,
  colunas,
  alvo,
  porSelecao,
  aplicar,
  fechar,
}: {
  linhas: LinhaAvulsa[];
  colunas: string[];
  alvo: string[];
  porSelecao: boolean;
  aplicar: (novas: LinhaAvulsa[]) => void;
  fechar: () => void;
}) {
  const [coluna, setColuna] = useState(colunas[0] ?? COLUNA_QUANTIDADE);
  const [op, setOp] = useState<OperacaoMassa>('definir');
  const [valor, setValor] = useState('');
  const [por, setPor] = useState('');
  const [resultado, setResultado] = useState<{ tipo: 'info' | 'aviso' | 'erro'; texto: string } | null>(null);

  const quantidade = coluna === COLUNA_QUANTIDADE;
  const numerica = colunaNumerica(linhas, coluna);
  const operacoes: OperacaoMassa[] = quantidade ? ['definir', 'limpar', ...OPERACOES_NUMERICAS] : numerica ? [...OPERACOES_TEXTO, ...OPERACOES_NUMERICAS] : OPERACOES_TEXTO;
  const opValida = operacoes.includes(op) ? op : 'definir';
  const precisaValor = !['limpar', 'maiusculas', 'minusculas'].includes(opValida);

  function executar() {
    const r = alterarEmMassa(linhas, new Set(alvo), coluna, opValida, valor, por);
    if (r.erro) return setResultado({ tipo: 'erro', texto: r.erro });
    if (r.alteradas) aplicar(r.linhas);
    setResultado({
      tipo: r.ignoradas ? 'aviso' : 'info',
      texto: `${r.alteradas} linha(s) alterada(s).` + (r.ignoradas ? ` ${r.ignoradas} ignorada(s): o valor não é número.` : ''),
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-blue-900">
          Alterar em massa: {alvo.length} linha(s) {porSelecao ? 'selecionada(s)' : filtrandoTexto(alvo.length, linhas.length)}
        </span>
        <button type="button" onClick={fechar} className="text-sm text-blue-700 hover:underline">Fechar</button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600">
          Coluna
          <select value={coluna} onChange={(e) => (setColuna(e.target.value), setResultado(null))} className="mt-0.5 block rounded border border-slate-300 bg-white px-2 py-1.5 text-sm">
            <option value={COLUNA_QUANTIDADE}>Quantidade de etiquetas</option>
            {colunas.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Operação
          <select value={opValida} onChange={(e) => (setOp(e.target.value as OperacaoMassa), setResultado(null))} className="mt-0.5 block rounded border border-slate-300 bg-white px-2 py-1.5 text-sm">
            {operacoes.map((o) => (
              <option key={o} value={o}>{ROTULO_OPERACAO[o]}</option>
            ))}
          </select>
        </label>
        {precisaValor && (
          <label className="text-xs text-slate-600">
            {opValida === 'substituir' ? 'Procurar' : OPERACOES_NUMERICAS.includes(opValida) || quantidade ? 'Número' : 'Valor'}
            <input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && executar()}
              className="mt-0.5 block w-40 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
            />
          </label>
        )}
        {opValida === 'substituir' && (
          <label className="text-xs text-slate-600">
            Trocar por
            <input value={por} onChange={(e) => setPor(e.target.value)} className="mt-0.5 block w-40 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm" />
          </label>
        )}
        <Botao onClick={executar} disabled={alvo.length === 0}>Aplicar</Botao>
      </div>
      {resultado && <Alerta tipo={resultado.tipo}>{resultado.texto} {resultado.tipo !== 'erro' && 'Use “Desfazer” para voltar.'}</Alerta>}
      {!porSelecao && <p className="text-xs text-slate-600">Dica: marque linhas para alterar só elas; sem seleção, vale para todas as linhas visíveis.</p>}
    </div>
  );
}

function filtrandoTexto(alvo: number, total: number) {
  return alvo === total ? '(todas)' : '(as visíveis pelo filtro)';
}
