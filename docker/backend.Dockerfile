FROM node:22-alpine AS build

RUN apk add --no-cache python3 make g++

ARG NEXUS_SERVER=nexus.pbs.one
ARG npmToken

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN npm config set registry "https://${NEXUS_SERVER}/repository/npm-all/" \
    && npm config set replace-registry-host always \
    && if [ -n "${npmToken}" ]; then npm config set "//${NEXUS_SERVER}/repository/npm-all/:_authToken" "${npmToken}"; fi \
    && npm ci \
    && rm -f /root/.npmrc

COPY backend backend
RUN npm run build -w backend

FROM node:22-alpine AS runtime

RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_URL=file:/data/digital-ticketing.db \
    UPLOAD_DIR=/data/uploads \
    RUN_PRISMA_GENERATE=true \
    RUN_DB_PUSH=true

WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/backend/package.json ./backend/package.json
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --from=build --chown=node:node /app/backend/prisma ./backend/prisma
COPY --from=build --chown=node:node /app/backend/scripts ./backend/scripts
COPY --chown=node:node docker/backend-entrypoint.sh /usr/local/bin/backend-entrypoint

RUN chmod +x /usr/local/bin/backend-entrypoint

USER node
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/backend-entrypoint"]
