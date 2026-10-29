import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { STATUS_ASSINATURA, type StatusAssinatura } from '@etiquetas/shared';

export class AdminInicialDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nome: string;

  @IsEmail({}, { message: 'E-mail do administrador inválido.' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'A senha do administrador deve ter ao menos 8 caracteres.' })
  @MaxLength(200)
  senha: string;
}

export class CriarEmpresaDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  razaoSocial: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nomeFantasia?: string;

  /** Validado no serviço (aceita máscara e CNPJ alfanumérico). */
  @IsString()
  cnpj: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  codigoErp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  plano?: string;

  @ValidateNested()
  @Type(() => AdminInicialDto)
  admin: AdminInicialDto;
}

export class AtualizarEmpresaDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  razaoSocial?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nomeFantasia?: string;

  @IsOptional()
  @IsString()
  cnpj?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  codigoErp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  plano?: string;

  @IsOptional()
  @IsIn(STATUS_ASSINATURA as StatusAssinatura[])
  statusAssinatura?: StatusAssinatura;

  @IsOptional()
  @IsBoolean()
  ativa?: boolean;
}
