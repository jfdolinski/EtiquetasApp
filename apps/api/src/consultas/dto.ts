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
  ValidateIf,
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

  /** Sem `arquivo`, é SQL; com `arquivo`, consulta de planilha. A API confere com o tipo da conexão. */
  @ValidateIf((o: CriarConsultaDto) => !o.arquivo)
  @IsString()
  @MinLength(1, { message: 'Informe o SQL.' })
  @MaxLength(100_000)
  sql?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  arquivo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  arquivoNome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  aba?: string;
}

export class SalvarRotulosDto {
  @IsObject()
  rotulos: Record<string, unknown>;
}

/** Testa um arquivo no editor, antes de salvar a consulta. */
export class PreviaPlanilhaDto {
  @IsUUID('all', { message: 'Selecione a conexão.' })
  conexaoId: string;

  @IsString()
  @MinLength(1, { message: 'Escolha o arquivo.' })
  @MaxLength(1000)
  arquivo: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  aba?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  termo?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000, { message: 'A prévia retorna no máximo 1000 linhas.' })
  limiteLinhas?: number;
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
  @MaxLength(100_000)
  sql?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  arquivo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  arquivoNome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  aba?: string;

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
