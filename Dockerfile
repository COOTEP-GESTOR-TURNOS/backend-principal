# syntax=docker/dockerfile:1
# Compilación multietapa: dependencias -> compilación -> imagen final sin herramientas de desarrollo.

FROM node:22.12.0-alpine AS dependencias
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencias AS compilacion
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22.12.0-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=compilacion /app/node_modules ./node_modules
COPY --from=compilacion /app/dist ./dist
COPY package.json ./
# Usuario sin privilegios que ya trae la imagen oficial de Node
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
