import { Controller, Get, Query } from '@nestjs/common';
import { PERIODOS_PAINEL } from '@etiquetas/shared';
import { ApenasSuperAdmin, EmpresaAtual, RequerPermissao } from '../auth/decorators';
import { PainelService } from './painel.service';

function periodo(valor: string | undefined): number {
  const n = Number(valor);
  return (PERIODOS_PAINEL as readonly number[]).includes(n) ? n : 7;
}

@Controller('painel')
export class PainelController {
  constructor(private readonly painel: PainelService) {}

  @Get()
  @RequerPermissao('painel.ver')
  empresa(@EmpresaAtual() empresaId: string, @Query('dias') dias?: string) {
    return this.painel.empresa(empresaId, periodo(dias));
  }

  @Get('plataforma')
  @ApenasSuperAdmin()
  plataforma(@Query('dias') dias?: string) {
    return this.painel.plataforma(periodo(dias));
  }
}
