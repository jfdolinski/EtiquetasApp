import { describe, expect, it } from 'vitest';
import {
  cenasDosItens,
  colunasSugeridas,
  CONFIG_CONTEUDO_PADRAO,
  conteudoVigente,
  corDoTextoSobre,
  dadosValidosAte,
  gradeDaCena,
  gradeParaItens,
  imagemCombinaComTela,
  problemaNasImagensDoConteudo,
  itensDoConteudo,
  MAX_ITENS_CONTEUDO,
  nivelEfetivo,
  problemaNaConfigConteudo,
  problemaNaVigencia,
  problemaNosPrazosConteudo,
  programasValidos,
  situacaoDoConteudo,
  type ProgramaTela,
} from './telas-conteudo';

const colunas = { colunaNome: 'descricao', colunaPreco: 'preco', colunaPrecoDe: 'preco_de', colunaDetalhe: 'validade' };
const semVigencia = { horarioInicio: null, horarioFim: null, dataInicio: null, dataFim: null };

describe('itens do conteúdo', () => {
  it('formata o preço e procura a coluna sem diferenciar maiúsculas', () => {
    const { itens } = itensDoConteudo([{ DESCRICAO: 'Arroz 5kg', PRECO: '24.9' }], colunas);
    expect(itens).toEqual([{ nome: 'Arroz 5kg', preco: 'R$ 24,90' }]);
  });

  it('não mostra produto sem nome, sem preço, de preço zero ou com preço que não é número', () => {
    const r = itensDoConteudo(
      [
        { descricao: 'Sem preço', preco: null },
        { descricao: 'Zerado', preco: 0 },
        { descricao: 'Texto', preco: 'consulte' },
        { descricao: '', preco: 5 },
        { descricao: 'Bom', preco: 5 },
      ],
      colunas,
    );
    expect(r.itens.map((i) => i.nome)).toEqual(['Bom']);
    expect(r.descartados).toBe(4);
  });

  it('o preço anterior só aparece quando é maior que o atual', () => {
    const { itens } = itensDoConteudo(
      [
        { descricao: 'Oferta', preco: 8, preco_de: 10 },
        { descricao: 'Subiu', preco: 12, preco_de: 10 },
        { descricao: 'Igual', preco: 10, preco_de: 10 },
        { descricao: 'Sem', preco: 10, preco_de: null },
      ],
      colunas,
    );
    expect(itens[0].precoDe).toBe('R$ 10,00');
    expect(itens.slice(1).every((i) => i.precoDe === undefined)).toBe(true);
  });

  it('entende preço acima de mil ao comparar', () => {
    const { itens } = itensDoConteudo([{ descricao: 'TV', preco: '1.234,50', preco_de: '1.500,00' }], colunas);
    expect(itens[0]).toMatchObject({ preco: 'R$ 1.234,50', precoDe: 'R$ 1.500,00' });
  });

  it('data no detalhe aparece como DD/MM/AAAA', () => {
    const { itens } = itensDoConteudo([{ descricao: 'Leite', preco: 5, validade: '2026-12-31' }], colunas);
    expect(itens[0].detalhe).toBe('31/12/2026');
  });

  it('corta no máximo e conta o que ficou de fora', () => {
    const linhas = Array.from({ length: MAX_ITENS_CONTEUDO + 3 }, (_, i) => ({ descricao: `P${i}`, preco: 1 }));
    const r = itensDoConteudo(linhas, colunas);
    expect(r.itens).toHaveLength(MAX_ITENS_CONTEUDO);
    expect(r.cortados).toBe(3);
  });
});

describe('colunas sugeridas', () => {
  it('reconhece os nomes comuns e não toma custo por preço', () => {
    expect(colunasSugeridas(['codigo', 'descricao', 'preco_custo', 'preco', 'preco_de'])).toEqual({ colunaNome: 'descricao', colunaPreco: 'preco', colunaPrecoDe: 'preco_de' });
    expect(colunasSugeridas(['ean', 'preco_custo']).colunaPreco).toBe('');
  });
});

describe('cenas', () => {
  it('muda a grade pelo formato, não pela resolução', () => {
    expect(gradeDaCena('GRADE_OFERTAS', 1920, 1080)).toEqual(gradeDaCena('GRADE_OFERTAS', 3840, 2160));
    expect(gradeDaCena('GRADE_OFERTAS', 1080, 1920)).toEqual({ colunas: 2, linhas: 3 });
    expect(gradeDaCena('GRADE_OFERTAS', 960, 320)).toEqual({ colunas: 3, linhas: 1 });
  });

  it('painel pequeno mostra pouco de cada vez', () => {
    expect(gradeDaCena('LISTA_PRECOS', 128, 64)).toEqual({ colunas: 1, linhas: 1 });
    expect(gradeDaCena('GRADE_OFERTAS', 128, 64)).toEqual({ colunas: 1, linhas: 1 });
    expect(gradeDaCena('GRADE_OFERTAS', 960, 150)).toEqual({ colunas: 2, linhas: 1 });
    expect(gradeDaCena('DESTAQUE', 128, 64)).toEqual({ colunas: 1, linhas: 1 });
  });

  it('cena com poucos produtos ocupa a tela inteira, e nunca perde produto', () => {
    const horizontal = { colunas: 3, linhas: 2 };
    expect(gradeParaItens('GRADE_OFERTAS', horizontal, 1)).toEqual({ colunas: 1, linhas: 1 });
    expect(gradeParaItens('GRADE_OFERTAS', horizontal, 2)).toEqual({ colunas: 2, linhas: 1 });
    expect(gradeParaItens('GRADE_OFERTAS', horizontal, 4)).toEqual({ colunas: 2, linhas: 2 });
    expect(gradeParaItens('GRADE_OFERTAS', horizontal, 6)).toEqual(horizontal);
    const vertical = { colunas: 2, linhas: 3 };
    expect(gradeParaItens('GRADE_OFERTAS', vertical, 2)).toEqual({ colunas: 1, linhas: 2 });
    expect(gradeParaItens('GRADE_OFERTAS', vertical, 5)).toEqual({ colunas: 2, linhas: 3 });
    expect(gradeParaItens('GRADE_OFERTAS', { colunas: 3, linhas: 1 }, 2)).toEqual({ colunas: 2, linhas: 1 });
    expect(gradeParaItens('LISTA_PRECOS', { colunas: 2, linhas: 6 }, 2)).toEqual({ colunas: 2, linhas: 6 });
    for (const g of [horizontal, vertical, { colunas: 3, linhas: 1 }, { colunas: 2, linhas: 1 }]) {
      for (let n = 1; n <= g.colunas * g.linhas; n++) {
        const r = gradeParaItens('GRADE_OFERTAS', g, n);
        expect(r.colunas * r.linhas).toBeGreaterThanOrEqual(n);
      }
    }
  });

  it('divide os itens em cenas', () => {
    expect(cenasDosItens([1, 2, 3, 4, 5, 6, 7], { colunas: 3, linhas: 2 })).toEqual([[1, 2, 3, 4, 5, 6], [7]]);
    expect(cenasDosItens([], { colunas: 1, linhas: 1 })).toEqual([]);
  });
});

describe('animação', () => {
  it('o automático segue o aparelho, e o LED fica no leve', () => {
    expect(nivelEfetivo('AUTOMATICO', 60)).toBe('COMPLETO');
    expect(nivelEfetivo('AUTOMATICO', 20)).toBe('LEVE');
    expect(nivelEfetivo('AUTOMATICO', null)).toBe('LEVE');
    expect(nivelEfetivo('AUTOMATICO', 60, 'LED')).toBe('LEVE');
    expect(nivelEfetivo('ESTATICO', 60)).toBe('ESTATICO');
  });

  it('escolhe o texto legível', () => {
    expect(corDoTextoSobre('#facc15')).toBe('#0f172a');
    expect(corDoTextoSobre('#0f172a')).toBe('#ffffff');
  });
});

describe('validações', () => {
  const ok = { ...CONFIG_CONTEUDO_PADRAO, colunaNome: 'a', colunaPreco: 'b' };

  it('exige as colunas e os limites', () => {
    expect(problemaNaConfigConteudo(ok)).toBeNull();
    expect(problemaNaConfigConteudo({ ...ok, colunaPreco: '' })).toMatch(/preço/);
    expect(problemaNaConfigConteudo({ ...ok, segundosPorCena: 1 })).toMatch(/entre 3 e 120/);
    expect(problemaNaConfigConteudo({ ...ok, corFundo: 'red' })).toMatch(/Cor/);
  });

  it('a validade precisa aguentar uma falha de atualização', () => {
    expect(problemaNosPrazosConteudo(15, 120)).toBeNull();
    expect(problemaNosPrazosConteudo(60, 90)).toMatch(/duas atualizações/);
    expect(problemaNosPrazosConteudo(0, 120)).toMatch(/atualização/);
  });

  it('confere a vigência', () => {
    expect(problemaNaVigencia(semVigencia)).toBeNull();
    expect(problemaNaVigencia({ ...semVigencia, horarioInicio: '08:00' })).toMatch(/início e o fim/);
    expect(problemaNaVigencia({ ...semVigencia, dataInicio: '2026-12-02', dataFim: '2026-12-01' })).toMatch(/antes/);
  });
});

describe('vigência e validade', () => {
  it('respeita datas e horário, inclusive depois da meia-noite', () => {
    const v = { horarioInicio: '18:00', horarioFim: '02:00', dataInicio: '2026-11-10', dataFim: '2026-11-20' };
    expect(conteudoVigente(v, '2026-11-15', '19:00')).toBe(true);
    expect(conteudoVigente(v, '2026-11-15', '01:00')).toBe(true);
    expect(conteudoVigente(v, '2026-11-15', '12:00')).toBe(false);
    expect(conteudoVigente(v, '2026-11-09', '19:00')).toBe(false);
    expect(conteudoVigente(v, '2026-11-21', '19:00')).toBe(false);
    expect(conteudoVigente(semVigencia, '2026-11-15', '12:00')).toBe(true);
  });

  const base = { ...semVigencia, publicado: true, quantidadeItens: 3, dadosEm: '2026-11-08T12:00:00Z', validadeMinutos: 60 };

  it('diz a situação do conteúdo', () => {
    const agora = new Date('2026-11-08T12:30:00Z');
    expect(situacaoDoConteudo(base, agora, '2026-11-08', '09:30')).toBe('NO_AR');
    expect(situacaoDoConteudo({ ...base, publicado: false }, agora, '2026-11-08', '09:30')).toBe('RASCUNHO');
    expect(situacaoDoConteudo({ ...base, dadosEm: null }, agora, '2026-11-08', '09:30')).toBe('SEM_DADOS');
    expect(situacaoDoConteudo({ ...base, quantidadeItens: 0 }, agora, '2026-11-08', '09:30')).toBe('SEM_DADOS');
    expect(situacaoDoConteudo(base, new Date('2026-11-08T13:00:00Z'), '2026-11-08', '10:00')).toBe('DADOS_VENCIDOS');
    expect(situacaoDoConteudo({ ...base, horarioInicio: '18:00', horarioFim: '20:00' }, agora, '2026-11-08', '09:30')).toBe('AGENDADO');
  });

  it('a TV tira sozinha o que venceu, mesmo sem falar com o servidor', () => {
    const valido = dadosValidosAte('2026-11-08T12:00:00Z', 60).toISOString();
    const p = { id: '1', validoAte: valido, itens: [{ nome: 'a', preco: 'b' }] } as ProgramaTela;
    expect(programasValidos([p], new Date('2026-11-08T12:59:00Z'))).toHaveLength(1);
    expect(programasValidos([p], new Date('2026-11-08T13:00:00Z'))).toHaveLength(0);
    expect(programasValidos([{ ...p, itens: [] }], new Date('2026-11-08T12:00:00Z'))).toHaveLength(0);
  });
});

describe('imagens', () => {
  const uma = { imagemId: 'a', segundos: 8 };

  it('exige imagem, tempo válido e cor', () => {
    expect(problemaNasImagensDoConteudo({ imagens: [uma], corFundo: '#000000' })).toBeNull();
    expect(problemaNasImagensDoConteudo({ imagens: [], corFundo: '#000000' })).toMatch(/ao menos uma/);
    expect(problemaNasImagensDoConteudo({ corFundo: '#000000' })).toMatch(/ao menos uma/);
    expect(problemaNasImagensDoConteudo({ imagens: [{ ...uma, segundos: 1 }], corFundo: '#000000' })).toMatch(/entre 3 e 120/);
    expect(problemaNasImagensDoConteudo({ imagens: Array.from({ length: 31 }, () => uma), corFundo: '#000000' })).toMatch(/até 30/);
    expect(problemaNasImagensDoConteudo({ imagens: [uma], corFundo: 'red' })).toMatch(/Cor/);
    expect(problemaNasImagensDoConteudo({ imagens: [uma], corFundo: '#000000', ajuste: 'x' as never })).toMatch(/Ajuste/);
    expect(problemaNasImagensDoConteudo({ imagens: [{ imagemId: 1 as never, segundos: 8 }], corFundo: '#000000' })).toMatch(/inválida/);
  });

  it('validade zero nunca vence: imagem não tem preço que fique velho', () => {
    expect(dadosValidosAte('2026-11-08T12:00:00Z', 0).getFullYear()).toBe(9999);
    const base = { ...semVigencia, publicado: true, quantidadeItens: 1, dadosEm: '2020-01-01T00:00:00Z', validadeMinutos: 0 };
    expect(situacaoDoConteudo(base, new Date('2026-11-08T12:00:00Z'), '2026-11-08', '09:00')).toBe('NO_AR');
  });

  it('programa só de imagens continua valendo, sem itens', () => {
    const p = { id: '1', itens: [], imagens: [{ url: '/x', segundos: 5 }], validoAte: dadosValidosAte('2026-11-08T12:00:00Z', 0).toISOString() } as unknown as ProgramaTela;
    expect(programasValidos([p], new Date('2026-11-08T13:00:00Z'))).toHaveLength(1);
    expect(programasValidos([{ ...p, imagens: [] }], new Date('2026-11-08T13:00:00Z'))).toHaveLength(0);
  });

  it('avisa do formato diferente, sem incomodar por pouca diferença', () => {
    const tela = { largura: 1920, altura: 1080 };
    expect(imagemCombinaComTela({ largura: 3840, altura: 2160 }, tela)).toBe(true);
    expect(imagemCombinaComTela({ largura: 1366, altura: 768 }, tela)).toBe(true);
    expect(imagemCombinaComTela({ largura: 1080, altura: 1920 }, tela)).toBe(false);
    expect(imagemCombinaComTela({ largura: null, altura: null }, tela)).toBe(true);
  });

  it('cada imagem é uma cena', () => {
    expect(gradeDaCena('IMAGENS', 1920, 1080)).toEqual({ colunas: 1, linhas: 1 });
  });
});
