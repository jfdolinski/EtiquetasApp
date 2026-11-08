CREATE TABLE "parametros_telas" (
    "id" UUID NOT NULL,
    "empresa_id" UUID,
    "valores" JSONB NOT NULL DEFAULT '{}',
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "parametros_telas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "parametros_telas_empresa_id_key" ON "parametros_telas"("empresa_id");

CREATE TABLE "perfis_tela" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "largura" INTEGER NOT NULL,
    "altura" INTEGER NOT NULL,
    "margem_pct" INTEGER NOT NULL DEFAULT 0,
    "nivel_animacao" TEXT NOT NULL DEFAULT 'AUTOMATICO',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "perfis_tela_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "perfis_tela_empresa_id_nome_key" ON "perfis_tela"("empresa_id", "nome");
ALTER TABLE "perfis_tela" ADD CONSTRAINT "perfis_tela_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "telas" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "perfil_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "local" TEXT,
    "token_hash" TEXT,
    "ultimo_contato_em" TIMESTAMP(3),
    "largura_detectada" INTEGER,
    "altura_detectada" INTEGER,
    "escala_detectada" DOUBLE PRECISION,
    "navegador" TEXT,
    "versao_player" TEXT,
    "em_segundo_plano" BOOLEAN NOT NULL DEFAULT false,
    "horario_inicio" TEXT,
    "horario_fim" TEXT,
    "comando" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "telas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "telas_token_hash_key" ON "telas"("token_hash");
CREATE INDEX "telas_empresa_id_idx" ON "telas"("empresa_id");
ALTER TABLE "telas" ADD CONSTRAINT "telas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telas" ADD CONSTRAINT "telas_perfil_id_fkey" FOREIGN KEY ("perfil_id") REFERENCES "perfis_tela"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "pedidos_vinculo_tela" (
    "id" UUID NOT NULL,
    "codigo_hash" TEXT NOT NULL,
    "segredo_hash" TEXT NOT NULL,
    "largura" INTEGER NOT NULL,
    "altura" INTEGER NOT NULL,
    "escala" DOUBLE PRECISION,
    "navegador" TEXT,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "tela_id" UUID,
    "entregue_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pedidos_vinculo_tela_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pedidos_vinculo_tela_codigo_hash_key" ON "pedidos_vinculo_tela"("codigo_hash");
CREATE UNIQUE INDEX "pedidos_vinculo_tela_segredo_hash_key" ON "pedidos_vinculo_tela"("segredo_hash");
CREATE INDEX "pedidos_vinculo_tela_expira_em_idx" ON "pedidos_vinculo_tela"("expira_em");
ALTER TABLE "pedidos_vinculo_tela" ADD CONSTRAINT "pedidos_vinculo_tela_tela_id_fkey" FOREIGN KEY ("tela_id") REFERENCES "telas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "quedas_tela" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "tela_id" UUID NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "quedas_tela_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "quedas_tela_tela_id_inicio_idx" ON "quedas_tela"("tela_id", "inicio");
CREATE INDEX "quedas_tela_fim_idx" ON "quedas_tela"("fim");
ALTER TABLE "quedas_tela" ADD CONSTRAINT "quedas_tela_tela_id_fkey" FOREIGN KEY ("tela_id") REFERENCES "telas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
