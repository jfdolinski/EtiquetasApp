import { describe, expect, it } from 'vitest';
import {
  dataHoraNoFuso,
  decimalDeCentavos,
  descricaoDaMensalidade,
  documentoDoTomador,
  idDps,
  idPedidoEvento,
  issDaNota,
  leiauteDoAmbiente,
  montarDps,
  montarPedidoCancelamento,
  problemaNoCancelamento,
  problemaNoEmissor,
  problemaNoServico,
  problemaNoTomador,
  valorDoPedidoNaNota,
  vaiAliquotaNaDps,
  type DadosDps,
  type DadosEmissorNfse,
} from './nfse';

const emissor: DadosEmissorNfse = {
  ambiente: 'PRODUCAO_RESTRITA',
  cnpj: '11.222.333/0001-81',
  inscricaoMunicipal: '12345',
  razaoSocial: 'Flow Tecnologia Ltda',
  codigoMunicipio: '3550308',
  regime: 'SIMPLES',
  regimeEspecial: 0,
  email: null,
  telefone: null,
  serie: '1',
  proximoNumero: 1,
  servico: { codigoTributacaoNacional: '010501', descricao: 'Licença de uso de software', aliquotaIss: 2, issRetido: false },
  automatico: { mensalidade: true },
};

const base = (extra: Partial<DadosDps> = {}): DadosDps => ({
  emissor,
  serie: '1',
  numero: 42,
  emitidaEm: '2026-11-26T10:00:00-03:00',
  competencia: '2026-11-26',
  tomador: { documento: '11.444.777/0001-61', nome: 'Cliente & Cia', email: 'fiscal@cliente.com' },
  servico: emissor.servico,
  valorCentavos: 9990,
  versaoAplicativo: 'Flow 1.0',
  ...extra,
});

describe('NFS-e: dados do emissor', () => {
  it('aceita o emissor válido e recusa os erros comuns', () => {
    expect(problemaNoEmissor(emissor)).toBeNull();
    expect(problemaNoEmissor({ ...emissor, cnpj: '11222333000100' })).toMatch(/CNPJ/);
    expect(problemaNoEmissor({ ...emissor, codigoMunicipio: '355030' })).toMatch(/IBGE/);
    expect(problemaNoEmissor({ ...emissor, serie: '01' })).toMatch(/série/);
    expect(problemaNoEmissor({ ...emissor, serie: '50000' })).toMatch(/série/);
    expect(problemaNoEmissor({ ...emissor, regimeEspecial: 6 })).toMatch(/regime especial/);
    expect(problemaNoEmissor({ ...emissor, regime: 'NORMAL', regimeEspecial: 6 })).toBeNull();
  });

  it('confere o serviço conforme o regime', () => {
    expect(problemaNoServico({ ...emissor.servico, codigoTributacaoNacional: '1401' }, 'SIMPLES')).toMatch(/6 dígitos/);
    expect(problemaNoServico({ ...emissor.servico, aliquotaIss: 2 }, 'MEI')).toMatch(/MEI/);
    expect(problemaNoServico({ ...emissor.servico, aliquotaIss: 6 }, 'NORMAL')).toMatch(/5%/);
    expect(problemaNoServico({ ...emissor.servico, issRetido: true, aliquotaIss: 1.5 }, 'SIMPLES')).toMatch(/1,8%/);
    expect(problemaNoServico({ ...emissor.servico, issRetido: true, aliquotaIss: 2 }, 'SIMPLES')).toBeNull();
  });

  it('tomador: CPF ou CNPJ válido, ou não identificado', () => {
    expect(documentoDoTomador('529.982.247-25')).toBe('52998224725');
    expect(documentoDoTomador('11.444.777/0001-61')).toBe('11444777000161');
    expect(documentoDoTomador('123')).toBeNull();
    expect(problemaNoTomador({ documento: '111.111.111-11', nome: 'X' })).toMatch(/inválido/);
    expect(problemaNoTomador(null)).toBeNull();
  });
});

describe('NFS-e: DPS', () => {
  it('Id de 45 caracteres com município, CNPJ, série e número', () => {
    const id = idDps('3550308', '11222333000181', '1', 42);
    expect(id).toBe('DPS3550308211222333000181' + '00001' + '000000000000042');
    expect(id).toHaveLength(45);
  });

  it('monta o XML na ordem do XSD, canônico e com o texto escapado', () => {
    const xml = montarDps(base());
    expect(xml.startsWith('<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="DPS3550308')).toBe(true);
    expect(xml).not.toMatch(/\/>/);
    expect(xml).not.toMatch(/>\s+</);
    expect(xml).toContain('<serie>1</serie><nDPS>42</nDPS>');
    expect(xml).toContain('<xNome>Cliente &amp; Cia</xNome>');
    expect(xml).toContain('<regTrib><opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN><regEspTrib>0</regEspTrib></regTrib>');
    expect(xml).toContain('<vServ>99.90</vServ>');
    // cNBS antes da descrição; prestador sem nome.
    expect(xml.indexOf('<cTribNac>')).toBeLessThan(xml.indexOf('<xDescServ>'));
    expect(xml).not.toMatch(/<prest>.*<xNome>.*<\/prest>/);
    // Simples sem retenção: alíquota fora (a Sefin usa a do município) e pTotTribSN.
    expect(xml).not.toContain('<pAliq>');
    expect(xml).toContain('<totTrib><pTotTribSN>0.00</pTotTribSN></totTrib>');
    expect(xml).not.toContain('finNFSe');
  });

  it('alíquota só no Simples com retenção; totTrib por regime', () => {
    const retido = montarDps(base({ servico: { ...emissor.servico, issRetido: true, aliquotaIss: 2.5 } }));
    expect(retido).toContain('<tpRetISSQN>2</tpRetISSQN><pAliq>2.50</pAliq>');
    const mei = montarDps(base({ emissor: { ...emissor, regime: 'MEI' }, servico: { ...emissor.servico, aliquotaIss: null } }));
    expect(mei).toContain('<opSimpNac>2</opSimpNac><regEspTrib>0</regEspTrib>');
    expect(mei).toContain('<indTotTrib>0</indTotTrib>');
    const normal = montarDps(base({ emissor: { ...emissor, regime: 'NORMAL' } }));
    expect(normal).toContain('<opSimpNac>1</opSimpNac><regEspTrib>0</regEspTrib>');
    expect(normal).toContain('<pTotTrib><pTotTribFed>0.00</pTotTribFed>');
    expect(normal).not.toContain('<pAliq>');
    expect(vaiAliquotaNaDps('NORMAL', 0, { aliquotaIss: 2, issRetido: true })).toBe(false);
  });

  it('leiaute da NT 009 (Produção Restrita) leva finNFSe e indDest', () => {
    expect(leiauteDoAmbiente('PRODUCAO_RESTRITA')).toBe('NT_009');
    expect(leiauteDoAmbiente('PRODUCAO')).toBe('PRODUCAO_2026');
    expect(leiauteDoAmbiente('PRODUCAO', 'NT_009')).toBe('NT_009');
    const xml = montarDps(base({ leiaute: 'NT_009' }));
    expect(xml).toContain('<tpEmit>1</tpEmit><finNFSe>0</finNFSe><cLocEmi>');
    expect(xml).toContain('</toma><indDest>0</indDest><serv>');
  });

  it('sem documento o tomador não entra; produção usa tpAmb 1', () => {
    const xml = montarDps(base({ tomador: { nome: 'Consumidor' }, emissor: { ...emissor, ambiente: 'PRODUCAO' } }));
    expect(xml).not.toContain('<toma>');
    expect(xml).toContain('<tpAmb>1</tpAmb>');
  });
});

describe('NFS-e: cancelamento e valores', () => {
  it('pedido de cancelamento com Id PRE + chave + 101101 e sem nPedRegEvento', () => {
    const chave = '1'.repeat(50);
    expect(idPedidoEvento(chave)).toHaveLength(59);
    const xml = montarPedidoCancelamento({ ambiente: 'PRODUCAO_RESTRITA', cnpjAutor: emissor.cnpj, chaveAcesso: chave, emitidoEm: '2026-11-26T10:00:00-03:00', motivo: 2, texto: 'Serviço não foi prestado ao cliente', versaoAplicativo: 'Flow' });
    expect(xml).toContain(`<infPedReg Id="PRE${chave}101101"><tpAmb>2</tpAmb>`);
    expect(xml).toContain('<CNPJAutor>11222333000181</CNPJAutor>');
    expect(xml).toContain('<cMotivo>2</cMotivo>');
    expect(xml).not.toContain('nPedRegEvento');
    expect(problemaNoCancelamento(1, 'curto')).toMatch(/15/);
    expect(problemaNoCancelamento(3, 'texto bem comprido aqui')).toMatch(/motivo/);
    expect(problemaNoCancelamento(9, 'Cliente desistiu do serviço')).toBeNull();
  });

  it('valores, datas e descrições', () => {
    expect(decimalDeCentavos(5)).toBe('0.05');
    expect(decimalDeCentavos(123456)).toBe('1234.56');
    expect(issDaNota(10000, 2.5)).toBe(250);
    expect(issDaNota(10000, null)).toBe(0);
    expect(dataHoraNoFuso(new Date('2026-11-26T13:05:09.987Z'), 'America/Sao_Paulo')).toBe('2026-11-26T10:05:09-03:00');
    expect(dataHoraNoFuso(new Date('2026-11-26T13:05:09Z'), 'UTC')).toBe('2026-11-26T13:05:09+00:00');
    expect(descricaoDaMensalidade('Licença do Flow', '2026-11-10', 1)).toBe('Licença do Flow - mensalidade de 11/2026');
    expect(descricaoDaMensalidade('Licença do Flow', '2026-11-10', 3)).toBe('Licença do Flow - 3 mensalidades a partir de 11/2026');
    expect(valorDoPedidoNaNota({ taxaCentavos: 700, totalCentavos: 5000 }, undefined)).toBe(700);
    expect(valorDoPedidoNaNota({ taxaCentavos: 700, totalCentavos: 5000 }, 'TOTAL')).toBe(5000);
  });
});
