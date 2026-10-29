import { Module } from '@nestjs/common';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { config } from '../config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { InicializacaoService } from './inicializacao.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: config().jwtSegredo,
        signOptions: { expiresIn: config().jwtExpiracao as JwtSignOptions['expiresIn'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, InicializacaoService],
  // JwtModule é exportado para o AuthGuard global (registrado no AppModule).
  exports: [JwtModule],
})
export class AuthModule {}
