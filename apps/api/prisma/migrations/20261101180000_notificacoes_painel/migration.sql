-- CreateTable
CREATE TABLE "execucoes_consulta" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "consulta_id" UUID NOT NULL,
    "consulta_nome" TEXT NOT NULL,
    "duracao_ms" INTEGER NOT NULL,
    "linhas" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL,
    "erro" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execucoes_consulta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regras_notificacao" (
    "empresa_id" UUID NOT NULL,
    "evento" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "limite" INTEGER NOT NULL DEFAULT 0,
    "canal_agente" BOOLEAN NOT NULL DEFAULT true,
    "canal_sistema" BOOLEAN NOT NULL DEFAULT true,
    "repetir_minutos" INTEGER NOT NULL DEFAULT 0,
    "agente_ids" JSONB NOT NULL DEFAULT '[]',
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regras_notificacao_pkey" PRIMARY KEY ("empresa_id","evento")
);

-- CreateTable
CREATE TABLE "janelas_notificacao" (
    "empresa_id" UUID NOT NULL,
    "hora_inicio" TEXT NOT NULL,
    "hora_fim" TEXT NOT NULL,
    "dias_semana" JSONB NOT NULL,

    CONSTRAINT "janelas_notificacao_pkey" PRIMARY KEY ("empresa_id")
);

-- CreateTable
CREATE TABLE "notificacoes" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "evento" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "nivel" TEXT NOT NULL,
    "canal_agente" BOOLEAN NOT NULL,
    "canal_sistema" BOOLEAN NOT NULL,
    "agente_ids" JSONB NOT NULL DEFAULT '[]',
    "entregue_agentes" JSONB NOT NULL DEFAULT '[]',
    "vezes" INTEGER NOT NULL DEFAULT 1,
    "ultimo_envio_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lida_em" TIMESTAMP(3),
    "resolvida_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificacoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "execucoes_consulta_empresa_id_criado_em_idx" ON "execucoes_consulta"("empresa_id", "criado_em");

-- CreateIndex
CREATE INDEX "execucoes_consulta_criado_em_idx" ON "execucoes_consulta"("criado_em");

-- CreateIndex
CREATE INDEX "regras_notificacao_ativo_idx" ON "regras_notificacao"("ativo");

-- CreateIndex
CREATE INDEX "notificacoes_empresa_id_criado_em_idx" ON "notificacoes"("empresa_id", "criado_em");

-- CreateIndex
CREATE INDEX "notificacoes_empresa_id_resolvida_em_idx" ON "notificacoes"("empresa_id", "resolvida_em");

-- AddForeignKey
ALTER TABLE "execucoes_consulta" ADD CONSTRAINT "execucoes_consulta_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regras_notificacao" ADD CONSTRAINT "regras_notificacao_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "janelas_notificacao" ADD CONSTRAINT "janelas_notificacao_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
