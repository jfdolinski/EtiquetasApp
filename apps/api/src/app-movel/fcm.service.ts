import { createSign } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config';

const URL_TOKEN = 'https://oauth2.googleapis.com/token';
const ESCOPO = 'https://www.googleapis.com/auth/firebase.messaging';

export interface AvisoPush {
  titulo: string;
  mensagem: string;
  /** Tela que o app abre ao tocar no aviso. */
  tela?: 'inicio' | 'lista' | 'avisos' | 'pedidos';
}

/** Push pelo Firebase (FCM v1), o único jeito de acordar um app Android fechado. Sem FCM_CONTA_SERVICO, nada é enviado. */
@Injectable()
export class FcmService {
  private readonly log = new Logger('Push');
  private acesso?: { token: string; expiraEm: number };

  get disponivel(): boolean {
    return config().fcm !== null;
  }

  /** Devolve os tokens que o Firebase disse não existirem mais, para esquecer esses aparelhos. */
  async enviar(tokens: string[], aviso: AvisoPush): Promise<{ enviados: number; invalidos: string[] }> {
    const fcm = config().fcm;
    if (!fcm || tokens.length === 0) return { enviados: 0, invalidos: [] };
    let acesso: string;
    try {
      acesso = await this.tokenDeAcesso(fcm);
    } catch (e) {
      this.log.error(`Autenticação no Firebase: ${(e as Error).message}`);
      return { enviados: 0, invalidos: [] };
    }
    const invalidos: string[] = [];
    let enviados = 0;
    await Promise.all(
      tokens.map(async (token) => {
        const r = await fetch(`https://fcm.googleapis.com/v1/projects/${fcm.projeto}/messages:send`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${acesso}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: aviso.titulo, body: aviso.mensagem },
              data: { tela: aviso.tela ?? 'avisos' },
              android: { priority: 'HIGH', notification: { channel_id: 'avisos' } },
            },
          }),
        }).catch((e: Error) => {
          this.log.warn(`Envio ao Firebase: ${e.message}`);
          return null;
        });
        if (r?.ok) enviados++;
        else if (r?.status === 404 || r?.status === 400) invalidos.push(token);
        else if (r) this.log.warn(`Firebase respondeu ${r.status}.`);
      }),
    );
    return { enviados, invalidos };
  }

  private async tokenDeAcesso(fcm: { email: string; chavePrivada: string }): Promise<string> {
    if (this.acesso && this.acesso.expiraEm > Date.now() + 60_000) return this.acesso.token;
    const b64 = (v: string) => Buffer.from(v).toString('base64url');
    const agora = Math.floor(Date.now() / 1000);
    const corpo = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(JSON.stringify({ iss: fcm.email, scope: ESCOPO, aud: URL_TOKEN, iat: agora, exp: agora + 3600 }))}`;
    const assinatura = createSign('RSA-SHA256').update(corpo).sign(fcm.chavePrivada).toString('base64url');
    const r = await fetch(URL_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${corpo}.${assinatura}` }),
    });
    if (!r.ok) throw new Error(`resposta ${r.status}`);
    const d = (await r.json()) as { access_token: string; expires_in: number };
    this.acesso = { token: d.access_token, expiraEm: Date.now() + d.expires_in * 1000 };
    return d.access_token;
  }
}
