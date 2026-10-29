import { describe, expect, it } from 'vitest';
import { situacaoCopia } from './erp';

describe('situacaoCopia', () => {
  it('compara a cópia e o template com o SQL do momento da cópia', () => {
    expect(situacaoCopia('a', 'a', 'a')).toBe('igual');
    expect(situacaoCopia('b', 'a', 'a')).toBe('ajustada');
    expect(situacaoCopia('a', 'a', 'c')).toBe('template_atualizado');
    expect(situacaoCopia('b', 'a', 'c')).toBe('ambos');
  });
});
