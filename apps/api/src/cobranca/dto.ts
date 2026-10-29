import { IsBoolean, IsDateString, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

const DIAS = { min: 0, max: 365 };

export class ParametrosGlobaisDto {
  @IsInt() @Min(DIAS.min) @Max(DIAS.max)
  diasAvisoPrevio: number;

  @IsInt() @Min(DIAS.min) @Max(DIAS.max)
  diasCarencia: number;

  @IsInt() @Min(0) @Max(DIAS.max)
  diasAteBloqueio: number;

  @IsInt() @Min(1, { message: 'A frequência mínima é de 1 dia.' }) @Max(DIAS.max)
  frequenciaAvisoDias: number;

  @IsInt() @Min(0) @Max(23)
  horaAvaliacao: number;

  @IsString() @MinLength(1) @MaxLength(1000)
  mensagemAvisoPrevio: string;

  @IsString() @MinLength(1) @MaxLength(1000)
  mensagemCarencia: string;

  @IsString() @MinLength(1) @MaxLength(1000)
  mensagemPreBloqueio: string;

  @IsString() @MinLength(1) @MaxLength(1000)
  mensagemBloqueio: string;
}

/** Sobrescrita por empresa: null = herda o global. */
export class ParametrosEmpresaDto {
  @ValidateIf((_, v) => v !== null) @IsInt() @Min(DIAS.min) @Max(DIAS.max)
  diasAvisoPrevio: number | null;

  @ValidateIf((_, v) => v !== null) @IsInt() @Min(DIAS.min) @Max(DIAS.max)
  diasCarencia: number | null;

  @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(DIAS.max)
  diasAteBloqueio: number | null;

  @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(DIAS.max)
  frequenciaAvisoDias: number | null;
}

export class AssinaturaDto {
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor inválido.' })
  @Min(0)
  @Max(1_000_000)
  valorMensal: number;

  @IsInt() @Min(1) @Max(31)
  diaVencimento: number;

  /** Vencimento em aberto mais antigo (AAAA-MM-DD). */
  @IsDateString({ strict: true }, { message: 'Data de vencimento inválida.' })
  vencimentoAtual: string;

  @IsOptional()
  @IsBoolean()
  controleManual?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacoes?: string;
}

export class PagamentoDto {
  /** Se ausente: valor mensal × meses. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor inválido.' })
  @Min(0)
  @Max(10_000_000)
  valor?: number;

  @IsInt() @Min(1) @Max(36)
  meses: number;

  @IsDateString({ strict: true }, { message: 'Data de pagamento inválida.' })
  pagoEm: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacao?: string;
}
