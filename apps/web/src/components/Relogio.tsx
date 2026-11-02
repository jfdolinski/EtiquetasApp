import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SituacaoServidor } from '@etiquetas/shared';
import { api } from '../api';

/**
 * Data e hora do servidor, no fuso do sistema. O relógio do computador só marca a passagem do
 * tempo: é a hora em que etiquetas e agendamentos valem, mesmo com o computador errado.
 */
export function Relogio() {
  const { data } = useQuery({
    queryKey: ['relogio'],
    queryFn: async () => {
      const situacao = await api<SituacaoServidor>('/health');
      return { diferenca: new Date(situacao.horarios.api).getTime() - Date.now(), fuso: situacao.horarios.fusoSistema };
    },
    refetchInterval: 10 * 60_000,
    staleTime: 10 * 60_000,
  });
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!data) return null;

  const texto = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone: data.fuso }).format(agora + data.diferenca);
  return (
    <time className="mr-auto text-sm tabular-nums text-slate-600" title={`Horário do servidor (${data.fuso})`} aria-label="Data e hora do sistema">
      {texto}
    </time>
  );
}
