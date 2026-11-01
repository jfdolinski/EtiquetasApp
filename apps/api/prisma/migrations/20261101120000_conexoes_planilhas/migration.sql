-- Conexões de planilhas: pasta no computador do agente e Google Drive.
CREATE TYPE "TipoConexao" AS ENUM ('POSTGRES', 'MYSQL', 'SQLSERVER', 'PASTA', 'GOOGLE_DRIVE');

ALTER TABLE "conexoes_banco" ALTER COLUMN "tipo" TYPE "TipoConexao" USING "tipo"::text::"TipoConexao";
ALTER TABLE "conexoes_banco" ALTER COLUMN "agente_id" DROP NOT NULL;

ALTER TABLE "consultas_sql" ADD COLUMN "arquivo" TEXT;
ALTER TABLE "consultas_sql" ADD COLUMN "arquivo_nome" TEXT;
ALTER TABLE "consultas_sql" ADD COLUMN "aba" TEXT;
