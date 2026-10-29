import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { Publico, UsuarioAtual } from './decorators';
import { LoginDto, TrocarSenhaDto } from './dto';
import type { UsuarioRequisicao } from './usuario-requisicao';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @Publico()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.senha);
  }

  @Get('me')
  me(@UsuarioAtual() usuario: UsuarioRequisicao) {
    return this.auth.usuarioLogado(usuario.id);
  }

  @Post('trocar-senha')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async trocarSenha(@UsuarioAtual() usuario: UsuarioRequisicao, @Body() dto: TrocarSenhaDto) {
    await this.auth.trocarSenha(usuario.id, dto.senhaAtual, dto.novaSenha);
  }
}
