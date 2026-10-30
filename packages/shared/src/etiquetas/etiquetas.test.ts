import { describe, expect, it } from 'vitest';
import {
  bitmapNaCaixa,
  cinzaDoElemento,
  dadosCodigoBarras,
  digitoEan,
  girarCinza,
  monocromatico,
  diagramarPreco,
  formatarPreco,
  planejarTexto,
  quebrarLinhas,
  textoDoElemento,
  type ElementoImagem,
  type ElementoPreco,
  type ElementoTexto,
  formatarCampo,
  gerarEscpos,
  gerarPpla,
  gerarPplb,
  gerarZpl,
  LAYOUT_PADRAO,
  paginar,
  resolverOrigem,
  somarDias,
  validarLayout,
  type LayoutEtiqueta,
} from './index';

const OPCOES = { dpi: 203, hoje: '2026-10-29' };

function layout(extra: Partial<LayoutEtiqueta> = {}): LayoutEtiqueta {
  return {
    ...LAYOUT_PADRAO,
    larguraMm: 50,
    alturaMm: 30,
    elementos: [
      {
        id: 't1',
        tipo: 'texto',
        x: 2,
        y: 2,
        largura: 46,
        altura: 8,
        rotacao: 0,
        valor: { tipo: 'campo', campo: 'descricao' },
        prefixo: '',
        sufixo: '',
        tamanhoPt: 12,
        negrito: true,
        alinhamento: 'centro',
      },
      {
        id: 't2',
        tipo: 'texto',
        x: 2,
        y: 10,
        largura: 46,
        altura: 6,
        rotacao: 0,
        valor: { tipo: 'campo', campo: 'preco', formato: { tipo: 'moeda', casas: 2 } },
        prefixo: '',
        sufixo: '',
        tamanhoPt: 10,
        negrito: false,
        alinhamento: 'esquerda',
      },
      {
        id: 'b1',
        tipo: 'codigo_barras',
        x: 2,
        y: 17,
        largura: 40,
        altura: 12,
        rotacao: 0,
        valor: { tipo: 'campo', campo: 'ean' },
        simbologia: 'EAN13',
        mostrarTexto: true,
      },
    ],
    ...extra,
  };
}

// EANs com dígito verificador correto: 789100000004-5 e 789100000001-4.
const REGISTROS = [
  { descricao: 'Açúcar ^Cristal_1kg', preco: '4.99', ean: '7891000000045' },
  { descricao: 'Arroz 5kg', preco: 25.9, ean: '789100000001' },
];

describe('valores', () => {
  it('formata moeda, número e data no padrão brasileiro', () => {
    expect(formatarCampo('1234.5', { tipo: 'moeda', casas: 2 })).toBe('R$ 1.234,50');
    expect(formatarCampo(3, { tipo: 'numero', casas: 3 })).toBe('3,000');
    expect(formatarCampo('2026-10-29', { tipo: 'data', formato: 'dd/MM/yyyy' })).toBe('29/10/2026');
    expect(formatarCampo('2026-10-29T23:30:00-03:00', { tipo: 'data', formato: 'dd/MM/yy' })).toBe('29/10/26');
    expect(formatarCampo(null, undefined)).toBe('');
    expect(formatarCampo(true, undefined)).toBe('Sim');
  });

  it('data com deslocamento e contador', () => {
    expect(somarDias('2026-12-30', 3)).toBe('2027-01-02');
    const ctx = { registro: {}, indice: 4, hoje: '2026-10-29' };
    expect(resolverOrigem({ tipo: 'data', dias: 3, formato: 'dd/MM/yyyy' }, ctx)).toBe('01/11/2026');
    expect(resolverOrigem({ tipo: 'contador', inicio: 10, passo: 5, digitos: 4 }, ctx)).toBe('0030');
  });

  it('campo é encontrado ignorando maiúsculas', () => {
    expect(resolverOrigem({ tipo: 'campo', campo: 'Descricao' }, { registro: { DESCRICAO: 'X' }, indice: 0, hoje: '' })).toBe('X');
  });

  it('EAN: calcula e confere o dígito verificador', () => {
    expect(digitoEan('789100000004')).toBe(5);
    expect(dadosCodigoBarras('EAN13', '7891000000045')).toEqual({ dados: '789100000004', completo: '7891000000045' });
    expect(dadosCodigoBarras('EAN13', '789100000001')).toEqual({ dados: '789100000001', completo: '7891000000014' });
    expect(dadosCodigoBarras('EAN13', '7891000000046')).toHaveProperty('erro');
    expect(dadosCodigoBarras('EAN13', 'ABC')).toHaveProperty('erro');
    expect(dadosCodigoBarras('CODE39', 'abc-1')).toEqual({ dados: 'ABC-1', completo: 'ABC-1' });
  });
});

describe('layout', () => {
  it('valida o padrão e acusa elementos fora da etiqueta', () => {
    expect(validarLayout(layout())).toEqual([]);
    const fora = layout();
    fora.elementos[0] = { ...fora.elementos[0], x: 40 };
    expect(validarLayout(fora).join()).toMatch(/fora da etiqueta/);
    expect(validarLayout({ ...layout(), colunas: 0 }).join()).toMatch(/Colunas/);
  });

  it('folha A4 com 3 colunas: calcula linhas por página e posições', () => {
    const l = layout({
      larguraMm: 63.5,
      alturaMm: 38.1,
      colunas: 3,
      espacamentoHorizontalMm: 2.5,
      espacamentoVerticalMm: 0,
      margens: { superior: 15.1, inferior: 15.1, esquerda: 7.2, direita: 7.2 },
      papel: { tipo: 'folha', larguraMm: 210, alturaMm: 297 },
    });
    expect(validarLayout(l)).toEqual([]);
    const p = paginar(l);
    expect(p.porPagina).toBe(21); // Pimaco A4 3 × 7
    expect(p.origem(4)).toEqual({ x: 7.2 + 66, y: 15.1 + 38.1 });
    expect(validarLayout({ ...l, colunas: 4 }).join()).toMatch(/não cabem/);
  });
});

describe('ZPL', () => {
  it('gera um formato por etiqueta, com escape de ^ e _ e EAN sem verificador', () => {
    const r = gerarZpl(layout(), REGISTROS, OPCOES);
    expect(r.conteudo.match(/\^XA/g)).toHaveLength(2);
    expect(r.conteudo).toContain('^CI28');
    expect(r.conteudo).toContain('^PW400'); // 50 mm a 203 dpi
    expect(r.conteudo).toContain('^FH^FDAçúcar _5ECristal_5F1kg^FS');
    expect(r.conteudo).toContain('^FB368,1,0,C,0'); // caixa de 46 mm, centralizado
    expect(r.conteudo).toContain('^FDR$ 4,99^FS');
    expect(r.conteudo).toMatch(/\^BEN,\d+,Y,N\^FH\^FD789100000004\^FS/);
    expect(r.avisos).toEqual([]);
  });

  it('colunas no rolo: duas etiquetas por formato, a segunda deslocada', () => {
    const r = gerarZpl(layout({ colunas: 2, espacamentoHorizontalMm: 3 }), REGISTROS, OPCOES);
    expect(r.conteudo.match(/\^XA/g)).toHaveLength(1);
    expect(r.conteudo).toContain('^PW823'); // (50 + 3 + 50) mm
    expect(r.conteudo).toContain(`^FO${Math.round(((53 + 2) * 203) / 25.4)},16`);
  });

  it('código inválido vira aviso, não ZPL quebrado', () => {
    const r = gerarZpl(layout(), [{ descricao: 'X', preco: 1, ean: '123' }], OPCOES);
    expect(r.conteudo).not.toContain('^BE');
    expect(r.avisos[0]).toMatch(/Etiqueta 1: código de barras não impresso/);
  });

  it('rotação 90 usa orientação R e o comprimento da caixa vertical', () => {
    const l = layout();
    l.elementos = [{ ...l.elementos[0], largura: 8, altura: 28, rotacao: 90 } as (typeof l.elementos)[0]];
    const r = gerarZpl(l, [REGISTROS[0]], OPCOES);
    expect(r.conteudo).toMatch(/\^A0R,\d+\^FB224,/);
  });
});

describe('PPLB', () => {
  it('gera comandos EPL com acentos removidos e EAN-13', () => {
    const r = gerarPplb(layout(), REGISTROS, OPCOES);
    expect(r.conteudo).toContain('\nN\nq400\nQ240,');
    expect(r.conteudo).toMatch(/A\d+,16,0,\d,\d,\d,N,"Acucar \^Cristal_1kg"/);
    expect(r.conteudo).toMatch(/B16,\d+,0,E30,\d,\d+,\d+,B,"789100000004"/);
    expect(r.conteudo.match(/\nP1/g)).toHaveLength(2);
    expect(r.avisos.join()).toMatch(/acentos/);
  });

  it('escapa aspas', () => {
    const r = gerarPplb(layout(), [{ descricao: 'TV 32"', preco: 1, ean: '7891000000045' }], OPCOES);
    expect(r.conteudo).toContain('"TV 32\\""');
  });
});

describe('PPLA', () => {
  it('gera formato DPL em métrico com fonte suave e código', () => {
    const r = gerarPpla(layout(), [REGISTROS[1]], OPCOES);
    expect(r.conteudo.startsWith('\x02L\r\nD11\r\nm\r\n')).toBe(true);
    expect(r.conteudo).toMatch(/1911A12\d{8}Arroz 5kg/);
    expect(r.conteudo).toMatch(/1F\d{5}\d{8}789100000001/);
    expect(r.conteudo).toContain('Q0001\r\nE');
  });
});

describe('imagem', () => {
  // 4 × 2 px: metade esquerda preta, metade direita branca.
  const cinza = btoa(String.fromCharCode(0, 0, 255, 255, 0, 0, 255, 255));
  const imagem = (extra: Partial<ElementoImagem> = {}): ElementoImagem => ({
    id: 'i1',
    tipo: 'imagem',
    nome: 'logo.png',
    x: 2,
    y: 2,
    largura: 8,
    altura: 4,
    rotacao: 0,
    larguraPx: 4,
    alturaPx: 2,
    cinza,
    limiar: 128,
    pontilhado: false,
    ...extra,
  });
  const comImagem = (el: ElementoImagem) => layout({ elementos: [el] });

  it('valida tamanho e dados', () => {
    expect(validarLayout(comImagem(imagem()))).toEqual([]);
    expect(validarLayout(comImagem(imagem({ cinza: cinza.slice(4) }))).join()).toMatch(/corrompidos/);
    expect(validarLayout(comImagem(imagem({ larguraPx: 5000 }))).join()).toMatch(/tamanho inválido/);
    expect(validarLayout(comImagem(imagem({ limiar: 300 }))).join()).toMatch(/limiar/);
  });

  it('redimensiona, gira no sentido horário e converte em preto e branco', () => {
    const el = imagem();
    const b = bitmapNaCaixa(el, 8, 2);
    expect(b.bytesPorLinha).toBe(1);
    expect([...b.dados]).toEqual([0xf0, 0xf0]); // 4 pontos pretos à esquerda
    // Girada 90°: o lado preto (esquerda) passa a ficar em cima.
    const g = girarCinza(cinzaDoElemento(el), 90);
    expect([g.largura, g.altura]).toEqual([2, 4]);
    expect([...g.pixels]).toEqual([0, 0, 0, 0, 255, 255, 255, 255]);
    // Cinza médio: corte no limiar fica todo branco; pontilhado mistura.
    const meio = { largura: 8, altura: 8, pixels: new Uint8Array(64).fill(160) };
    expect(monocromatico(meio, 128, false).dados.every((v) => v === 0)).toBe(true);
    const pontos = [...monocromatico(meio, 128, true).dados].reduce((t, v) => t + v.toString(2).replace(/0/g, '').length, 0);
    expect(pontos).toBeGreaterThan(10);
    expect(pontos).toBeLessThan(40);
  });

  it('ZPL envia a imagem uma vez (~DG) e a chama em cada etiqueta (^XG)', () => {
    const r = gerarZpl(comImagem(imagem()), REGISTROS, OPCOES);
    expect(r.conteudo.match(/~DGR:ETQ1\.GRF,/g)).toHaveLength(1);
    expect(r.conteudo.indexOf('~DG')).toBeLessThan(r.conteudo.indexOf('^XA'));
    expect(r.conteudo.match(/\^FO16,16\^XGR:ETQ1\.GRF,1,1\^FS/g)).toHaveLength(2);
  });

  it('PPLB usa GW com bits invertidos e sai em binário', () => {
    const r = gerarPplb(comImagem(imagem()), [REGISTROS[0]], OPCOES);
    expect(r.codificacao).toBe('base64');
    const bin = atob(r.conteudo);
    const i = bin.indexOf('GW16,16,8,32,');
    expect(i).toBeGreaterThan(0);
    // 64 × 32 pontos: metade esquerda preta = bits 0 nos primeiros 4 bytes da linha.
    const linha = [...bin.slice(i + 'GW16,16,8,32,'.length, i + 'GW16,16,8,32,'.length + 8)].map((c) => c.charCodeAt(0));
    expect(linha).toEqual([0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff]);
    expect(bin).toContain('\nP1');
  });

  it('ESC/POS em faixas ESC *; PPLA avisa que não imprime imagem', () => {
    const r = gerarEscpos(comImagem(imagem()), [REGISTROS[0]], OPCOES);
    const hex = Buffer.from(atob(r.conteudo), 'latin1').toString('hex');
    expect(hex.match(/1b2a214000/g)).toHaveLength(2); // 64 pontos de largura, 32 de altura = 2 faixas
    expect(gerarPpla(comImagem(imagem()), [REGISTROS[0]], OPCOES).avisos.join()).toMatch(/imagens ainda não/);
  });
});

describe('design (cartazes)', () => {
  // Medidor fictício: cada caractere ocupa 0,5 × o tamanho.
  const medir = (t: string, tamanho: number) => [...t].length * tamanho * 0.5;

  it('quebra por palavra, respeita Enter e corta palavra longa', () => {
    expect(quebrarLinhas('aa bb cc', 25, 10, medir)).toEqual(['aa bb', 'cc']);
    expect(quebrarLinhas('aa\nbb', 100, 10, medir)).toEqual(['aa', 'bb']);
    expect(quebrarLinhas('abcdefgh', 20, 10, medir)).toEqual(['abcd', 'efgh']);
  });

  it('ajustar reduz a fonte até caber; sem ajustar, corta linhas', () => {
    const base = { tamanhoPt: 40, alinhamento: 'centro' as const };
    const ajustado = planejarTexto({ ...base, ajustar: true }, 'Picanha bovina', 100, 30, medir);
    expect(ajustado.tamanhoPt).toBeLessThan(40);
    expect(ajustado.linhas.every((l) => l.largura <= 100.01)).toBe(true);
    const cortado = planejarTexto(base, 'Picanha bovina maturada especial', 100, 45, medir);
    expect(cortado.tamanhoPt).toBe(40);
    expect(cortado.linhas).toHaveLength(1);
    expect(cortado.linhas[0].u).toBeCloseTo((100 - cortado.linhas[0].largura) / 2);
  });

  it('preço: formata número e separa símbolo, reais e centavos', () => {
    expect(formatarPreco('59.9')).toBe('59,90');
    expect(formatarPreco('1.234,5')).toBe('1.234,50');
    expect(formatarPreco('abc')).toBeNull();
    const el: ElementoPreco = {
      id: 'p', tipo: 'preco', x: 0, y: 0, largura: 50, altura: 20, rotacao: 0, valor: { tipo: 'campo', campo: 'preco' },
      simbolo: 'R$', centavosSobrescritos: true, tamanhoPt: 40, negrito: true, alinhamento: 'esquerda',
    };
    const texto = textoDoElemento(el, { registro: { preco: 59.9 }, indice: 0, hoje: '2026-10-29' });
    expect(texto).toBe('R$ 59,90');
    const pedacos = diagramarPreco(el, texto, 200, 60, medir);
    expect(pedacos.map((p) => p.texto)).toEqual(['R$ ', '59', ',90']);
    expect(pedacos[1].tamanhoPt).toBe(40);
    expect(pedacos[2].tamanhoPt).toBeCloseTo(18);
    expect(pedacos[2].v).toBeLessThan(pedacos[1].v); // centavos no alto
  });

  it('valida cores, fontes e formas; térmicas avisam e não imprimem fundo claro', () => {
    const l = layout({
      corFundo: '#fff3e0',
      elementos: [
        { id: 'r', tipo: 'retangulo', x: 0, y: 0, largura: 50, altura: 30, rotacao: 0, espessuraMm: 0, preenchido: true, corPreenchimento: '#ffd600' },
        { id: 'e', tipo: 'elipse', x: 5, y: 5, largura: 20, altura: 10, rotacao: 0, espessuraMm: 0.5, preenchido: false },
        {
          id: 't', tipo: 'texto', x: 2, y: 2, largura: 40, altura: 8, rotacao: 0, valor: { tipo: 'fixo', texto: 'Oferta' }, prefixo: '', sufixo: '',
          tamanhoPt: 12, negrito: true, alinhamento: 'centro', fonte: 'bebas-neue', cor: '#d32f2f', caixa: 'maiusculas',
        },
      ],
    });
    expect(validarLayout(l)).toEqual([]);
    expect(validarLayout({ ...l, corFundo: 'vermelho' }).join()).toMatch(/Cor de fundo/);
    expect(validarLayout({ ...l, elementos: [{ ...l.elementos[2], fonte: 'comic-sans' } as ElementoTexto] }).join()).toMatch(/fonte desconhecida/);
    const zpl = gerarZpl(l, [{}], OPCOES);
    expect(zpl.avisos.join()).toMatch(/só aparecem no PDF/);
    expect(zpl.conteudo).not.toMatch(/\^GB406,240/); // fundo amarelo não vira bloco preto
    expect(zpl.conteudo).toMatch(/\^GE160,80,4\^FS/); // elipse com borda
    expect(zpl.conteudo).toContain('^FDOFERTA^FS'); // maiúsculas aplicadas em todas as saídas
  });
});

describe('ESC/POS', () => {
  it('gera modo página com página de código 1252, EAN e FF por etiqueta', () => {
    const r = gerarEscpos(layout(), REGISTROS, OPCOES);
    const bytes = Uint8Array.from(atob(r.conteudo), (c) => c.charCodeAt(0));
    const hex = Buffer.from(bytes).toString('hex');
    expect(hex.startsWith('1b401b7410')).toBe(true);
    expect(hex).toContain('1b4c'); // modo página
    expect(Buffer.from(bytes).toString('latin1')).toContain('Açúcar');
    expect(hex).toContain(`1d6b430c${Buffer.from('789100000004').toString('hex')}`);
    expect(bytes.filter((b) => b === 0x0c).length).toBeGreaterThanOrEqual(2);
  });
});
