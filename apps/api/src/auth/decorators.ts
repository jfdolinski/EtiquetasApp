import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { CodigoPermissao } from '@etiquetas/shared';
import { resolverEmpresaId } from './empresa-atual';
import type { RequisicaoAutenticada, UsuarioRequisicao } from './usuario-requisicao';

export const CHAVE_PUBLICO = 'publico';
export const CHAVE_PERMISSOES = 'permissoes';
export const CHAVE_SUPER_ADMIN = 'apenasSuperAdmin';

/** Rota acessível sem token. */
export const Publico = () => SetMetadata(CHAVE_PUBLICO, true);

/** Exige todas as permissões informadas (super-admin passa sempre). */
export const RequerPermissao = (...codigos: CodigoPermissao[]) => SetMetadata(CHAVE_PERMISSOES, codigos);

/** Rota da plataforma, restrita ao super-admin. */
export const ApenasSuperAdmin = () => SetMetadata(CHAVE_SUPER_ADMIN, true);

export const UsuarioAtual = createParamDecorator((_: unknown, ctx: ExecutionContext): UsuarioRequisicao => {
  return ctx.switchToHttp().getRequest<RequisicaoAutenticada>().usuario!;
});

/**
 * Id da empresa (tenant) em que a requisição opera. Use em toda rota de dados do tenant;
 * nunca aceite `empresaId` vindo do corpo ou da query.
 */
export const EmpresaAtual = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  return resolverEmpresaId(ctx.switchToHttp().getRequest<RequisicaoAutenticada>());
});
