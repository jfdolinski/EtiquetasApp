import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { normalizarCnpj, validarCnpj, type DadosCnpj } from '@etiquetas/shared';
import { ApenasSuperAdmin, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { ConsultaCnpjService } from './consulta-cnpj';
import { AtualizarEmpresaDto, CriarEmpresaDto } from './dto';
import { EmpresasService } from './empresas.service';

@Controller('empresas')
@ApenasSuperAdmin()
export class EmpresasController {
  constructor(
    private readonly empresas: EmpresasService,
    private readonly consultaCnpj: ConsultaCnpjService,
  ) {}

  @Get()
  listar() {
    return this.empresas.listar();
  }

  /** Dados públicos do CNPJ (razão social, nome fantasia…) para preencher o cadastro. Antes de `:id`. */
  @Get('consulta-cnpj/:cnpj')
  async consultarCnpj(@Param('cnpj') valor: string): Promise<DadosCnpj> {
    if (!validarCnpj(valor)) throw new BadRequestException('CNPJ inválido.');
    const cnpj = normalizarCnpj(valor);
    const [dados, empresaExistenteId] = await Promise.all([this.consultaCnpj.consultar(cnpj), this.empresas.idPorCnpj(cnpj)]);
    return { ...dados, empresaExistenteId };
  }

  @Get(':id')
  obter(@Param('id', ParseUUIDPipe) id: string) {
    return this.empresas.obter(id);
  }

  @Post()
  criar(@Body() dto: CriarEmpresaDto, @UsuarioAtual() usuario: UsuarioRequisicao) {
    return this.empresas.criar(dto, usuario.id);
  }

  @Patch(':id')
  atualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarEmpresaDto,
    @UsuarioAtual() usuario: UsuarioRequisicao,
  ) {
    return this.empresas.atualizar(id, dto, usuario.id);
  }
}
