import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email: string;

  @IsString()
  @MinLength(1, { message: 'Informe a senha.' })
  @MaxLength(200)
  senha: string;

  /** Código do autenticador ou de recuperação, na segunda etapa. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  codigo?: string;
}

export class SenhaDto {
  @IsString()
  @MinLength(1, { message: 'Informe a senha.' })
  @MaxLength(200)
  senha: string;
}

export class CodigoDto {
  @IsString()
  @MinLength(1, { message: 'Informe o código.' })
  @MaxLength(20)
  codigo: string;
}

export class DesativarDoisFatoresDto extends SenhaDto {
  @IsString()
  @MinLength(1, { message: 'Informe o código.' })
  @MaxLength(20)
  codigo: string;
}

export class EsqueciSenhaDto {
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email: string;
}

export class RedefinirSenhaDto {
  @IsString()
  @MinLength(20, { message: 'Link inválido.' })
  @MaxLength(200)
  token: string;

  @IsString()
  @MinLength(8, { message: 'A nova senha deve ter ao menos 8 caracteres.' })
  @MaxLength(200)
  novaSenha: string;
}

export class TrocarSenhaDto {
  @IsString()
  senhaAtual: string;

  @IsString()
  @MinLength(8, { message: 'A nova senha deve ter ao menos 8 caracteres.' })
  @MaxLength(200)
  novaSenha: string;
}
