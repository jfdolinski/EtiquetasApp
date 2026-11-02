import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { IsDefined, IsIn, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';
import type { AjustesPost, ConteudoPost, DadosPost, FormatoPost, ModeloPost } from '@etiquetas/shared';
import { EmpresaAtual, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { BanidosModule } from '../banidos/banidos.module';
import { ConsultasModule } from '../consultas/consultas.module';
import { CatalogoService } from './catalogo.service';
import { PostsService } from './posts.service';

class PostDto implements DadosPost {
  @IsString()
  @MaxLength(120)
  titulo: string;

  @IsIn(['PRODUTO', 'OFERTA', 'AVISO'])
  modelo: ModeloPost;

  @IsIn(['QUADRADO', 'RETRATO', 'STORIES'])
  formato: FormatoPost;

  @IsDefined()
  @IsObject()
  conteudo: ConteudoPost;

  @IsString()
  legenda: string;

  @IsDefined()
  @IsObject()
  ajustes: AjustesPost;
}

class MarcaDto {
  @IsString()
  @MaxLength(120)
  nome: string;

  @IsString()
  corPrincipal: string;

  @IsString()
  corDestaque: string;

  @IsOptional()
  @IsUUID()
  logoId: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  chaveCatalogo?: string | null;
}

class ImagemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  nome: string;

  /** Base64 de até 5 MB: cerca de 6,7 milhões de caracteres. */
  @IsString()
  @MaxLength(7_000_000)
  @Matches(/^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/]+=*$/, { message: 'A imagem precisa ser PNG, JPEG, WebP ou GIF.' })
  dados: string;
}

class BuscaDto {
  @IsUUID()
  consultaId: string;

  @IsString()
  @MinLength(1, { message: 'Digite o código ou o nome do produto.' })
  @MaxLength(100)
  termo: string;
}

function enviarImagem(res: Response, tipo: string, bytes: Uint8Array) {
  res.setHeader('Content-Type', tipo);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(Buffer.from(bytes));
}

// As rotas fixas vêm antes de `:id`.
@Controller('posts')
export class PostsController {
  constructor(
    private readonly posts: PostsService,
    private readonly catalogo: CatalogoService,
  ) {}

  @Get('marca')
  @RequerPermissao('post.ver')
  marca(@EmpresaAtual() empresaId: string) {
    return this.posts.marca(empresaId);
  }

  @Put('marca')
  @RequerPermissao('post.editar')
  salvarMarca(@EmpresaAtual() empresaId: string, @Body() dto: MarcaDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.posts.salvarMarca(empresaId, { ...dto, logoId: dto.logoId ?? null }, u.id);
  }

  @Get('imagens')
  @RequerPermissao('post.ver')
  imagens(@EmpresaAtual() empresaId: string) {
    return this.posts.imagens(empresaId);
  }

  @Post('imagens')
  @RequerPermissao('post.editar')
  enviar(@EmpresaAtual() empresaId: string, @Body() dto: ImagemDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.posts.enviarImagem(empresaId, dto.nome, dto.dados, u.id);
  }

  @Get('imagens/:id/arquivo')
  @RequerPermissao('post.ver')
  async arquivo(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const i = await this.posts.arquivoImagem(empresaId, id);
    enviarImagem(res, i.mime, i.conteudo);
  }

  @Delete('imagens/:id')
  @HttpCode(204)
  @RequerPermissao('post.editar')
  async excluirImagem(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao) {
    await this.posts.excluirImagem(empresaId, id, u.id);
  }

  @Get('catalogo-imagem')
  @RequerPermissao('post.ver')
  async imagemCatalogo(@EmpresaAtual() empresaId: string, @Query('url') url: string, @Res() res: Response) {
    const i = await this.catalogo.imagem(empresaId, String(url ?? ''));
    enviarImagem(res, i.tipo, i.bytes);
  }

  @Get('catalogo/:codigo')
  @RequerPermissao('post.ver')
  produtoCatalogo(@EmpresaAtual() empresaId: string, @Param('codigo') codigo: string) {
    return this.catalogo.produto(empresaId, codigo.slice(0, 200));
  }

  @Get('consultas')
  @RequerPermissao('post.editar')
  consultas(@EmpresaAtual() empresaId: string) {
    return this.posts.consultasDeBusca(empresaId);
  }

  @Post('produtos/busca')
  @HttpCode(200)
  @RequerPermissao('post.editar')
  buscarProdutos(@EmpresaAtual() empresaId: string, @Body() dto: BuscaDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.posts.buscarProdutos(empresaId, dto.consultaId, dto.termo, u.id);
  }

  @Get()
  @RequerPermissao('post.ver')
  listar(@EmpresaAtual() empresaId: string) {
    return this.posts.listar(empresaId);
  }

  @Post()
  @RequerPermissao('post.editar')
  criar(@EmpresaAtual() empresaId: string, @Body() dto: PostDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.posts.criar(empresaId, dto, u);
  }

  @Get(':id')
  @RequerPermissao('post.ver')
  buscar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.buscar(empresaId, id);
  }

  @Patch(':id')
  @RequerPermissao('post.editar')
  atualizar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PostDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.posts.atualizar(empresaId, id, dto, u);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequerPermissao('post.editar')
  async excluir(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao) {
    await this.posts.excluir(empresaId, id, u.id);
  }
}

@Module({
  imports: [ConsultasModule, BanidosModule],
  controllers: [PostsController],
  providers: [PostsService, CatalogoService],
})
export class PostsModule {}
