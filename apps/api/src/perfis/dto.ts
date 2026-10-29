import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  type ValidationArguments,
} from 'class-validator';
import { CODIGOS_PERMISSAO, type CodigoPermissao } from '@etiquetas/shared';

const PERMISSAO_INVALIDA = {
  each: true,
  message: ({ value }: ValidationArguments) => {
    const lista: unknown[] = Array.isArray(value) ? value : [value];
    const desconhecidas = lista.filter((v) => !(CODIGOS_PERMISSAO as readonly unknown[]).includes(v));
    return `Permissão desconhecida: ${desconhecidas.join(', ')}`;
  },
};

export class CriarPerfilDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  nome: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  descricao?: string;

  @IsArray()
  @ArrayUnique()
  @IsIn(CODIGOS_PERMISSAO as CodigoPermissao[], PERMISSAO_INVALIDA)
  permissoes: CodigoPermissao[];
}

export class AtualizarPerfilDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  nome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  descricao?: string;

  /** Quando informado, substitui todas as permissões do perfil. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(CODIGOS_PERMISSAO as CodigoPermissao[], PERMISSAO_INVALIDA)
  permissoes?: CodigoPermissao[];
}
