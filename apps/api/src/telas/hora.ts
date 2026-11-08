export function horaLocal(agora: Date, fuso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(agora);
}
