import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common';

/**
 * Mensagens padrão do class-validator em português. Só substitui as mensagens em inglês
 * geradas pela biblioteca; as personalizadas nos DTOs (já em português) ficam como estão.
 */
// (c = nome do campo, [n] = limite extraído da mensagem original)
const TRADUCOES: Record<string, (c: string, limites: unknown[]) => string> = {
  isString: (c) => `O campo "${c}" deve ser um texto.`,
  isInt: (c) => `O campo "${c}" deve ser um número inteiro.`,
  isNumber: (c) => `O campo "${c}" deve ser um número.`,
  isBoolean: (c) => `O campo "${c}" deve ser verdadeiro ou falso.`,
  isObject: (c) => `O campo "${c}" deve ser um objeto.`,
  isArray: (c) => `O campo "${c}" deve ser uma lista.`,
  isEmail: (c) => `O campo "${c}" deve ser um e-mail válido.`,
  isUuid: (c) => `O campo "${c}" deve ser um identificador válido.`,
  isDateString: (c) => `O campo "${c}" deve ser uma data válida.`,
  isIn: (c, [lista]) => `O campo "${c}" deve ser um destes valores: ${(lista as unknown[]).join(', ')}.`,
  minLength: (c, [n]) => `O campo "${c}" deve ter ao menos ${n} caractere(s).`,
  maxLength: (c, [n]) => `O campo "${c}" deve ter no máximo ${n} caractere(s).`,
  min: (c, [n]) => `O campo "${c}" deve ser no mínimo ${n}.`,
  max: (c, [n]) => `O campo "${c}" deve ser no máximo ${n}.`,
  arrayMinSize: (c, [n]) => `O campo "${c}" deve ter ao menos ${n} item(ns).`,
  arrayMaxSize: (c, [n]) => `O campo "${c}" deve ter no máximo ${n} item(ns).`,
  matches: (c) => `O campo "${c}" está em formato inválido.`,
  isNotEmpty: (c) => `O campo "${c}" é obrigatório.`,
  isDefined: (c) => `O campo "${c}" é obrigatório.`,
  whitelistValidation: (c) => `O campo "${c}" não é permitido.`,
  nestedValidation: (c) => `O campo "${c}" é inválido.`,
};

/** Mensagens geradas pelo class-validator começam com o nome da propriedade e usam inglês. */
const PADRAO_INGLES = /\b(must|should|property)\b/;

export function traduzirErros(erros: ValidationError[], prefixo = ''): string[] {
  const mensagens: string[] = [];
  for (const e of erros) {
    const campo = prefixo + e.property;
    for (const [regra, mensagem] of Object.entries(e.constraints ?? {})) {
      const traduzir = TRADUCOES[regra];
      if (traduzir && PADRAO_INGLES.test(mensagem)) {
        mensagens.push(traduzir(campo, extrairLimites(regra, mensagem)));
      } else {
        mensagens.push(mensagem);
      }
    }
    if (e.children?.length) mensagens.push(...traduzirErros(e.children, `${campo}.`));
  }
  return mensagens;
}

/** Os limites (ex.: 8 em "must be longer than or equal to 8 characters") só estão no texto. */
function extrairLimites(regra: string, mensagem: string): unknown[] {
  if (regra === 'isIn') return [mensagem.split(': ').slice(1).join(': ').split(', ')];
  const n = mensagem.match(/(-?\d+(?:\.\d+)?)/);
  return [n ? n[1] : '?'];
}

export function criarValidationPipe() {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (erros) => new BadRequestException(traduzirErros(erros)),
  });
}
