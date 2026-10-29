# Build a partir da raiz do repositório:
#   docker build -f apps/api/Dockerfile -t etiquetas-api .
FROM node:22-alpine AS base
RUN apk add --no-cache openssl && corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @etiquetas/shared build && pnpm --filter @etiquetas/api build
# Copia só a API e suas dependências de produção (incluindo o pacote shared já compilado).
RUN pnpm --filter @etiquetas/api deploy --prod /out
RUN cd /out && npx prisma generate

FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out .
EXPOSE 3000
# Aplica migrações pendentes e sobe a API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
