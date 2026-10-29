import { DPIS, LINGUAGENS, type LayoutEtiqueta, type LinguagemImpressora, type MetodoImpressora, type Registro } from '@etiquetas/shared';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
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

/** O layout é validado por `validarLayout` (packages/shared) no serviço. */
export class CriarModeloDto {
  @IsString()
  @MinLength(2, { message: 'O nome deve ter ao menos 2 caracteres.' })
  @MaxLength(80)
  nome: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descricao?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID('all', { message: 'Consulta inválida.' })
  consultaId?: string | null;

  @IsObject({ message: 'Layout inválido.' })
  layout: LayoutEtiqueta;
}

export class AtualizarModeloDto {
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
  @ValidateIf((_, v) => v !== null)
  @IsUUID('all', { message: 'Consulta inválida.' })
  consultaId?: string | null;

  @IsOptional()
  @IsObject({ message: 'Layout inválido.' })
  layout?: LayoutEtiqueta;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

export class AmostraDto {
  /** Valores de `{param.*}` da consulta. */
  @IsOptional()
  @IsObject()
  parametros?: Record<string, string | null>;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limite?: number;
}

export const MAXIMO_ETIQUETAS_GERAR = 500;

export class GerarDto {
  @IsObject({ message: 'Layout inválido.' })
  layout: LayoutEtiqueta;

  /** Linguagem e DPI vêm da impressora, quando informada. */
  @IsOptional()
  @IsUUID('all', { message: 'Impressora inválida.' })
  impressoraId?: string;

  @IsOptional()
  @IsIn(LINGUAGENS, { message: 'Linguagem inválida.' })
  linguagem?: LinguagemImpressora;

  @IsOptional()
  @IsIn(DPIS, { message: 'DPI inválido.' })
  dpi?: number;

  @IsArray()
  @ArrayMaxSize(MAXIMO_ETIQUETAS_GERAR, { message: `No máximo ${MAXIMO_ETIQUETAS_GERAR} etiquetas por geração.` })
  registros: Registro[];
}

export class CriarImpressoraDto {
  @IsString()
  @MinLength(2, { message: 'O nome deve ter ao menos 2 caracteres.' })
  @MaxLength(80)
  nome: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID('all', { message: 'Agente inválido.' })
  agenteId?: string | null;

  @IsIn(LINGUAGENS, { message: 'Linguagem inválida.' })
  linguagem: LinguagemImpressora;

  @IsIn(DPIS, { message: 'DPI inválido.' })
  dpi: number;

  @IsIn(['REDE', 'SISTEMA'], { message: 'Método inválido.' })
  metodo: MetodoImpressora;

  @IsString()
  @MinLength(1, { message: 'Informe o endereço ou o nome da impressora.' })
  @MaxLength(255)
  endereco: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  modelo?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(10)
  @Max(1200)
  larguraMaximaMm?: number | null;
}

export class AtualizarImpressoraDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'O nome deve ter ao menos 2 caracteres.' })
  @MaxLength(80)
  nome?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID('all', { message: 'Agente inválido.' })
  agenteId?: string | null;

  @IsOptional()
  @IsIn(LINGUAGENS, { message: 'Linguagem inválida.' })
  linguagem?: LinguagemImpressora;

  @IsOptional()
  @IsIn(DPIS, { message: 'DPI inválido.' })
  dpi?: number;

  @IsOptional()
  @IsIn(['REDE', 'SISTEMA'], { message: 'Método inválido.' })
  metodo?: MetodoImpressora;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Informe o endereço ou o nome da impressora.' })
  @MaxLength(255)
  endereco?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  modelo?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(10)
  @Max(1200)
  larguraMaximaMm?: number | null;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}
