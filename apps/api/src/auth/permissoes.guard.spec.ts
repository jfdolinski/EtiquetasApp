import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApenasSuperAdmin, Publico, RequerPermissao } from './decorators';
import { PermissoesGuard } from './permissoes.guard';
import { contextoHttp } from '../testes/contexto-http';
import type { UsuarioRequisicao } from './usuario-requisicao';

class Rotas {
  @Publico() publica() {}
  @RequerPermissao('usuario.editar') editarUsuario() {}
  @RequerPermissao('usuario.ver', 'perfil.ver') verAmbos() {}
  autenticada() {}
}

@ApenasSuperAdmin()
class RotasPlataforma {
  listar() {}
}

const operador: UsuarioRequisicao = { id: 'u1', empresaId: 'e1', superAdmin: false, permissoes: ['usuario.ver'] };
const superAdmin: UsuarioRequisicao = { id: 's1', empresaId: null, superAdmin: true, permissoes: [] };

describe('PermissoesGuard', () => {
  const guard = new PermissoesGuard(new Reflector());

  it('libera rota pública sem usuário', () => {
    expect(guard.canActivate(contextoHttp({}, Rotas, 'publica'))).toBe(true);
  });

  it('libera rota autenticada sem permissão exigida', () => {
    expect(guard.canActivate(contextoHttp({ usuario: operador }, Rotas, 'autenticada'))).toBe(true);
  });

  it('nega quando falta a permissão e informa qual', () => {
    expect(() => guard.canActivate(contextoHttp({ usuario: operador }, Rotas, 'editarUsuario'))).toThrow(
      new ForbiddenException('Permissão necessária: usuario.editar.'),
    );
  });

  it('exige todas as permissões listadas', () => {
    expect(() => guard.canActivate(contextoHttp({ usuario: operador }, Rotas, 'verAmbos'))).toThrow(ForbiddenException);
    const completo = { ...operador, permissoes: ['usuario.ver', 'perfil.ver'] };
    expect(guard.canActivate(contextoHttp({ usuario: completo }, Rotas, 'verAmbos'))).toBe(true);
  });

  it('super-admin passa em qualquer permissão', () => {
    expect(guard.canActivate(contextoHttp({ usuario: superAdmin }, Rotas, 'editarUsuario'))).toBe(true);
  });

  it('rota de plataforma é exclusiva do super-admin', () => {
    const todas = { ...operador, permissoes: ['usuario.ver', 'usuario.editar', 'perfil.ver', 'perfil.editar'] };
    expect(() => guard.canActivate(contextoHttp({ usuario: todas }, RotasPlataforma, 'listar'))).toThrow(
      ForbiddenException,
    );
    expect(guard.canActivate(contextoHttp({ usuario: superAdmin }, RotasPlataforma, 'listar'))).toBe(true);
  });
});
