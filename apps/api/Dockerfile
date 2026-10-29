# Build a partir da raiz do repositório:
#   docker build -f apps/api/Dockerfile -t etiquetas-api .
FROM node:22-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN apk add --no-cache openssl && corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
# Só a API e o que ela usa do workspace (shared).
RUN pnpm install --frozen-lockfile --filter "@etiquetas/api..."
RUN pnpm --filter @etiquetas/shared build && pnpm --filter @etiquetas/api build
# Copia só a API e suas dependências de produção (incluindo o pacote shared já compilado).
RUN pnpm --filter @etiquetas/api deploy --prod /out
RUN cd /out && npx prisma generate

FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /out .
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
# Aplica migrações pendentes e sobe a API. `exec` faz o Node receber o SIGTERM do
# Easypanel e encerrar com calma (fecha os WebSockets dos agentes).
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/main.js"]
