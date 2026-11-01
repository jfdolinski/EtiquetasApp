import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { EmailService } from '../email/email.service';
import { config } from '../config';
import { AuthService } from './auth.service';
import { ContaService } from './conta.service';
import { PermitidoNoApp, Publico, UsuarioAtual } from './decorators';
import { CodigoDto, DesativarDoisFatoresDto, EsqueciSenhaDto, LoginDto, RedefinirSenhaDto, SenhaDto, TrocarSenhaDto } from './dto';
import type { UsuarioRequisicao } from './usuario-requisicao';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly conta: ContaService,
    private readonly email: EmailService,
  ) {}

  @Post('login')
  @Publico()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.senha, dto.codigo, { ip: req.ip, agente: req.headers['user-agent'] });
  }

  /** O que a tela de login pode oferecer. */
  @Get('opcoes')
  @Publico()
  opcoes() {
    return { esqueciSenha: this.email.disponivel && Boolean(config().urlPublica) };
  }

  @Post('esqueci-senha')
  @Publico()
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async esqueciSenha(@Body() dto: EsqueciSenhaDto) {
    await this.conta.pedirRedefinicao(dto.email);
  }

  @Post('redefinir-senha')
  @Publico()
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async redefinirSenha(@Body() dto: RedefinirSenhaDto) {
    await this.conta.redefinirSenha(dto.token, dto.novaSenha);
  }

  @Get('me')
  @PermitidoNoApp()
  me(@UsuarioAtual() usuario: UsuarioRequisicao) {
    return this.auth.usuarioLogado(usuario.id);
  }

  @Post('trocar-senha')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async trocarSenha(@UsuarioAtual() usuario: UsuarioRequisicao, @Body() dto: TrocarSenhaDto) {
    await this.auth.trocarSenha(usuario.id, dto.senhaAtual, dto.novaSenha, usuario.sessaoId);
  }

  @Get('sessoes')
  sessoes(@UsuarioAtual() usuario: UsuarioRequisicao) {
    return this.conta.sessoes(usuario.id, usuario.sessaoId);
  }

  @Post('sessoes/encerrar-outras')
  @HttpCode(200)
  encerrarOutras(@UsuarioAtual() usuario: UsuarioRequisicao) {
    return this.conta.encerrarOutras(usuario.id, usuario.sessaoId);
  }

  @Delete('sessoes/:id')
  @HttpCode(204)
  async encerrarSessao(@UsuarioAtual() usuario: UsuarioRequisicao, @Param('id', ParseUUIDPipe) id: string) {
    await this.conta.encerrarSessao(usuario.id, id, usuario.empresaId);
  }

  @Post('2fa/iniciar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  iniciarDoisFatores(@UsuarioAtual() usuario: UsuarioRequisicao, @Body() dto: SenhaDto) {
    return this.conta.iniciarDoisFatores(usuario.id, dto.senha);
  }

  @Post('2fa/ativar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  ativarDoisFatores(@UsuarioAtual() usuario: UsuarioRequisicao, @Body() dto: CodigoDto) {
    return this.conta.ativarDoisFatores(usuario.id, dto.codigo);
  }

  @Post('2fa/desativar')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async desativarDoisFatores(@UsuarioAtual() usuario: UsuarioRequisicao, @Body() dto: DesativarDoisFatoresDto) {
    await this.conta.desativarDoisFatores(usuario.id, dto.senha, dto.codigo);
  }
}
