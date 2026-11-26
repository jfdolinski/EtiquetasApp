import { idDps, montarDps, montarPedidoCancelamento } from '@etiquetas/shared';
import { assinarXml, lerCertificado } from './certificado';
import { gerarPfxDeTeste } from './certificado-de-teste';
import { SefinNacional } from './sefin';
import { iniciarSimuladorSefin, type SimuladorSefin } from './simulador-sefin';

const CNPJ = '11222333000181';
const pfx = gerarPfxDeTeste(CNPJ, 'senha');
const outro = gerarPfxDeTeste('11444777000161', 'senha');
const cert = lerCertificado(pfx.pfxBase64, 'senha');
const cred = { pfx: Buffer.from(pfx.pfxBase64, 'base64'), senha: 'senha' };

function dps(numero: number, ambiente: 'PRODUCAO_RESTRITA' | 'PRODUCAO' = 'PRODUCAO_RESTRITA') {
  return assinarXml(
    montarDps({
      emissor: { ambiente, cnpj: CNPJ, codigoMunicipio: '3550308', regime: 'NORMAL', regimeEspecial: 0 },
      serie: '1',
      numero,
      emitidaEm: '2026-11-26T10:00:00-03:00',
      competencia: '2026-11-26',
      tomador: null,
      servico: { codigoTributacaoNacional: '010501', descricao: 'Licença de uso do Flow', aliquotaIss: 2 },
      valorCentavos: 9990,
      versaoAplicativo: 'Flow',
    }),
    'infDPS',
    cert,
  );
}

describe('cliente da Sefin Nacional contra o simulador', () => {
  let sim: SimuladorSefin;
  let sefin: SefinNacional;
  beforeAll(async () => {
    sim = await iniciarSimuladorSefin();
    sefin = new SefinNacional({ PRODUCAO_RESTRITA: `${sim.url}/SefinNacional`, PRODUCAO: `${sim.url}/SefinNacional` }, false, 10_000);
  });
  afterAll(() => sim.parar());

  it('emite, recupera pela DPS e cancela', async () => {
    const r = await sefin.emitir(cred, 'PRODUCAO_RESTRITA', dps(1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.chaveAcesso).toMatch(/^\d{50}$/);
    expect(r.numeroNfse).toBe('1');
    expect(r.xmlNfse).toContain('<infDPS Id="DPS');

    // A mesma DPS de novo: recusa de repetida, e a nota é recuperada pela consulta.
    const rep = await sefin.emitir(cred, 'PRODUCAO_RESTRITA', dps(1));
    expect(rep).toMatchObject({ ok: false, duplicada: true, temporaria: false });
    const achada = await sefin.consultarPorDps(cred, 'PRODUCAO_RESTRITA', idDps('3550308', CNPJ, '1', 1));
    expect(achada?.chaveAcesso).toBe(r.chaveAcesso);
    expect(await sefin.consultarPorDps(cred, 'PRODUCAO_RESTRITA', idDps('3550308', CNPJ, '1', 99))).toBeNull();

    const pedido = assinarXml(
      montarPedidoCancelamento({ ambiente: 'PRODUCAO_RESTRITA', cnpjAutor: CNPJ, chaveAcesso: r.chaveAcesso, emitidoEm: '2026-11-26T11:00:00-03:00', motivo: 1, texto: 'Valor digitado errado', versaoAplicativo: 'Flow' }),
      'infPedReg',
      cert,
    );
    expect(await sefin.registrarEvento(cred, 'PRODUCAO_RESTRITA', r.chaveAcesso, pedido)).toEqual({ ok: true });
    expect(sim.notas.get(r.chaveAcesso)?.cancelada).toBe(true);
    expect(await sefin.registrarEvento(cred, 'PRODUCAO_RESTRITA', r.chaveAcesso, pedido)).toMatchObject({ ok: false, mensagem: expect.stringContaining('já cancelada') });
  });

  it('fora do ar é temporária; certificado de outro CNPJ e ambiente errado são recusas', async () => {
    sim.falhar(1);
    expect(await sefin.emitir(cred, 'PRODUCAO_RESTRITA', dps(2))).toMatchObject({ ok: false, temporaria: true, status: 503 });
    expect((await sefin.emitir(cred, 'PRODUCAO_RESTRITA', dps(2))).ok).toBe(true);

    const credOutro = { pfx: Buffer.from(outro.pfxBase64, 'base64'), senha: 'senha' };
    expect(await sefin.emitir(credOutro, 'PRODUCAO_RESTRITA', dps(3))).toMatchObject({ ok: false, temporaria: false, mensagem: expect.stringContaining('prestador') });
    expect(await sefin.emitir(cred, 'PRODUCAO_RESTRITA', dps(4, 'PRODUCAO'))).toMatchObject({ ok: false, mensagem: expect.stringContaining('Ambiente') });
  });

  it('assinatura adulterada é recusada', async () => {
    const xml = dps(5).replace('99.90', '1.00');
    expect(await sefin.emitir(cred, 'PRODUCAO_RESTRITA', xml)).toMatchObject({ ok: false, mensagem: expect.stringContaining('digest') });
  });
});
