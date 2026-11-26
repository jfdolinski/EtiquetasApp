ALTER TABLE "pedidos" ADD COLUMN     "cliente_documento" TEXT;

-- CreateTable
CREATE TABLE "emissores_nfse" (
    "id" UUID NOT NULL,
    "empresa_id" UUID,
    "ambiente" TEXT NOT NULL DEFAULT 'PRODUCAO_RESTRITA',
    "cnpj" VARCHAR(14) NOT NULL,
    "inscricao_municipal" TEXT,
    "razao_social" TEXT NOT NULL,
    "codigo_municipio" VARCHAR(7) NOT NULL,
    "regime" TEXT NOT NULL,
    "regime_especial" INTEGER NOT NULL DEFAULT 0,
    "email" TEXT,
    "telefone" TEXT,
    "serie" TEXT NOT NULL DEFAULT '1',
    "proximo_numero" INTEGER NOT NULL DEFAULT 1,
    "servico" JSONB NOT NULL,
    "automatico" JSONB NOT NULL DEFAULT '{}',
    "automatico_desde" TIMESTAMP(3),
    "certificado_cifrado" TEXT,
    "certificado_titular" TEXT,
    "certificado_documento" TEXT,
    "certificado_valido_ate" TIMESTAMP(3),
    "atualizado_por_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emissores_nfse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notas_fiscais" (
    "id" UUID NOT NULL,
    "emissor_id" UUID NOT NULL,
    "empresa_id" UUID,
    "tomador_empresa_id" UUID,
    "origem" TEXT NOT NULL,
    "pagamento_assinatura_id" UUID,
    "pedido_id" UUID,
    "ambiente" TEXT NOT NULL,
    "serie" TEXT NOT NULL,
    "numero_dps" INTEGER NOT NULL,
    "id_dps" TEXT NOT NULL,
    "situacao" TEXT NOT NULL DEFAULT 'PENDENTE',
    "tomador" JSONB,
    "servico" JSONB NOT NULL,
    "valor_centavos" INTEGER NOT NULL,
    "iss_centavos" INTEGER NOT NULL DEFAULT 0,
    "competencia" DATE NOT NULL,
    "chave_acesso" TEXT,
    "numero_nfse" TEXT,
    "xml_nfse" TEXT,
    "erro" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proxima_tentativa_em" TIMESTAMP(3),
    "emitida_em" TIMESTAMP(3),
    "cancelada_em" TIMESTAMP(3),
    "motivo_cancelamento" TEXT,
    "criado_por_id" UUID,
    "historico" JSONB NOT NULL DEFAULT '[]',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notas_fiscais_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "emissores_nfse_empresa_id_key" ON "emissores_nfse"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "notas_fiscais_pagamento_assinatura_id_key" ON "notas_fiscais"("pagamento_assinatura_id");

-- CreateIndex
CREATE UNIQUE INDEX "notas_fiscais_pedido_id_key" ON "notas_fiscais"("pedido_id");

-- CreateIndex
CREATE UNIQUE INDEX "notas_fiscais_chave_acesso_key" ON "notas_fiscais"("chave_acesso");

-- CreateIndex
CREATE INDEX "notas_fiscais_empresa_id_criado_em_idx" ON "notas_fiscais"("empresa_id", "criado_em");

-- CreateIndex
CREATE INDEX "notas_fiscais_tomador_empresa_id_criado_em_idx" ON "notas_fiscais"("tomador_empresa_id", "criado_em");

-- CreateIndex
CREATE INDEX "notas_fiscais_situacao_proxima_tentativa_em_idx" ON "notas_fiscais"("situacao", "proxima_tentativa_em");

-- CreateIndex
CREATE UNIQUE INDEX "notas_fiscais_ambiente_id_dps_key" ON "notas_fiscais"("ambiente", "id_dps");

-- CreateIndex
CREATE UNIQUE INDEX "notas_fiscais_emissor_id_ambiente_serie_numero_dps_key" ON "notas_fiscais"("emissor_id", "ambiente", "serie", "numero_dps");

-- AddForeignKey
ALTER TABLE "emissores_nfse" ADD CONSTRAINT "emissores_nfse_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_fiscais" ADD CONSTRAINT "notas_fiscais_emissor_id_fkey" FOREIGN KEY ("emissor_id") REFERENCES "emissores_nfse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_fiscais" ADD CONSTRAINT "notas_fiscais_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_fiscais" ADD CONSTRAINT "notas_fiscais_tomador_empresa_id_fkey" FOREIGN KEY ("tomador_empresa_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_fiscais" ADD CONSTRAINT "notas_fiscais_pagamento_assinatura_id_fkey" FOREIGN KEY ("pagamento_assinatura_id") REFERENCES "pagamentos_assinatura"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_fiscais" ADD CONSTRAINT "notas_fiscais_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Só um emissor da plataforma (empresa_id nulo).
CREATE UNIQUE INDEX "emissores_nfse_plataforma_key" ON "emissores_nfse" ((true)) WHERE "empresa_id" IS NULL;
