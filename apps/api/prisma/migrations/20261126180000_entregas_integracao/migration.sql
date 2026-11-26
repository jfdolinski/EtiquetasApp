-- AlterTable
ALTER TABLE "chamadas_entrega" ADD COLUMN     "referencia_externa" TEXT,
ADD COLUMN     "webhook_estado" TEXT;

-- AlterTable
ALTER TABLE "lancamentos_entrega" ADD COLUMN     "meta_id" UUID;

-- CreateTable
CREATE TABLE "metas_entrega" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "minimo_chamadas" INTEGER NOT NULL,
    "valor_centavos" INTEGER NOT NULL,
    "faixa" JSONB,
    "cancelada_em" TIMESTAMP(3),
    "apurada_em" TIMESTAMP(3),
    "criado_por_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metas_entrega_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chaves_api_entregas" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "webhook_url" TEXT,
    "webhook_segredo_cifrado" TEXT NOT NULL,
    "criado_por_id" UUID,
    "criado_por_nome" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_uso_em" TIMESTAMP(3),
    "revogada_em" TIMESTAMP(3),

    CONSTRAINT "chaves_api_entregas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "envios_webhook" (
    "id" UUID NOT NULL,
    "chave_id" UUID NOT NULL,
    "chamada_id" UUID,
    "evento" TEXT NOT NULL,
    "corpo" JSONB NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proxima_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviado_em" TIMESTAMP(3),
    "falhou_em" TIMESTAMP(3),
    "ultimo_status" INTEGER,
    "ultimo_erro" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "envios_webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chamados_suporte" (
    "id" UUID NOT NULL,
    "numero" SERIAL NOT NULL,
    "origem" TEXT NOT NULL,
    "empresa_id" UUID,
    "usuario_id" UUID,
    "entregador_id" UUID,
    "autor_nome" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "assunto" TEXT NOT NULL,
    "situacao" TEXT NOT NULL DEFAULT 'ABERTO',
    "lido_suporte_em" TIMESTAMP(3),
    "lido_autor_em" TIMESTAMP(3),
    "resolvido_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chamados_suporte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagens_suporte" (
    "id" UUID NOT NULL,
    "chamado_id" UUID NOT NULL,
    "de_suporte" BOOLEAN NOT NULL,
    "autor_nome" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "imagem_mime" TEXT,
    "imagem" BYTEA,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagens_suporte_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "metas_entrega_empresa_id_fim_idx" ON "metas_entrega"("empresa_id", "fim");

-- CreateIndex
CREATE INDEX "metas_entrega_apurada_em_fim_idx" ON "metas_entrega"("apurada_em", "fim");

-- CreateIndex
CREATE UNIQUE INDEX "chaves_api_entregas_token_hash_key" ON "chaves_api_entregas"("token_hash");

-- CreateIndex
CREATE INDEX "chaves_api_entregas_empresa_id_idx" ON "chaves_api_entregas"("empresa_id");

-- CreateIndex
CREATE INDEX "envios_webhook_enviado_em_falhou_em_proxima_em_idx" ON "envios_webhook"("enviado_em", "falhou_em", "proxima_em");

-- CreateIndex
CREATE INDEX "envios_webhook_chave_id_criado_em_idx" ON "envios_webhook"("chave_id", "criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "chamados_suporte_numero_key" ON "chamados_suporte"("numero");

-- CreateIndex
CREATE INDEX "chamados_suporte_situacao_atualizado_em_idx" ON "chamados_suporte"("situacao", "atualizado_em");

-- CreateIndex
CREATE INDEX "chamados_suporte_empresa_id_atualizado_em_idx" ON "chamados_suporte"("empresa_id", "atualizado_em");

-- CreateIndex
CREATE INDEX "chamados_suporte_entregador_id_atualizado_em_idx" ON "chamados_suporte"("entregador_id", "atualizado_em");

-- CreateIndex
CREATE INDEX "mensagens_suporte_chamado_id_criado_em_idx" ON "mensagens_suporte"("chamado_id", "criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "chamadas_entrega_empresa_id_referencia_externa_key" ON "chamadas_entrega"("empresa_id", "referencia_externa");

-- CreateIndex
CREATE UNIQUE INDEX "lancamentos_entrega_meta_id_entregador_id_key" ON "lancamentos_entrega"("meta_id", "entregador_id");

-- AddForeignKey
ALTER TABLE "lancamentos_entrega" ADD CONSTRAINT "lancamentos_entrega_meta_id_fkey" FOREIGN KEY ("meta_id") REFERENCES "metas_entrega"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metas_entrega" ADD CONSTRAINT "metas_entrega_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chaves_api_entregas" ADD CONSTRAINT "chaves_api_entregas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envios_webhook" ADD CONSTRAINT "envios_webhook_chave_id_fkey" FOREIGN KEY ("chave_id") REFERENCES "chaves_api_entregas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chamados_suporte" ADD CONSTRAINT "chamados_suporte_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chamados_suporte" ADD CONSTRAINT "chamados_suporte_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chamados_suporte" ADD CONSTRAINT "chamados_suporte_entregador_id_fkey" FOREIGN KEY ("entregador_id") REFERENCES "entregadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens_suporte" ADD CONSTRAINT "mensagens_suporte_chamado_id_fkey" FOREIGN KEY ("chamado_id") REFERENCES "chamados_suporte"("id") ON DELETE CASCADE ON UPDATE CASCADE;

