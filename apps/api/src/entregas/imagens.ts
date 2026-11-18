import { BadRequestException } from '@nestjs/common';
import { DOCUMENTO_TAMANHO_MAXIMO_BYTES } from '@etiquetas/shared';
import { tipoDaImagem } from '../posts/catalogo.service';

/** Documento e comprovante: JPEG, PNG ou WebP, conferidos pelos bytes (SVG pode carregar script). */
export function imagemDoDataUrl(dados: string, oQue: string): { bytes: Uint8Array<ArrayBuffer>; mime: string } {
  const m = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/]+=*)$/.exec(dados ?? '');
  if (!m) throw new BadRequestException(`${oQue} precisa ser uma imagem.`);
  const bytes = Buffer.from(m[1], 'base64');
  if (bytes.length > DOCUMENTO_TAMANHO_MAXIMO_BYTES) throw new BadRequestException(`${oQue} pode ter até 5 MB.`);
  const mime = tipoDaImagem(bytes);
  if (!mime || mime === 'image/gif') throw new BadRequestException(`${oQue} precisa ser JPEG, PNG ou WebP.`);
  return { bytes: new Uint8Array(bytes), mime };
}

export const dataUrl = (mime: string, bytes: Uint8Array) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
