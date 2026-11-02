import { useQuery } from '@tanstack/react-query';
import { textoDuracao, type SaudeSistema, type SituacaoServidor } from '@etiquetas/shared';
import { api } from '../api';
import { Alerta, Cabecalho, Selo, Tabela, formatarData } from '../components/ui';

const tamanho = (bytes: number) => (bytes >= 1_073_741_824 ? `${(bytes / 1_073_741_824).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1_048_576))} MB`);

function Cartao({ rotulo, valor, detalhe }: { rotulo: string; valor: string | number; detalhe?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{rotulo}</p>
      <p className="mt-1 text-2xl font-semibold">{valor}</p>
      {detalhe && <p className="mt-1 text-xs text-slate-500">{detalhe}</p>}
    </div>
  );
}

/** Acima disto o relógio merece atenção: a medição tem a demora da rede e o cabeçalho Date só tem segundos. */
const TOLERANCIA_MS = 5000;

/** Os relógios lidos no mesmo instante, comparados com o da API. O site responde pelo cabeçalho Date. */
async function lerRelogios() {
  const [situacao, site] = await Promise.all([api<SituacaoServidor>('/health'), fetch('/index.html', { method: 'HEAD', cache: 'no-store' })]);
  const navegador = Date.now();
  const dataSite = site.headers.get('date');
  return { ...situacao.horarios, site: dataSite ? new Date(dataSite).getTime() : null, navegador };
}

function Relogios() {
  const { data: r } = useQuery({ queryKey: ['saude-relogios'], queryFn: lerRelogios, refetchInterval: 30_000 });
  if (!r) return null;
  const api_ = new Date(r.api).getTime();
  const linhas: { nome: string; ms: number | null; detalhe?: string }[] = [
    { nome: 'API', ms: api_, detalhe: `Fuso do sistema: ${r.fusoSistema}` },
    { nome: 'Banco de dados', ms: new Date(r.banco).getTime(), detalhe: `Fuso da sessão: ${r.fusoBanco}` },
    { nome: 'Site', ms: r.site },
    { nome: 'Este computador', ms: r.navegador, detalhe: 'Não afeta o sistema: o relógio das telas vem do servidor.' },
  ];
  const formato = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone: r.fusoSistema });
  return (
    <>
      <h2 className="font-medium">Relógios</h2>
      <Tabela colunas={['Onde', `Data e hora (${r.fusoSistema})`, 'Diferença da API', '']} vazio={false}>
        {linhas.map((l) => {
          const diferenca = l.ms === null ? null : l.ms - api_;
          return (
            <tr key={l.nome}>
              <td className="px-4 py-2.5">
                <div className="font-medium">{l.nome}</div>
                {l.detalhe && <div className="text-xs text-slate-500">{l.detalhe}</div>}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{l.ms === null ? 'Não informado' : formato.format(l.ms)}</td>
              <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{diferenca === null ? '—' : `${(diferenca / 1000).toFixed(1).replace('.', ',')} s`}</td>
              <td className="px-4 py-2.5">{diferenca !== null && (Math.abs(diferenca) <= TOLERANCIA_MS ? <Selo cor="verde">Certo</Selo> : <Selo cor="amarelo">Confira</Selo>)}</td>
            </tr>
          );
        })}
      </Tabela>
    </>
  );
}

/** Situação do servidor para o super-admin. Quando a API cai, quem avisa é o monitor do GitHub (docs/DEPLOY.md). */
export function Saude() {
  const { data: s, error, isLoading } = useQuery({ queryKey: ['saude'], queryFn: () => api<SaudeSistema>('/sistema/saude'), refetchInterval: 30_000 });

  return (
    <>
      <Cabecalho titulo="Saúde do sistema" descricao="Situação do servidor, do banco e dos erros inesperados." />
      {error && <Alerta>{error.message}</Alerta>}
      {isLoading && <p className="text-sm text-slate-500">Carregando…</p>}
      {s && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Cartao rotulo="API no ar há" valor={textoDuracao(s.noArHaSegundos * 1000)} detalhe={`${s.memoriaMb} MB de memória`} />
            <Cartao rotulo="Erros nas últimas 24 h" valor={s.erros24h} />
            <Cartao rotulo="Fila de impressão" valor={s.filaImpressao} detalhe="trabalhos aguardando" />
            <Cartao rotulo="Agentes online" valor={`${s.agentes.online} de ${s.agentes.ativados}`} />
            <Cartao rotulo="Tamanho do banco" valor={tamanho(s.bancoBytes)} />
            <Cartao rotulo="E-mail" valor={s.emailConfigurado ? 'Configurado' : 'Não configurado'} detalhe="SMTP_HOST" />
            <Cartao rotulo="Avisos no celular" valor={s.pushConfigurado ? 'Configurado' : 'Não configurado'} detalhe="FCM_CONTA_SERVICO" />
            <Cartao
              rotulo="Última faxina"
              valor={s.ultimaFaxina ? formatarData(s.ultimaFaxina.em) : 'Ainda não rodou'}
              detalhe={s.ultimaFaxina ? (s.ultimaFaxina.erro ?? `${s.ultimaFaxina.conteudos} conteúdo(s), ${s.ultimaFaxina.auditoria} de auditoria, ${s.ultimaFaxina.listas} lista(s)`) : `Conteúdo fica ${s.retencao.conteudoDias} dias, auditoria ${s.retencao.auditoriaDias}`}
            />
          </div>

          <Relogios />

          <h2 className="font-medium">Erros recentes</h2>
          <Tabela colunas={['Quando', 'Rota', 'Mensagem']} vazio={s.erros.length === 0}>
            {s.erros.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{formatarData(e.criadoEm)}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{e.metodo} {e.rota}</td>
                <td className="px-4 py-2.5">{e.mensagem}</td>
              </tr>
            ))}
          </Tabela>

          <h2 className="font-medium">Maiores tabelas</h2>
          <Tabela colunas={['Tabela', 'Tamanho']} vazio={s.tabelas.length === 0}>
            {s.tabelas.map((t) => (
              <tr key={t.nome}>
                <td className="px-4 py-2.5 font-mono text-xs">{t.nome}</td>
                <td className="px-4 py-2.5">{tamanho(t.bytes)}</td>
              </tr>
            ))}
          </Tabela>
        </div>
      )}
    </>
  );
}
