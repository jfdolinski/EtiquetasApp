ALTER TABLE "usuarios"
  ADD COLUMN "totp_segredo_cifrado" TEXT,
  ADD COLUMN "totp_ativo_em" TIMESTAMP(3),
  ADD COLUMN "totp_ultimo_passo" BIGINT,
  ADD COLUMN "totp_falhas" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totp_bloqueado_ate" TIMESTAMP(3),
  ADD COLUMN "totp_codigos_recuperacao" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "sessoes_usuario" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "descricao" TEXT,
    "ip" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_uso_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "encerrada_em" TIMESTAMP(3),
    CONSTRAINT "sessoes_usuario_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sessoes_usuario_usuario_id_encerrada_em_idx" ON "sessoes_usuario"("usuario_id", "encerrada_em");
CREATE INDEX "sessoes_usuario_expira_em_idx" ON "sessoes_usuario"("expira_em");
ALTER TABLE "sessoes_usuario" ADD CONSTRAINT "sessoes_usuario_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "redefinicoes_senha" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "usado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "redefinicoes_senha_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "redefinicoes_senha_token_hash_key" ON "redefinicoes_senha"("token_hash");
CREATE INDEX "redefinicoes_senha_usuario_id_criado_em_idx" ON "redefinicoes_senha"("usuario_id", "criado_em");
ALTER TABLE "redefinicoes_senha" ADD CONSTRAINT "redefinicoes_senha_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
