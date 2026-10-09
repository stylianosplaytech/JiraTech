FROM node:22-alpine AS build

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

COPY frontend frontend
RUN npm run build -w frontend

FROM nginx:1.27-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 8080
