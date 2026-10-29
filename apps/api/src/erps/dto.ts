import { FINALIDADES_CONSULTA, TIPOS_BANCO, type FinalidadeConsulta, type TipoBanco } from '@etiquetas/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CriarSistemaErpDto {
  @IsString()
  @MinLength(2, { message: 'O nome deve ter ao menos 2 caracteres.' })
  @MaxLength(120)
  nome: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fabricante?: string;

  @IsIn(TIPOS_BANCO, { message: 'Tipo de banco inválido.' })
  tipoBanco: TipoBanco;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  descricao?: string;
}

export class AtualizarSistemaErpDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'O nome deve ter ao menos 2 caracteres.' })
  @MaxLength(120)
  nome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fabricante?: string;

  @IsOptional()
  @IsIn(TIPOS_BANCO, { message: 'Tipo de banco inválido.' })
  tipoBanco?: TipoBanco;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  descricao?: string;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

export class CampoEsperadoDto {
  @IsString()
  @Matches(/^[A-Za-z_][A-Za-z0-9_]{0,59}$/, { message: 'Nome de campo inválido: use letras, números e _ (ex.: preco_venda).' })
  campo: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  origem?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  descricao?: string;
}

export class TemplateConsultaDto {
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

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CampoEsperadoDto)
  camposEsperados?: CampoEsperadoDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  ordem?: number;
}

export class AtualizarTemplateConsultaDto {
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
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CampoEsperadoDto)
  camposEsperados?: CampoEsperadoDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  ordem?: number;
}

export class CopiarTemplateDto {
  @IsUUID('all', { message: 'Selecione a conexão de banco.' })
  conexaoId: string;

  /** Ausente = todas as consultas do template que a empresa ainda não tem. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  templateIds?: string[];
}
