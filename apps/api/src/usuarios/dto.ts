import { IsBoolean, IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CriarUsuarioDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nome: string;

  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'A senha deve ter ao menos 8 caracteres.' })
  @MaxLength(200)
  senha: string;

  @IsUUID('all', { message: 'Selecione um perfil.' })
  perfilId: string;
}

export class AtualizarUsuarioDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nome?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email?: string;

  /** Redefinição de senha pelo administrador. */
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'A senha deve ter ao menos 8 caracteres.' })
  @MaxLength(200)
  senha?: string;

  @IsOptional()
  @IsUUID('all', { message: 'Perfil inválido.' })
  perfilId?: string;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}
