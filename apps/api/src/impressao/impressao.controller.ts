import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { EmpresaAtual, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AtualizarItemDto, BuscarAvulsaDto, ImprimirAvulsaDto, ImprimirListaDto } from './dto';
import { ListasService } from './listas.service';
import { TrabalhosService } from './trabalhos.service';

const EXTENSAO = { ZPL: 'zpl', PPLA: 'ppla', PPLB: 'pplb', ESCPOS: 'bin', PDF: 'pdf' } as const;
const MIME = { ZPL: 'text/plain; charset=utf-8', PPLA: 'text/plain', PPLB: 'text/plain', ESCPOS: 'application/octet-stream', PDF: 'application/pdf' } as const;

@Controller('listas')
export class ListasController {
  constructor(private readonly listas: ListasService) {}

  @Get('hoje')
  @RequerPermissao('imprimir')
  async hoje(@EmpresaAtual() empresaId: string) {
    return { lista: await this.listas.deHoje(empresaId) };
  }

  @Post('hoje/gerar')
  @HttpCode(200)
  @RequerPermissao('imprimir')
  gerar(@EmpresaAtual() empresaId: string, @UsuarioAtual() usuario: UsuarioRequisicao) {
    return this.listas.gerar(empresaId, usuario.id);
  }

  @Patch('itens/:id')
  @RequerPermissao('imprimir')
  atualizarItem(
    @EmpresaAtual() empresaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarItemDto,
    @UsuarioAtual() usuario: UsuarioRequisicao,
  ) {
    return this.listas.atualizarItem(empresaId, id, dto, usuario.id);
  }

  @Post(':id/imprimir')
  @HttpCode(200)
  @RequerPermissao('imprimir')
  imprimir(
    @EmpresaAtual() empresaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImprimirListaDto,
    @UsuarioAtual() usuario: UsuarioRequisicao,
  ) {
    return this.listas.imprimirLista(empresaId, id, dto, usuario.id);
  }
}

@Controller('avulsa')
export class AvulsaController {
  constructor(private readonly listas: ListasService) {}

  @Get('modelos')
  @RequerPermissao('imprimir')
  modelos(@EmpresaAtual() empresaId: string) {
    return this.listas.modelosAvulsos(empresaId);
  }

  @Post('buscar')
  @HttpCode(200)
  @RequerPermissao('imprimir')
  buscar(@EmpresaAtual() empresaId: string, @Body() dto: BuscarAvulsaDto, @UsuarioAtual() usuario: UsuarioRequisicao) {
    return this.listas.buscarAvulsa(empresaId, dto.modeloId, dto.parametros ?? {}, usuario.id);
  }

  @Post('imprimir')
  @HttpCode(200)
  @RequerPermissao('imprimir')
  imprimir(@EmpresaAtual() empresaId: string, @Body() dto: ImprimirAvulsaDto, @UsuarioAtual() usuario: UsuarioRequisicao) {
    return this.listas.imprimirAvulsa(empresaId, dto, usuario.id);
  }
}

@Controller('trabalhos')
export class TrabalhosController {
  constructor(private readonly trabalhos: TrabalhosService) {}

  /** Histórico; com `ids=a,b` devolve só esses (acompanhamento após imprimir). */
  @Get()
  @RequerPermissao('imprimir')
  listar(@EmpresaAtual() empresaId: string, @Query('ids') ids?: string, @Query('limite') limite?: string) {
    if (ids) return this.trabalhos.situacao(empresaId, ids.split(',').filter((i) => /^[0-9a-f-]{36}$/i.test(i)));
    return this.trabalhos.listar(empresaId, Number(limite) || 100);
  }

  @Get(':id/conteudo')
  @RequerPermissao('imprimir')
  async conteudo(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const t = await this.trabalhos.conteudo(empresaId, id);
    const nome = `etiquetas-${t.criadoEm.toISOString().slice(0, 10)}-${id.slice(0, 8)}.${EXTENSAO[t.linguagem]}`;
    res.setHeader('Content-Type', MIME[t.linguagem]);
    res.setHeader('Content-Disposition', `inline; filename="${nome}"`);
    res.send(Buffer.from(t.conteudo));
  }

  @Post(':id/reenviar')
  @HttpCode(200)
  @RequerPermissao('imprimir')
  reenviar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() usuario: UsuarioRequisicao) {
    return this.trabalhos.reenviar(empresaId, id, usuario.id);
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @RequerPermissao('imprimir')
  cancelar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() usuario: UsuarioRequisicao) {
    return this.trabalhos.cancelar(empresaId, id, usuario.id);
  }
}
