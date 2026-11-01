import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { CodigoPermissao } from '@etiquetas/shared';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Envio de e-mail por SMTP. Sem SMTP configurado nada é enviado e o sistema segue funcionando:
 * quem chama nunca depende do e-mail para concluir a ação.
 */
@Injectable()
export class EmailService {
  private readonly log = new Logger('Email');
  private transporte?: Transporter;

  constructor(private readonly prisma: PrismaService) {}

  get disponivel(): boolean {
    return config().smtp !== null;
  }

  async enviar(para: string | string[], assunto: string, texto: string): Promise<boolean> {
    const smtp = config().smtp;
    const destinos = Array.isArray(para) ? para : [para];
    if (!smtp || destinos.length === 0) return false;
    this.transporte ??= createTransport({
      host: smtp.host,
      port: smtp.porta,
      secure: smtp.porta === 465,
      auth: smtp.usuario ? { user: smtp.usuario, pass: smtp.senha } : undefined,
    });
    try {
      // Cópia oculta: um cliente não vê o endereço dos outros usuários.
      await this.transporte.sendMail({ from: smtp.remetente, to: smtp.remetente, bcc: destinos, subject: assunto, text: texto });
      return true;
    } catch (e) {
      this.log.error(`Falha ao enviar "${assunto}": ${(e as Error).message}`);
      return false;
    }
  }

  /** Usuários ativos da empresa que têm a permissão. */
  async enderecosComPermissao(empresaId: string, permissao: CodigoPermissao): Promise<string[]> {
    const usuarios = await this.prisma.usuario.findMany({
      where: { empresaId, ativo: true, perfil: { permissoes: { some: { permissaoCodigo: permissao } } } },
      select: { email: true },
    });
    return usuarios.map((u) => u.email);
  }
}

@Global()
@Module({ providers: [EmailService], exports: [EmailService] })
export class EmailModule {}
