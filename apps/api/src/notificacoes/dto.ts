import { CODIGOS_EVENTO, type EventoNotificacao } from '@etiquetas/shared';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export class JanelaDto {
  @Matches(HORA, { message: 'Hora de início inválida.' })
  horaInicio: string;

  @Matches(HORA, { message: 'Hora de fim inválida.' })
  horaFim: string;

  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  diasSemana: number[];
}

export class RegraDto {
  @IsIn(CODIGOS_EVENTO as readonly string[], { message: 'Evento desconhecido.' })
  evento: EventoNotificacao;

  @IsBoolean()
  ativo: boolean;

  @IsInt({ message: 'Limite inválido.' })
  @Min(0)
  @Max(100_000)
  limite: number;

  @IsBoolean()
  canalAgente: boolean;

  @IsBoolean()
  canalSistema: boolean;

  @IsInt({ message: 'Repetição inválida.' })
  @Min(0)
  @Max(43_200, { message: 'Repita no máximo a cada 30 dias.' })
  repetirMinutos: number;

  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  agenteIds: string[];
}

export class SalvarNotificacoesDto {
  @ValidateNested()
  @Type(() => JanelaDto)
  janela: JanelaDto;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RegraDto)
  regras: RegraDto[];
}
