import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { criarEmpresa, pedir, type EmpresaTeste } from './apoio';

/** Entregador e empresa prontos para as chamadas (testes de Entregas e do app do entregador). */
export const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
export const SE = { lat: -23.5505, lon: -46.6333 };
export const PAULISTA = { lat: -23.5614, lon: -46.6559 };
export const PERTO_DA_SE = { lat: -23.5521, lon: -46.6345 };

export function cpf(): string {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  if (new Set(d).size === 1) d[0] = (d[0] + 1) % 10;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += d[i] * (n + 1 - i);
    const r = (soma * 10) % 11;
    d.push(r === 10 ? 0 : r);
  }
  return d.join('');
}

export async function entregadorOnline(tokenSuper: string, onde = PERTO_DA_SE, nome = 'Carlos Motoboy Lima', veiculo: 'BICICLETA' | 'A_PE' = 'BICICLETA') {
  const email = `cham-${randomUUID().slice(0, 8)}@e2e.local`;
  const r = await pedir('POST', '/entregador/cadastro', { corpo: { nome, cpf: cpf(), celular: '11987654321', email, senha: 'SenhaEntregador1', veiculo, placa: null, chavePix: email, aceitaTermos: true } });
  expect(r.status).toBe(201);
  const token = r.j.token as string;
  const id = r.j.perfil.id as string;
  await pedir('PUT', '/entregador/documentos/SELFIE', { token, corpo: { imagem: PNG } });
  expect((await pedir('POST', `/entregadores/${id}/aprovar`, { token: tokenSuper })).status).toBe(204);
  await pedir('POST', `/entregadores/${id}/bonus`, { token: tokenSuper, corpo: { diarias: 3, validadeDias: 30, motivo: 'Teste' } });
  expect((await pedir('POST', '/entregador/online', { token, corpo: onde })).j.online).toBe(true);
  return { id, token, email };
}

export async function empresaComBase(tokenSuper: string): Promise<EmpresaTeste> {
  const e = await criarEmpresa(tokenSuper);
  const precos = { ENTREGA: { baseCentavos: 800, porKmCentavos: 200, kmIncluso: 2 }, COLETA: { baseCentavos: 900, porKmCentavos: 200, kmIncluso: 2 }, DEVOLUCAO_MAQUINA: { baseCentavos: 1500, porKmCentavos: 200, kmIncluso: 2 } };
  const r = await pedir('PUT', '/entregas/config', { token: e.adminToken, corpo: { base: { ...SE, endereco: 'Praça da Sé, 1, Sé, São Paulo' }, raioAtendimentoKm: 10, precos, segundosParaAceitar: 60 } });
  expect(r.status, JSON.stringify(r.j)).toBe(200);
  return e;
}


/** Um ponto a tantos metros ao norte (e a leste) de outro. */
export function deslocar(p: { lat: number; lon: number }, norte: number, leste = 0) {
  return { lat: p.lat + norte / 111_320, lon: p.lon + leste / (111_320 * Math.cos((p.lat * Math.PI) / 180)) };
}
