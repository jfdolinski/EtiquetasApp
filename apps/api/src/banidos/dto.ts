import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class BanirDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Informe ao menos um código de barras.' })
  @ArrayMaxSize(5000, { message: 'No máximo 5.000 códigos por vez.' })
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  codigos: string[];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  motivo?: string;
}

export class LiberarBanidosDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Selecione ao menos um código.' })
  @ArrayMaxSize(5000, { message: 'No máximo 5.000 códigos por vez.' })
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  codigos: string[];
}