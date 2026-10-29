import { QUANTIDADE_MAXIMA_ITEM, type Registro } from '@etiquetas/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export const MAXIMO_ITENS_POR_PEDIDO = 2000;
/** Etiquetas por pedido de impressão (soma das quantidades). */
export const MAXIMO_ETIQUETAS_POR_PEDIDO = 20_000;

export class QuantidadeItemDto {
  @IsUUID('all')
  id: string;

  @IsInt({ message: 'Quantidade inválida.' })
  @Min(1, { message: 'Quantidade mínima é 1.' })
  @Max(QUANTIDADE_MAXIMA_ITEM, { message: `Quantidade máxima é ${QUANTIDADE_MAXIMA_ITEM}.` })
  quantidade: number;
}

export class ImprimirListaDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Selecione ao menos um item.' })
  @ArrayMaxSize(MAXIMO_ITENS_POR_PEDIDO)
  @ValidateNested({ each: true })
  @Type(() => QuantidadeItemDto)
  itens: QuantidadeItemDto[];
}

export class AtualizarItemDto {
  @IsOptional()
  @IsInt({ message: 'Quantidade inválida.' })
  @Min(1)
  @Max(QUANTIDADE_MAXIMA_ITEM)
  quantidade?: number;

  /** DESCARTADO tira o item da lista (não volta ao atualizar); PENDENTE devolve. */
  @IsOptional()
  @IsIn(['PENDENTE', 'DESCARTADO'], { message: 'Situação inválida.' })
  status?: 'PENDENTE' | 'DESCARTADO';
}

export class BuscarAvulsaDto {
  @IsUUID('all', { message: 'Selecione o modelo.' })
  modeloId: string;

  @IsOptional()
  @IsObject()
  parametros?: Record<string, string | null>;
}

export class ItemAvulsoDto {
  @IsObject()
  registro: Registro;

  @IsInt({ message: 'Quantidade inválida.' })
  @Min(1)
  @Max(QUANTIDADE_MAXIMA_ITEM)
  quantidade: number;
}

export class ImprimirAvulsaDto {
  @IsUUID('all', { message: 'Selecione o modelo.' })
  modeloId: string;

  /** Se ausente, usa a impressora padrão do modelo. */
  @IsOptional()
  @IsUUID('all', { message: 'Impressora inválida.' })
  impressoraId?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Selecione ao menos um produto.' })
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ItemAvulsoDto)
  itens: ItemAvulsoDto[];
}
