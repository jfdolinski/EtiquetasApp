-- CreateEnum
CREATE TYPE "TipoAvisoCobranca" AS ENUM ('AVISO_PREVIO', 'CARENCIA', 'PRE_BLOQUEIO', 'BLOQUEADA');

-- CreateEnum
CREATE TYPE "OrigemExecucao" AS ENUM ('AGENDADA', 'MANUAL');

-- CreateTable
CREATE TABLE "parametros_cobranca" (
    "id" UUID NOT NULL,
    "empresa_id" UUID,
    "dias_aviso_previo" INTEGER,
    "dias_carencia" INTEGER,
    "dias_ate_bloqueio" INTEGER,
    "frequencia_aviso_dias" INTEGER,
    "hora_avaliacao" INTEGER,
    "mensagem_aviso_previo" TEXT,
    "mensagem_carencia" TEXT,
    "mensagem_pre_bloqueio" TEXT,
    "mensagem_bloqueio" TEXT,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parametros_cobranca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assinaturas" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "valor_mensal" DECIMAL(10,2) NOT NULL,
    "dia_vencimento" INTEGER NOT NULL,
    "vencimento_atual" DATE NOT NULL,
    "controle_manual" BOOLEAN NOT NULL DEFAULT false,
    "observacoes" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assinaturas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagamentos_assinatura" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "assinatura_id" UUID NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "meses" INTEGER NOT NULL,
    "vencimento_quitado" DATE NOT NULL,
    "novo_vencimento" DATE NOT NULL,
    "pago_em" DATE NOT NULL,
    "observacao" TEXT,
    "registrado_por_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagamentos_assinatura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avisos_cobranca" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "tipo" "TipoAvisoCobranca" NOT NULL,
    "mensagem" TEXT NOT NULL,
    "vencimento" DATE NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avisos_cobranca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execucoes_avaliacao" (
    "id" UUID NOT NULL,
    "data" DATE NOT NULL,
    "origem" "OrigemExecucao" NOT NULL,
    "iniciado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluido_em" TIMESTAMP(3),
    "resultado" JSONB,
    "erro" TEXT,

    CONSTRAINT "execucoes_avaliacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parametros_cobranca_empresa_id_key" ON "parametros_cobranca"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "assinaturas_empresa_id_key" ON "assinaturas"("empresa_id");

-- CreateIndex
CREATE INDEX "pagamentos_assinatura_empresa_id_criado_em_idx" ON "pagamentos_assinatura"("empresa_id", "criado_em");

-- CreateIndex
CREATE INDEX "avisos_cobranca_empresa_id_criado_em_idx" ON "avisos_cobranca"("empresa_id", "criado_em");

-- CreateIndex
CREATE INDEX "execucoes_avaliacao_data_idx" ON "execucoes_avaliacao"("data");

-- AddForeignKey
ALTER TABLE "parametros_cobranca" ADD CONSTRAINT "parametros_cobranca_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assinaturas" ADD CONSTRAINT "assinaturas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos_assinatura" ADD CONSTRAINT "pagamentos_assinatura_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos_assinatura" ADD CONSTRAINT "pagamentos_assinatura_assinatura_id_fkey" FOREIGN KEY ("assinatura_id") REFERENCES "assinaturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos_assinatura" ADD CONSTRAINT "pagamentos_assinatura_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avisos_cobranca" ADD CONSTRAINT "avisos_cobranca_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
