import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ehConexaoSql,
  PORTA_PADRAO_BANCO,
  ROTULO_TIPO_CONEXAO,
  TIPOS_BANCO,
  TIPOS_CONEXAO,
  type AgenteResumo,
  type ConexaoBancoResumo,
  type ResultadoConsulta,
  type ResultadoTesteConexao,
  type TipoBanco,
  type TipoConexao,
} from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { ExigeEmpresa } from '../components/ExigeEmpresa';
import { TabelaResultado } from '../components/TabelaResultado';
import { Alerta, Botao, Cabecalho, Campo, Modal, Selecao, Selo, Tabela } from '../components/ui';

const OPCOES_SSL: Record<TipoBanco, { valor: string; rotulo: string }[]> = {
  POSTGRES: [
    { valor: '', rotulo: 'Preferir (padrão)' },
    { valor: 'disable', rotulo: 'Desligado' },
    { valor: 'require', rotulo: 'Obrigatório' },
    { valor: 'verify-full', rotulo: 'Obrigatório, validando certificado' },
  ],
  MYSQL: [
    { valor: '', rotulo: 'Preferir (padrão)' },
    { valor: 'true', rotulo: 'Obrigatório' },
    { valor: 'skip-verify', rotulo: 'Obrigatório, sem validar certificado' },
  ],
  SQLSERVER: [
    { valor: '', rotulo: 'Padrão do driver' },
    { valor: 'disable', rotulo: 'Desligado' },
    { valor: 'true', rotulo: 'Obrigatório' },
    { valor: 'skip-verify', rotulo: 'Obrigatório, sem validar certificado' },
  ],
};

export function Bancos() {
  return (
    <ExigeEmpresa>
      <ListaBancos />
    </ExigeEmpresa>
  );
}

function ListaBancos() {
  const { empresaId, pode } = useAuth();
  const podeEditar = pode('agente.editar');
  const podeConsultar = pode('sql.editar');
  const [edicao, setEdicao] = useState<{ conexao: ConexaoBancoResumo | null } | null>(null);
  const [consulta, setConsulta] = useState<ConexaoBancoResumo | null>(null);
  const [teste, setTeste] = useState<{ id: string; tipo: 'erro' | 'info'; texto: string } | null>(null);

  const { data: conexoes = [], isLoading, error } = useQuery({
    queryKey: ['conexoes', empresaId],
    queryFn: () => api<ConexaoBancoResumo[]>('/conexoes'),
  });
  const { data: agentes = [] } = useQuery({
    queryKey: ['agentes', empresaId],
    queryFn: () => api<AgenteResumo[]>('/agentes'),
  });
  const agentePorId = new Map(agentes.map((a) => [a.id, a]));

  const testar = useMutation({
    mutationFn: (c: ConexaoBancoResumo) => api<ResultadoTesteConexao>(`/conexoes/${c.id}/testar`, { metodo: 'POST' }),
    onMutate: () => setTeste(null),
    onSuccess: (r, c) => setTeste({ id: c.id, tipo: 'info', texto: `"${c.nome}" respondeu em ${r.duracaoMs} ms: ${r.versaoServidor}` }),
    onError: (e, c) => setTeste({ id: c.id, tipo: 'erro', texto: `"${c.nome}": ${e.message}` }),
  });

  return (
    <>
      <Cabecalho
        titulo="Conexões de dados"
        descricao="De onde vêm os produtos: bancos dos ERPs, planilhas numa pasta do computador do agente ou no Google Drive. Senhas e chaves ficam criptografadas no servidor."
        acoes={
          podeEditar && (
            <Botao onClick={() => setEdicao({ conexao: null })}>
              Nova conexão
            </Botao>
          )
        }
      />
      <div className="space-y-4">
        {error && <Alerta>{error.message}</Alerta>}
        {agentes.length === 0 && !isLoading && <Alerta tipo="info">Bancos e pastas do computador precisam de um agente: cadastre um em Agentes. O Google Drive não precisa.</Alerta>}
        <Alerta tipo="aviso">
          Use um usuário do banco com permissão <strong>somente de leitura</strong>. O agente também recusa comandos de escrita e
          desfaz qualquer transação, mas a permissão do usuário é a proteção principal.
        </Alerta>
        {teste && <Alerta tipo={teste.tipo}>{teste.texto}</Alerta>}
        {!isLoading && (
          <Tabela colunas={['Conexão', 'Tipo', 'Servidor', 'Banco ou pasta', 'Agente', '']} vazio={conexoes.length === 0}>
            {conexoes.map((c) => {
              const agente = c.agenteId ? agentePorId.get(c.agenteId) : undefined;
              const sql = ehConexaoSql(c.tipo);
              return (
                <tr key={c.id} className={c.ativo ? '' : 'text-slate-400'}>
                  <td className="px-4 py-2.5 font-medium">
                    {c.nome} {!c.ativo && <Selo cor="cinza">Desativada</Selo>}
                  </td>
                  <td className="px-4 py-2.5">{ROTULO_TIPO_CONEXAO[c.tipo]}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">
                    {sql ? (
                      <>
                        {c.host}
                        {c.opcoes.instancia ? `\\${c.opcoes.instancia}` : `:${c.porta}`}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div>{c.banco}</div>
                    <div className="text-xs text-slate-500">{c.usuario}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    {agente?.nome ?? (c.tipo === 'GOOGLE_DRIVE' ? 'Não usa' : '—')}{' '}
                    {agente && <Selo cor={agente.online ? 'verde' : 'vermelho'}>{agente.online ? 'Online' : 'Offline'}</Selo>}
                  </td>
                  <td className="space-x-2 whitespace-nowrap px-4 py-2.5 text-right">
                    <Botao variante="secundario" disabled={testar.isPending || !c.ativo} onClick={() => testar.mutate(c)}>
                      {testar.isPending && testar.variables?.id === c.id ? 'Testando…' : 'Testar'}
                    </Botao>
                    {podeConsultar && sql && (
                      <Botao variante="secundario" disabled={!c.ativo} onClick={() => setConsulta(c)}>
                        Consultar
                      </Botao>
                    )}
                    {podeEditar && (
                      <Botao variante="secundario" onClick={() => setEdicao({ conexao: c })}>
                        Editar
                      </Botao>
                    )}
                  </td>
                </tr>
              );
            })}
          </Tabela>
        )}
      </div>

      <Modal titulo={edicao?.conexao ? 'Editar conexão' : 'Nova conexão'} aberto={edicao !== null} aoFechar={() => setEdicao(null)}>
        {edicao && <FormConexao conexao={edicao.conexao} agentes={agentes} aoConcluir={() => setEdicao(null)} />}
      </Modal>
      <Modal titulo={`Consultar · ${consulta?.nome ?? ''}`} aberto={consulta !== null} aoFechar={() => setConsulta(null)} largo>
        {consulta && <ConsoleSql conexao={consulta} />}
      </Modal>
    </>
  );
}

function FormConexao({
  conexao,
  agentes,
  aoConcluir,
}: {
  conexao: ConexaoBancoResumo | null;
  agentes: AgenteResumo[];
  aoConcluir: () => void;
}) {
  const { empresaId } = useAuth();
  const cliente = useQueryClient();
  const [f, setF] = useState({
    agenteId: conexao?.agenteId ?? agentes.find((a) => a.ativo)?.id ?? '',
    nome: conexao?.nome ?? '',
    tipo: conexao?.tipo ?? ('POSTGRES' as TipoConexao),
    host: conexao?.host ?? '',
    porta: String(conexao?.porta ?? PORTA_PADRAO_BANCO.POSTGRES),
    banco: conexao?.tipo === 'GOOGLE_DRIVE' ? `https://drive.google.com/drive/folders/${conexao.banco}` : (conexao?.banco ?? ''),
    usuario: conexao?.usuario ?? '',
    senha: '',
    removerSenha: false,
    ssl: conexao?.opcoes.ssl ?? '',
    instancia: conexao?.opcoes.instancia ?? '',
    tempoLimiteSegundos: String(conexao?.opcoes.tempoLimiteSegundos ?? ''),
    ativo: conexao?.ativo ?? true,
  });

  const mutacao = useMutation({
    mutationFn: () => {
      if (!ehConexaoSql(f.tipo)) {
        const planilha = {
          nome: f.nome,
          tipo: f.tipo,
          banco: f.banco,
          agenteId: f.tipo === 'PASTA' ? f.agenteId : undefined,
          senha: f.tipo === 'GOOGLE_DRIVE' ? f.senha || undefined : undefined,
        };
        if (!conexao) return api('/conexoes', { metodo: 'POST', corpo: planilha });
        return api(`/conexoes/${conexao.id}`, { metodo: 'PATCH', corpo: { ...planilha, ativo: f.ativo } });
      }
      const corpo = {
        agenteId: f.agenteId,
        nome: f.nome,
        tipo: f.tipo,
        host: f.host,
        porta: Number(f.porta),
        banco: f.banco,
        usuario: f.usuario,
        senha: f.removerSenha ? '' : f.senha || undefined,
        opcoes: {
          ssl: f.ssl || undefined,
          instancia: f.tipo === 'SQLSERVER' ? f.instancia || undefined : undefined,
          tempoLimiteSegundos: f.tempoLimiteSegundos ? Number(f.tempoLimiteSegundos) : undefined,
        },
      };
      if (!conexao) return api('/conexoes', { metodo: 'POST', corpo });
      return api(`/conexoes/${conexao.id}`, { metodo: 'PATCH', corpo: { ...corpo, ativo: f.ativo } });
    },
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['conexoes', empresaId] });
      void cliente.invalidateQueries({ queryKey: ['agentes', empresaId] });
      aoConcluir();
    },
  });

  const excluir = useMutation({
    mutationFn: () => api(`/conexoes/${conexao!.id}`, { metodo: 'DELETE' }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['conexoes', empresaId] });
      aoConcluir();
    },
  });

  function trocarTipo(tipo: TipoConexao) {
    const portaEhPadrao = TIPOS_BANCO.some((t) => String(PORTA_PADRAO_BANCO[t]) === f.porta) || !f.porta;
    setF({ ...f, tipo, ssl: '', banco: '', senha: '', porta: ehConexaoSql(tipo) && portaEhPadrao ? String(PORTA_PADRAO_BANCO[tipo]) : f.porta });
  }

  async function lerChave(arquivo: File | undefined) {
    if (arquivo) setF({ ...f, senha: await arquivo.text() });
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    mutacao.mutate();
  }

  const erro = mutacao.error ?? excluir.error;

  return (
    <form onSubmit={enviar} className="space-y-3">
      {erro && <Alerta>{erro.message}</Alerta>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Nome" required placeholder="Ex.: ERP Loja Centro" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
        <Selecao rotulo="Tipo" value={f.tipo} disabled={conexao !== null && !ehConexaoSql(conexao.tipo)} onChange={(e) => trocarTipo(e.target.value as TipoConexao)}>
          {TIPOS_CONEXAO.filter((t) => !conexao || ehConexaoSql(conexao.tipo) === ehConexaoSql(t)).map((t) => (
            <option key={t} value={t}>{ROTULO_TIPO_CONEXAO[t]}</option>
          ))}
        </Selecao>
        {f.tipo !== 'GOOGLE_DRIVE' && (
          <Selecao rotulo="Agente" required value={f.agenteId} onChange={(e) => setF({ ...f, agenteId: e.target.value })}>
            <option value="">Selecione…</option>
            {agentes.map((a) => (
              <option key={a.id} value={a.id} disabled={!a.ativo}>
                {a.nome}
              </option>
            ))}
          </Selecao>
        )}
        {ehConexaoSql(f.tipo) && (
          <Selecao rotulo="Criptografia (SSL/TLS)" value={f.ssl} onChange={(e) => setF({ ...f, ssl: e.target.value })}>
            {OPCOES_SSL[f.tipo].map((o) => (
              <option key={o.valor} value={o.valor}>{o.rotulo}</option>
            ))}
          </Selecao>
        )}
      </div>
      {f.tipo === 'PASTA' && (
        <Campo
          rotulo="Pasta no computador do agente"
          required
          placeholder="C:\Planilhas\Etiquetas"
          value={f.banco}
          onChange={(e) => setF({ ...f, banco: e.target.value })}
          ajuda="Caminho completo. O agente lê os arquivos .csv, .xls e .xlsx dela e das subpastas, sem alterar nada. Como serviço do Windows, ele não enxerga unidades de rede mapeadas: use uma pasta local."
        />
      )}
      {f.tipo === 'GOOGLE_DRIVE' && (
        <>
          <Campo
            rotulo="Link da pasta do Google Drive"
            required
            placeholder="https://drive.google.com/drive/folders/…"
            value={f.banco}
            onChange={(e) => setF({ ...f, banco: e.target.value })}
            ajuda="São lidas as Planilhas Google, os .xlsx e os .csv que estiverem diretamente nesta pasta."
          />
          <label className="block text-sm font-medium text-slate-700">
            Chave da conta de serviço do Google (arquivo .json)
            <input type="file" accept=".json,application/json" onChange={(e) => void lerChave(e.target.files?.[0])} className="mt-1 block w-full text-sm font-normal" />
            <span className="mt-1 block text-xs font-normal text-slate-500">
              {f.senha ? 'Chave carregada: será gravada criptografada ao salvar.' : conexao?.temSenha ? 'Deixe sem arquivo para manter a chave gravada.' : 'Crie no Google Cloud: projeto com a API do Drive ativada > Contas de serviço > Chaves.'}
            </span>
          </label>
          {conexao?.usuario && (
            <Alerta tipo="info">
              Compartilhe a pasta do Drive com <strong className="break-all">{conexao.usuario}</strong> como Leitor.
            </Alerta>
          )}
        </>
      )}
      {ehConexaoSql(f.tipo) && (
      <>
      <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
        <Campo
          rotulo="Servidor"
          required
          placeholder="IP ou nome na rede da loja"
          value={f.host}
          onChange={(e) => setF({ ...f, host: e.target.value })}
          ajuda="Endereço visto a partir da máquina do agente (ex.: 192.168.0.10 ou localhost)."
        />
        <Campo rotulo="Porta" type="number" required min={1} max={65535} value={f.porta} onChange={(e) => setF({ ...f, porta: e.target.value })} />
      </div>
      {f.tipo === 'SQLSERVER' && (
        <Campo
          rotulo="Instância nomeada"
          placeholder="Ex.: SQLEXPRESS"
          value={f.instancia}
          onChange={(e) => setF({ ...f, instancia: e.target.value })}
          ajuda="Deixe em branco para a instância padrão."
        />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Banco de dados" required value={f.banco} onChange={(e) => setF({ ...f, banco: e.target.value })} />
        <Campo rotulo="Usuário" required autoComplete="off" value={f.usuario} onChange={(e) => setF({ ...f, usuario: e.target.value })} />
        <Campo
          rotulo="Senha"
          type="password"
          autoComplete="new-password"
          disabled={f.removerSenha}
          value={f.senha}
          onChange={(e) => setF({ ...f, senha: e.target.value })}
          ajuda={conexao?.temSenha ? 'Deixe em branco para manter a senha gravada.' : undefined}
        />
        <Campo
          rotulo="Tempo limite (segundos)"
          type="number"
          min={1}
          max={600}
          placeholder="30"
          value={f.tempoLimiteSegundos}
          onChange={(e) => setF({ ...f, tempoLimiteSegundos: e.target.value })}
        />
      </div>
      </>
      )}
      {conexao?.temSenha && ehConexaoSql(f.tipo) && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.removerSenha} onChange={(e) => setF({ ...f, removerSenha: e.target.checked, senha: '' })} />
          Remover a senha gravada
        </label>
      )}
      {conexao && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} />
          Conexão ativa
        </label>
      )}
      <div className="flex justify-between gap-2 pt-2">
        <div>
          {conexao && (
            <Botao
              variante="perigo"
              disabled={excluir.isPending}
              onClick={() => window.confirm(`Excluir a conexão "${conexao.nome}"?`) && excluir.mutate()}
            >
              Excluir
            </Botao>
          )}
        </div>
        <div className="flex gap-2">
          <Botao variante="secundario" onClick={aoConcluir}>Cancelar</Botao>
          <Botao type="submit" disabled={mutacao.isPending}>{mutacao.isPending ? 'Salvando…' : 'Salvar'}</Botao>
        </div>
      </div>
    </form>
  );
}

function ConsoleSql({ conexao }: { conexao: ConexaoBancoResumo }) {
  const [sql, setSql] = useState('SELECT 1 AS teste');
  const consultar = useMutation({
    mutationFn: () => api<ResultadoConsulta>(`/conexoes/${conexao.id}/consultar`, { metodo: 'POST', corpo: { sql, limiteLinhas: 100 } }),
  });
  const r = consultar.data;

  function enviar(e: FormEvent) {
    e.preventDefault();
    consultar.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            consultar.mutate();
          }
        }}
        rows={6}
        spellCheck={false}
        className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        aria-label="SQL"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">Somente leitura · até 100 linhas · Ctrl+Enter executa</span>
        <Botao type="submit" disabled={consultar.isPending || !sql.trim()}>{consultar.isPending ? 'Executando…' : 'Executar'}</Botao>
      </div>
      {consultar.error && <Alerta>{consultar.error.message}</Alerta>}
      {r && <TabelaResultado resultado={r} />}
    </form>
  );
}
