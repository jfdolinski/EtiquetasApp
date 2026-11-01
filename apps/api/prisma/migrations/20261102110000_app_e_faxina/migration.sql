ALTER TABLE "trabalhos_impressao" ADD COLUMN "conteudo_apagado_em" TIMESTAMP(3);
ALTER TABLE "regras_notificacao" ADD COLUMN "canal_email" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "canal_celular" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "notificacoes" ADD COLUMN "canal_email" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "canal_celular" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "dispositivos_moveis" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "plataforma" TEXT NOT NULL,
    "versao_app" TEXT,
    "token_hash" TEXT NOT NULL,
    "push_token" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_uso_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revogado_em" TIMESTAMP(3),
    CONSTRAINT "dispositivos_moveis_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dispositivos_moveis_token_hash_key" ON "dispositivos_moveis"("token_hash");
CREATE INDEX "dispositivos_moveis_usuario_id_revogado_em_idx" ON "dispositivos_moveis"("usuario_id", "revogado_em");
CREATE INDEX "dispositivos_moveis_empresa_id_revogado_em_idx" ON "dispositivos_moveis"("empresa_id", "revogado_em");
CREATE INDEX "dispositivos_moveis_push_token_idx" ON "dispositivos_moveis"("push_token");
ALTER TABLE "dispositivos_moveis" ADD CONSTRAINT "dispositivos_moveis_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dispositivos_moveis" ADD CONSTRAINT "dispositivos_moveis_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "codigos_vinculo_app" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "codigo_hash" TEXT NOT NULL,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "usado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "codigos_vinculo_app_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "codigos_vinculo_app_codigo_hash_key" ON "codigos_vinculo_app"("codigo_hash");
CREATE INDEX "codigos_vinculo_app_usuario_id_usado_em_idx" ON "codigos_vinculo_app"("usuario_id", "usado_em");
CREATE INDEX "codigos_vinculo_app_expira_em_idx" ON "codigos_vinculo_app"("expira_em");
ALTER TABLE "codigos_vinculo_app" ADD CONSTRAINT "codigos_vinculo_app_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "erros_sistema" (
    "id" UUID NOT NULL,
    "metodo" TEXT NOT NULL,
    "rota" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "pilha" TEXT,
    "empresa_id" UUID,
    "usuario_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "erros_sistema_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "erros_sistema_criado_em_idx" ON "erros_sistema"("criado_em");
