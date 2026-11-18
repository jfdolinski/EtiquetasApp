-- AlterTable
ALTER TABLE "configuracoes_entregas" ADD COLUMN     "precos" JSONB,
ADD COLUMN     "proximo_numero" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "segundos_para_aceitar" INTEGER NOT NULL DEFAULT 45;

-- CreateTable
CREATE TABLE "chamadas_entrega" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "situacao" TEXT NOT NULL DEFAULT 'ABERTA',
    "origem" JSONB NOT NULL,
    "destino" JSONB NOT NULL,
    "metros" INTEGER NOT NULL,
    "segundos" INTEGER NOT NULL,
    "estimada" BOOLEAN NOT NULL,
    "valor_centavos" INTEGER NOT NULL,
    "serie_esperada" TEXT,
    "serie_coletada" TEXT,
    "observacao" TEXT NOT NULL DEFAULT '',
    "codigo_confirmacao" TEXT NOT NULL,
    "tentativas_codigo" INTEGER NOT NULL DEFAULT 0,
    "entregador_id" UUID,
    "aceita_em" TIMESTAMP(3),
    "concluida_em" TIMESTAMP(3),
    "cancelada_em" TIMESTAMP(3),
    "ocorrencia" JSONB,
    "historico" JSONB NOT NULL DEFAULT '[]',
    "criado_por_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chamadas_entrega_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ofertas_chamada" (
    "id" UUID NOT NULL,
    "chamada_id" UUID NOT NULL,
    "entregador_id" UUID NOT NULL,
    "resultado" TEXT NOT NULL DEFAULT 'PENDENTE',
    "metros_ate_coleta" INTEGER,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "respondida_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ofertas_chamada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fotos_chamada" (
    "id" UUID NOT NULL,
    "chamada_id" UUID NOT NULL,
    "etapa" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fotos_chamada_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chamadas_entrega_empresa_id_criado_em_idx" ON "chamadas_entrega"("empresa_id", "criado_em");

-- CreateIndex
CREATE INDEX "chamadas_entrega_entregador_id_situacao_idx" ON "chamadas_entrega"("entregador_id", "situacao");

-- CreateIndex
CREATE UNIQUE INDEX "chamadas_entrega_empresa_id_numero_key" ON "chamadas_entrega"("empresa_id", "numero");

-- CreateIndex
CREATE INDEX "ofertas_chamada_entregador_id_resultado_idx" ON "ofertas_chamada"("entregador_id", "resultado");

-- CreateIndex
CREATE INDEX "ofertas_chamada_resultado_expira_em_idx" ON "ofertas_chamada"("resultado", "expira_em");

-- CreateIndex
CREATE INDEX "ofertas_chamada_chamada_id_idx" ON "ofertas_chamada"("chamada_id");

-- CreateIndex
CREATE INDEX "fotos_chamada_chamada_id_idx" ON "fotos_chamada"("chamada_id");

-- AddForeignKey
ALTER TABLE "chamadas_entrega" ADD CONSTRAINT "chamadas_entrega_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chamadas_entrega" ADD CONSTRAINT "chamadas_entrega_entregador_id_fkey" FOREIGN KEY ("entregador_id") REFERENCES "entregadores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ofertas_chamada" ADD CONSTRAINT "ofertas_chamada_chamada_id_fkey" FOREIGN KEY ("chamada_id") REFERENCES "chamadas_entrega"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ofertas_chamada" ADD CONSTRAINT "ofertas_chamada_entregador_id_fkey" FOREIGN KEY ("entregador_id") REFERENCES "entregadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fotos_chamada" ADD CONSTRAINT "fotos_chamada_chamada_id_fkey" FOREIGN KEY ("chamada_id") REFERENCES "chamadas_entrega"("id") ON DELETE CASCADE ON UPDATE CASCADE;

