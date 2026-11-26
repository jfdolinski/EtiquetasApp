import { Module } from '@nestjs/common';
import { NfseEmpresaController, NfsePlataformaController } from './nfse.controller';
import { criarProvedorNfse, NfseService, PROVEDOR_NFSE } from './nfse.service';

/** NFS-e pelo padrão nacional (Sefin Nacional), da plataforma (mensalidade) e das empresas. */
@Module({
  controllers: [NfseEmpresaController, NfsePlataformaController],
  providers: [{ provide: PROVEDOR_NFSE, useFactory: criarProvedorNfse }, NfseService],
  exports: [NfseService],
})
export class NfseModule {}
