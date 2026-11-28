FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/command-parser/package.json packages/command-parser/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS api
WORKDIR /app
COPY --from=builder /app ./
CMD ["sh", "-c", "npx tsx packages/db/scripts/migrate.ts && node apps/api/dist/server.js"]

FROM nginx:alpine AS web
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY deploy/docker-nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
