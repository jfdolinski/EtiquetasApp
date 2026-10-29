# Build a partir da raiz do repositório:
#   docker build -f apps/web/Dockerfile -t etiquetas-web .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @etiquetas/web build

FROM nginx:1.27-alpine
# O nginx substitui ${API_UPSTREAM} ao iniciar (apenas variáveis definidas no ambiente).
ENV API_UPSTREAM=http://api:3000
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
