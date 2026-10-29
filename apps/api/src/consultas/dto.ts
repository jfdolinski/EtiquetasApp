import { FINALIDADES_CONSULTA, type FinalidadeConsulta } from '@etiquetas/shared';
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
} from 'class-validator';

/** Valores de `{param.*}`: nome sem o prefixo → texto (null = NULL). */
export type ValoresParametros = Record<string, string | null>;

export class CriarConsultaDto {
  @IsUUID('all', { message: 'Selecione a conexão de banco.' })
  conexaoId: string;

  @IsString()
  @MinLength(2, { message: 'O nome deve ter ao menos 2 caracteres.' })
  @MaxLength(80)
  nome: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descricao?: string;

  @IsOptional()
  @IsIn(FINALIDADES_CONSULTA, { message: 'Finalidade inválida.' })
  finalidade?: FinalidadeConsulta;

  @IsString()
  @MinLength(1, { message: 'Informe o SQL.' })
  @MaxLength(100_000)
  sql: string;
}

export class AtualizarConsultaDto {
  @IsOptional()
  @IsUUID('all', { message: 'Selecione a conexão de banco.' })
  conexaoId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'O nome deve ter ao menos 2 caracteres.' })
  @MaxLength(80)
  nome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descricao?: string;

  @IsOptional()
  @IsIn(FINALIDADES_CONSULTA, { message: 'Finalidade inválida.' })
  finalidade?: FinalidadeConsulta;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Informe o SQL.' })
  @MaxLength(100_000)
  sql?: string;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

export class PreviaConsultaDto {
  @IsUUID('all', { message: 'Selecione a conexão de banco.' })
  conexaoId: string;

  @IsString()
  @MinLength(1, { message: 'Informe o SQL.' })
  @MaxLength(100_000)
  sql: string;

  @IsOptional()
  @IsObject()
  parametros?: ValoresParametros;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000, { message: 'A prévia retorna no máximo 1000 linhas.' })
  limiteLinhas?: number;
}
