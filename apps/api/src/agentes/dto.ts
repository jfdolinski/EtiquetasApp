import { TIPOS_BANCO, type TipoBanco } from '@etiquetas/shared';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CriarAgenteDto {
  @IsString()
  @MinLength(2, { message: 'O nome deve ter ao menos 2 caracteres.' })
  @MaxLength(80)
  nome: string;
}

export class AtualizarAgenteDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'O nome deve ter ao menos 2 caracteres.' })
  @MaxLength(80)
  nome?: string;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

export class AtivarAgenteDto {
  @IsString()
  @MaxLength(20)
  cnpj: string;

  @IsString()
  @MaxLength(20)
  codigo: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  hostname?: string;
}

export class OpcoesConexaoDto {
  @IsOptional()
  @IsIn(['disable', 'require', 'verify-full', 'true', 'false', 'skip-verify'], { message: 'Modo de SSL inválido.' })
  ssl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  instancia?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600, { message: 'O tempo limite máximo é de 600 segundos.' })
  tempoLimiteSegundos?: number;
}

export class CriarConexaoDto {
  @IsUUID('all', { message: 'Selecione um agente.' })
  agenteId: string;

  @IsString()
  @MinLength(2, { message: 'O nome deve ter ao menos 2 caracteres.' })
  @MaxLength(80)
  nome: string;

  @IsIn(TIPOS_BANCO, { message: 'Tipo de banco inválido.' })
  tipo: TipoBanco;

  @IsString()
  @MinLength(1, { message: 'Informe o servidor.' })
  @MaxLength(255)
  host: string;

  @IsInt({ message: 'Porta inválida.' })
  @Min(1, { message: 'Porta inválida.' })
  @Max(65535, { message: 'Porta inválida.' })
  porta: number;

  @IsString()
  @MinLength(1, { message: 'Informe o banco de dados.' })
  @MaxLength(128)
  banco: string;

  @IsString()
  @MinLength(1, { message: 'Informe o usuário.' })
  @MaxLength(128)
  usuario: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  senha?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => OpcoesConexaoDto)
  opcoes?: OpcoesConexaoDto;
}

export class AtualizarConexaoDto {
  @IsOptional()
  @IsUUID('all', { message: 'Selecione um agente.' })
  agenteId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'O nome deve ter ao menos 2 caracteres.' })
  @MaxLength(80)
  nome?: string;

  @IsOptional()
  @IsIn(TIPOS_BANCO, { message: 'Tipo de banco inválido.' })
  tipo?: TipoBanco;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Informe o servidor.' })
  @MaxLength(255)
  host?: string;

  @IsOptional()
  @IsInt({ message: 'Porta inválida.' })
  @Min(1, { message: 'Porta inválida.' })
  @Max(65535, { message: 'Porta inválida.' })
  porta?: number;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Informe o banco de dados.' })
  @MaxLength(128)
  banco?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Informe o usuário.' })
  @MaxLength(128)
  usuario?: string;

  /** Ausente = mantém a senha gravada; string vazia = remove. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  senha?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => OpcoesConexaoDto)
  opcoes?: OpcoesConexaoDto;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

export class ConsultarDto {
  @IsString()
  @MinLength(1, { message: 'Informe o SQL.' })
  @MaxLength(100_000)
  sql: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000, { message: 'O teste retorna no máximo 1000 linhas.' })
  limiteLinhas?: number;
}
