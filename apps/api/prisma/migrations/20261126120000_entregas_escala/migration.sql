-- AlterTable
ALTER TABLE "chamadas_entrega" ADD COLUMN     "avaliacao_empresa_comentario" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "avaliacao_empresa_em" TIMESTAMP(3),
ADD COLUMN     "avaliacao_empresa_nota" INTEGER,
ADD COLUMN     "coleta_atual" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "coletas_extras" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "valor_declarado_centavos" INTEGER;

-- CreateTable
CREATE TABLE "turnos_entrega" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "vagas" INTEGER NOT NULL,
    "valor_centavos" INTEGER NOT NULL DEFAULT 0,
    "observacao" TEXT NOT NULL DEFAULT '',
    "cancelado_em" TIMESTAMP(3),
    "criado_por_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turnos_entrega_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inscricoes_turno" (
    "id" UUID NOT NULL,
    "turno_id" UUID NOT NULL,
    "entregador_id" UUID NOT NULL,
    "situacao" TEXT NOT NULL DEFAULT 'INSCRITO',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inscricoes_turno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avarias_chamada" (
    "id" UUID NOT NULL,
    "chamada_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "entregador_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "prejuizo_centavos" INTEGER NOT NULL,
    "responsavel" TEXT NOT NULL,
    "desconto_centavos" INTEGER NOT NULL DEFAULT 0,
    "situacao" TEXT NOT NULL,
    "resposta" TEXT,
    "respondida_em" TIMESTAMP(3),
    "criado_por_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "avarias_chamada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fotos_avaria" (
    "id" UUID NOT NULL,
    "avaria_id" UUID NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fotos_avaria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lancamentos_entrega" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "entregador_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor_centavos" INTEGER NOT NULL,
    "fechamento_id" UUID,
    "inscricao_id" UUID,
    "avaria_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lancamentos_entrega_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "turnos_entrega_empresa_id_inicio_idx" ON "turnos_entrega"("empresa_id", "inicio");

-- CreateIndex
CREATE INDEX "turnos_entrega_inicio_idx" ON "turnos_entrega"("inicio");

-- CreateIndex
CREATE INDEX "inscricoes_turno_entregador_id_situacao_idx" ON "inscricoes_turno"("entregador_id", "situacao");

-- CreateIndex
CREATE UNIQUE INDEX "inscricoes_turno_turno_id_entregador_id_key" ON "inscricoes_turno"("turno_id", "entregador_id");

-- CreateIndex
CREATE INDEX "avarias_chamada_empresa_id_criado_em_idx" ON "avarias_chamada"("empresa_id", "criado_em");

-- CreateIndex
CREATE INDEX "avarias_chamada_entregador_id_situacao_idx" ON "avarias_chamada"("entregador_id", "situacao");

-- CreateIndex
CREATE INDEX "avarias_chamada_chamada_id_idx" ON "avarias_chamada"("chamada_id");

-- CreateIndex
CREATE INDEX "fotos_avaria_avaria_id_idx" ON "fotos_avaria"("avaria_id");

-- CreateIndex
CREATE UNIQUE INDEX "lancamentos_entrega_inscricao_id_key" ON "lancamentos_entrega"("inscricao_id");

-- CreateIndex
CREATE UNIQUE INDEX "lancamentos_entrega_avaria_id_key" ON "lancamentos_entrega"("avaria_id");

-- CreateIndex
CREATE INDEX "lancamentos_entrega_empresa_id_entregador_id_fechamento_id_idx" ON "lancamentos_entrega"("empresa_id", "entregador_id", "fechamento_id");

-- CreateIndex
CREATE INDEX "lancamentos_entrega_entregador_id_criado_em_idx" ON "lancamentos_entrega"("entregador_id", "criado_em");

-- CreateIndex
CREATE INDEX "chamadas_entrega_empresa_id_avaliacao_empresa_em_idx" ON "chamadas_entrega"("empresa_id", "avaliacao_empresa_em");

-- AddForeignKey
ALTER TABLE "turnos_entrega" ADD CONSTRAINT "turnos_entrega_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inscricoes_turno" ADD CONSTRAINT "inscricoes_turno_turno_id_fkey" FOREIGN KEY ("turno_id") REFERENCES "turnos_entrega"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inscricoes_turno" ADD CONSTRAINT "inscricoes_turno_entregador_id_fkey" FOREIGN KEY ("entregador_id") REFERENCES "entregadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avarias_chamada" ADD CONSTRAINT "avarias_chamada_chamada_id_fkey" FOREIGN KEY ("chamada_id") REFERENCES "chamadas_entrega"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avarias_chamada" ADD CONSTRAINT "avarias_chamada_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avarias_chamada" ADD CONSTRAINT "avarias_chamada_entregador_id_fkey" FOREIGN KEY ("entregador_id") REFERENCES "entregadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fotos_avaria" ADD CONSTRAINT "fotos_avaria_avaria_id_fkey" FOREIGN KEY ("avaria_id") REFERENCES "avarias_chamada"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamentos_entrega" ADD CONSTRAINT "lancamentos_entrega_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamentos_entrega" ADD CONSTRAINT "lancamentos_entrega_entregador_id_fkey" FOREIGN KEY ("entregador_id") REFERENCES "entregadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamentos_entrega" ADD CONSTRAINT "lancamentos_entrega_fechamento_id_fkey" FOREIGN KEY ("fechamento_id") REFERENCES "fechamentos_entregas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamentos_entrega" ADD CONSTRAINT "lancamentos_entrega_inscricao_id_fkey" FOREIGN KEY ("inscricao_id") REFERENCES "inscricoes_turno"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamentos_entrega" ADD CONSTRAINT "lancamentos_entrega_avaria_id_fkey" FOREIGN KEY ("avaria_id") REFERENCES "avarias_chamada"("id") ON DELETE CASCADE ON UPDATE CASCADE;

