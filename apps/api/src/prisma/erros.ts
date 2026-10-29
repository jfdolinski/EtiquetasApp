import { Prisma } from '@prisma/client';

/** Violação de restrição UNIQUE (P2002). Usado para tratar corridas após a checagem prévia. */
export function ehViolacaoUnica(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002';
}
