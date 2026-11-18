import { useState } from 'react';
import { linkWhatsApp, type ChamadaResumo } from '@etiquetas/shared';
import { Botao } from '../../components/ui';

/** Link de acompanhamento para mandar ao cliente, com o código (na entrega). */
export function LinkRastreio({ c }: { c: ChamadaResumo }) {
  const [copiado, setCopiado] = useState(false);
  if (!c.linkRastreio) return null;
  const url = `${window.location.origin}${c.linkRastreio}`;
  const cliente = c.tipo === 'ENTREGA' ? c.destino : c.origem;
  const mensagem = c.tipo === 'ENTREGA' && c.codigoConfirmacao ? `Acompanhe a sua entrega: ${url}\nSeu código para receber é ${c.codigoConfirmacao}. Informe ao entregador na entrega.` : `Acompanhe o entregador: ${url}`;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="link-rastreio">
      <span className="text-slate-600">Link para o cliente acompanhar:</span>
      <a className="text-blue-700 underline" href={url} target="_blank" rel="noreferrer">
        abrir
      </a>
      <button
        type="button"
        className="text-blue-700 underline"
        onClick={() => {
          void navigator.clipboard?.writeText(url);
          setCopiado(true);
        }}
      >
        {copiado ? 'copiado' : 'copiar'}
      </button>
      {cliente.telefone && (
        <a className="rounded bg-emerald-600 px-2 py-0.5 font-medium text-white hover:bg-emerald-700" href={linkWhatsApp(cliente.telefone, mensagem)} target="_blank" rel="noreferrer">
          Enviar pelo WhatsApp
        </a>
      )}
    </div>
  );
}

/** Emergência do entregador: em vermelho até alguém marcar "Ciente". */
export function AlertaEmergencia({ c, aoCiente, ocupado }: { c: ChamadaResumo; aoCiente: () => void; ocupado: boolean }) {
  const e = c.emergencia;
  if (!e) return null;
  const quando = new Date(e.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className={`rounded-md border px-3 py-2 ${e.vistaEm ? 'border-slate-200 bg-slate-50' : 'border-red-300 bg-red-50'}`} role={e.vistaEm ? undefined : 'alert'} data-testid="emergencia">
      <div className={`font-semibold ${e.vistaEm ? 'text-slate-700' : 'text-red-800'}`}>
        Emergência às {quando}
        {e.texto ? `: ${e.texto}` : ''}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
        {e.posicao && (
          <a className="text-blue-700 underline" href={`https://www.google.com/maps/search/?api=1&query=${e.posicao.lat},${e.posicao.lon}`} target="_blank" rel="noreferrer">
            Ver onde ele estava
          </a>
        )}
        {c.entregador?.celular && (
          <a className="text-blue-700 underline" href={`tel:${c.entregador.celular}`}>
            Ligar para {c.entregador.nome}
          </a>
        )}
        {e.vistaEm ? (
          <span className="text-slate-500">
            Visto por {e.vistaPor} às {new Date(e.vistaEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        ) : (
          <Botao variante="perigo" onClick={aoCiente} disabled={ocupado}>
            Ciente
          </Botao>
        )}
      </div>
    </div>
  );
}
