import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { resolverEmpresaId } from './empresa-atual';
import type { RequisicaoAutenticada } from './usuario-requisicao';

const EMPRESA_A = '11111111-1111-4111-8111-111111111111';
const EMPRESA_B = '22222222-2222-4222-8222-222222222222';

function req(parcial: Partial<RequisicaoAutenticada>): RequisicaoAutenticada {
  return { headers: {}, ...parcial } as RequisicaoAutenticada;
}

describe('resolverEmpresaId', () => {
  it('usuário comum sempre opera na própria empresa, ignorando o cabeçalho', () => {
    const r = req({
      usuario: { id: 'u', empresaId: EMPRESA_A, superAdmin: false, permissoes: [] },
      headers: { 'x-empresa-id': EMPRESA_B },
    });
    expect(resolverEmpresaId(r)).toBe(EMPRESA_A);
  });

  it('super-admin usa a empresa do cabeçalho', () => {
    const r = req({
      usuario: { id: 's', empresaId: null, superAdmin: true, permissoes: [] },
      headers: { 'x-empresa-id': EMPRESA_B },
    });
    expect(resolverEmpresaId(r)).toBe(EMPRESA_B);
  });

  it('super-admin sem cabeçalho válido recebe 400', () => {
    const usuario = { id: 's', empresaId: null, superAdmin: true, permissoes: [] };
    expect(() => resolverEmpresaId(req({ usuario }))).toThrow(BadRequestException);
    expect(() => resolverEmpresaId(req({ usuario, headers: { 'x-empresa-id': 'nao-e-uuid' } }))).toThrow(
      BadRequestException,
    );
  });

  it('usuário comum sem empresa recebe 403; sem usuário, 401', () => {
    expect(() =>
      resolverEmpresaId(req({ usuario: { id: 'u', empresaId: null, superAdmin: false, permissoes: [] } })),
    ).toThrow(ForbiddenException);
    expect(() => resolverEmpresaId(req({}))).toThrow(UnauthorizedException);
  });
});
