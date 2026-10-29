import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { ApenasSuperAdmin, EmpresaAtual, RequerPermissao } from '../auth/decorators';
import { AuditoriaConsultaService } from './auditoria-consulta.service';

export class FiltrosAuditoriaDto {
  @IsOptional() @IsString() @MaxLength(60) @Matches(/^[a-z_.]+$/, { message: 'Ação inválida.' })
  acao?: string;

  @IsOptional() @IsString() @MaxLength(60)
  entidade?: string;

  @IsOptional() @IsString() @MaxLength(60)
  entidadeId?: string;

  @IsOptional() @IsString() @MaxLength(120)
  usuario?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data inicial inválida.' })
  de?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data final inválida.' })
  ate?: string;

  @IsOptional() @IsString() @MaxLength(200)
  cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limite?: number;
}

export class FiltrosPlataformaDto extends FiltrosAuditoriaDto {
  @IsOptional() @IsUUID('all', { message: 'Empresa inválida.' })
  empresaId?: string;
}

@Controller('auditoria')
export class AuditoriaController {
  constructor(private readonly consulta: AuditoriaConsultaService) {}

  /** Registro da empresa atual. */
  @Get()
  @RequerPermissao('auditoria.ver')
  listar(@EmpresaAtual() empresaId: string, @Query() filtros: FiltrosAuditoriaDto) {
    return this.consulta.listar({ empresaId }, filtros);
  }

  /** Toda a plataforma (inclui ações sem empresa, como cadastro de ERPs e cobrança). */
  @Get('plataforma')
  @ApenasSuperAdmin()
  plataforma(@Query() filtros: FiltrosPlataformaDto) {
    const { empresaId, ...resto } = filtros;
    return this.consulta.listar({ plataforma: true, empresaId }, resto);
  }
}
