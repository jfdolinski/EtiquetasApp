import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { problemaNoWebhook, type ChaveApiCriada, type ChaveApiResumo, type EnvioWebhookResumo } from '@etiquetas/shared';
import { api } from '../../api';
import { Alerta, Botao, Campo, formatarData, Modal, Selo, Tabela } from '../../components/ui';

const endereco = () => `${window.location.origin}/api/integracao/entregas/v1`;

/**
 * Chaves da API para o sistema da empresa abrir chamadas e ver a situação, e o endereço que recebe
 * um aviso a cada mudança (webhook). A chave e o segredo só aparecem ao criar.
 */
export function Integracao() {
  const cliente = useQueryClient();
  const lista = useQuery({ queryKey: ['integracao-chaves'], queryFn: () => api<ChaveApiResumo[]>('/entregas/integracao/chaves'), refetchInterval: 30_000 });
  const guardar = (r: ChaveApiResumo[]) => cliente.setQueryData(['integracao-chaves'], r);
  const [criada, setCriada] = useState<ChaveApiCriada | null>(null);
  const [envios, setEnvios] = useState<ChaveApiResumo | null>(null);
  const [editando, setEditando] = useState<ChaveApiResumo | null>(null);
  const revogar = useMutation({ mutationFn: (id: string) => api<ChaveApiResumo[]>(`/entregas/integracao/chaves/${id}/revogar`, { metodo: 'POST' }), onSuccess: guardar });
  const testar = useMutation({ mutationFn: (id: string) => api<EnvioWebhookResumo>(`/entregas/integracao/chaves/${id}/testar`, { metodo: 'POST' }), onSuccess: () => void cliente.invalidateQueries({ queryKey: ['integracao-chaves'] }) });

  return (
    <div className="space-y-6">
      <div className="max-w-3xl space-y-2 text-sm text-slate-600">
        <p>
          Ligue o sistema da sua empresa (loja virtual, ERP, aplicativo próprio) ao Flow Entregas: com uma chave, ele abre chamadas, acompanha a situação e cancela. Informe também um endereço para receber um aviso a cada mudança da chamada (aceita, coletada, entregue, cancelada…).
        </p>
        <p>
          Endereço da API: <code className="rounded bg-slate-100 px-1">{endereco()}</code>. O manual com os exemplos está no repositório do Flow, em <code className="rounded bg-slate-100 px-1">docs/API-ENTREGAS.md</code>.
        </p>
      </div>
      <NovaChave
        aoCriar={(r) => {
          setCriada(r);
          void cliente.invalidateQueries({ queryKey: ['integracao-chaves'] });
        }}
      />
      {lista.error && <Alerta>{lista.error.message}</Alerta>}
      {revogar.error && <Alerta>{revogar.error.message}</Alerta>}
      {testar.error && <Alerta>{testar.error.message}</Alerta>}
      {testar.data && (testar.data.enviadoEm ? <Alerta tipo="info">Aviso de teste entregue (o endereço respondeu {testar.data.ultimoStatus}).</Alerta> : <Alerta>Aviso de teste não chegou: {testar.data.ultimoErro}</Alerta>)}
      {lista.data && (
        <Tabela colunas={['Nome', 'Chave', 'Avisos (webhook)', 'Último uso', '']} vazio={!lista.data.length}>
          {lista.data.map((c) => (
            <tr key={c.id} data-testid="chave-api">
              <td className="px-4 py-2.5">
                <div className="font-medium">{c.nome}</div>
                <div className="text-xs text-slate-500">
                  Criada em {formatarData(c.criadoEm)}
                  {c.criadoPor && ` por ${c.criadoPor}`}
                </div>
              </td>
              <td className="px-4 py-2.5">
                <code className="text-xs">{c.prefixo}…</code> {c.revogadaEm && <Selo cor="cinza">Revogada</Selo>}
              </td>
              <td className="max-w-xs px-4 py-2.5">
                <div className="truncate text-xs">{c.webhookUrl ?? <span className="text-slate-400">sem endereço</span>}</div>
                {c.webhookUrl && (
                  <div className="text-xs text-slate-500">
                    7 dias: {c.avisos.enviados} entregues{c.avisos.falharam ? `, ${c.avisos.falharam} falharam` : ''}
                    {c.avisos.esperando ? `, ${c.avisos.esperando} tentando` : ''}
                  </div>
                )}
              </td>
              <td className="px-4 py-2.5 text-xs text-slate-600">{c.ultimoUsoEm ? formatarData(c.ultimoUsoEm) : 'nunca'}</td>
              <td className="space-x-3 whitespace-nowrap px-4 py-2.5 text-right">
                {!c.revogadaEm && (
                  <>
                    <button type="button" className="text-blue-700 underline" onClick={() => setEditando(c)}>
                      Endereço do aviso
                    </button>
                    {c.webhookUrl && (
                      <button type="button" className="text-blue-700 underline" disabled={testar.isPending} onClick={() => testar.mutate(c.id)}>
                        {testar.isPending ? 'Testando…' : 'Testar aviso'}
                      </button>
                    )}
                  </>
                )}
                <button type="button" className="text-blue-700 underline" onClick={() => setEnvios(c)}>
                  Avisos enviados
                </button>
                {!c.revogadaEm && (
                  <button type="button" className="text-red-700 underline" onClick={() => confirm(`Revogar a chave "${c.nome}"? O sistema que usa esta chave para de funcionar na hora.`) && revogar.mutate(c.id)}>
                    Revogar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Tabela>
      )}
      {criada && <ChaveCriada c={criada} aoFechar={() => setCriada(null)} />}
      {envios && <EnviosDaChave c={envios} aoFechar={() => setEnvios(null)} />}
      {editando && (
        <EditarWebhook
          c={editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={(r) => {
            guardar(r);
            setEditando(null);
          }}
        />
      )}
    </div>
  );
}

function NovaChave({ aoCriar }: { aoCriar: (r: ChaveApiCriada) => void }) {
  const [nome, setNome] = useState('');
  const [url, setUrl] = useState('');
  const problema = problemaNoWebhook(url);
  const criar = useMutation({
    mutationFn: () => api<ChaveApiCriada>('/entregas/integracao/chaves', { metodo: 'POST', corpo: { nome, webhookUrl: url.trim() || null } }),
    onSuccess: (r) => {
      setNome('');
      setUrl('');
      aoCriar(r);
    },
  });
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <h2 className="text-base font-semibold">Nova chave</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <Campo rotulo="Nome (o sistema que vai usar)" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} placeholder="Ex.: Loja virtual" />
        <Campo rotulo="Endereço que recebe os avisos (opcional)" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." ajuda="Recebe um POST com a chamada a cada mudança de situação." />
      </div>
      {url && problema && <Alerta tipo="aviso">{problema}</Alerta>}
      {criar.error && <Alerta>{criar.error.message}</Alerta>}
      <Botao onClick={() => criar.mutate()} disabled={nome.trim().length < 3 || !!problema || criar.isPending}>
        {criar.isPending ? 'Criando…' : 'Criar chave'}
      </Botao>
    </section>
  );
}

function Copiavel({ rotulo, valor, testid }: { rotulo: string; valor: string; testid: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-slate-600">{rotulo}</div>
      <div className="flex gap-2">
        <code className="flex-1 break-all rounded bg-slate-100 px-2 py-1.5 text-xs" data-testid={testid}>
          {valor}
        </code>
        <Botao
          variante="secundario"
          onClick={() => {
            void navigator.clipboard?.writeText(valor).then(() => setCopiado(true));
          }}
        >
          {copiado ? 'Copiado' : 'Copiar'}
        </Botao>
      </div>
    </div>
  );
}

function ChaveCriada({ c, aoFechar }: { c: ChaveApiCriada; aoFechar: () => void }) {
  return (
    <Modal titulo={`Chave "${c.chave.nome}" criada`} aberto aoFechar={aoFechar}>
      <div className="space-y-4 text-sm">
        <Alerta tipo="aviso">Copie agora: a chave e o segredo não aparecem de novo. Guarde no sistema que vai usar, nunca em lugar público.</Alerta>
        <Copiavel rotulo="Chave da API (cabeçalho Authorization: Bearer …)" valor={c.token} testid="token-api" />
        <Copiavel rotulo="Segredo para conferir a assinatura dos avisos" valor={c.segredoWebhook} testid="segredo-webhook" />
        <Botao onClick={aoFechar}>Já copiei</Botao>
      </div>
    </Modal>
  );
}

function EditarWebhook({ c, aoFechar, aoSalvar }: { c: ChaveApiResumo; aoFechar: () => void; aoSalvar: (r: ChaveApiResumo[]) => void }) {
  const [url, setUrl] = useState(c.webhookUrl ?? '');
  const problema = problemaNoWebhook(url);
  const salvar = useMutation({ mutationFn: () => api<ChaveApiResumo[]>(`/entregas/integracao/chaves/${c.id}/webhook`, { metodo: 'POST', corpo: { webhookUrl: url.trim() || null } }), onSuccess: aoSalvar });
  return (
    <Modal titulo={`Avisos da chave "${c.nome}"`} aberto aoFechar={aoFechar}>
      <div className="space-y-3 text-sm">
        <Campo rotulo="Endereço que recebe os avisos" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." ajuda="Deixe vazio para parar os avisos. O segredo da assinatura continua o mesmo." />
        {url && problema && <Alerta tipo="aviso">{problema}</Alerta>}
        {salvar.error && <Alerta>{salvar.error.message}</Alerta>}
        <Botao onClick={() => salvar.mutate()} disabled={!!problema || salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </Botao>
      </div>
    </Modal>
  );
}

function EnviosDaChave({ c, aoFechar }: { c: ChaveApiResumo; aoFechar: () => void }) {
  const { data, error } = useQuery({ queryKey: ['integracao-envios', c.id], queryFn: () => api<EnvioWebhookResumo[]>(`/entregas/integracao/chaves/${c.id}/envios`), refetchInterval: 10_000 });
  return (
    <Modal titulo={`Avisos enviados: ${c.nome}`} aberto aoFechar={aoFechar} largo>
      {error && <Alerta>{error.message}</Alerta>}
      {data && (
        <Tabela colunas={['Quando', 'Aviso', 'Situação', 'Resultado']} vazio={!data.length}>
          {data.map((e) => (
            <tr key={e.id} data-testid="envio-webhook">
              <td className="px-4 py-2 text-xs">{formatarData(e.criadoEm)}</td>
              <td className="px-4 py-2 text-xs">{e.evento === 'teste' ? 'Teste' : `Chamada nº ${e.numero}`}</td>
              <td className="px-4 py-2 text-xs">{e.situacao ?? '—'}</td>
              <td className="px-4 py-2 text-xs">
                {e.enviadoEm ? <Selo cor="verde">Entregue</Selo> : e.falhouEm ? <Selo cor="vermelho">Desistiu</Selo> : <Selo cor="amarelo">Tentando</Selo>}{' '}
                {e.tentativas > 1 && `${e.tentativas} tentativas`} {e.ultimoErro && <span className="text-red-700">{e.ultimoErro}</span>}
              </td>
            </tr>
          ))}
        </Tabela>
      )}
    </Modal>
  );
}
