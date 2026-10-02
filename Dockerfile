# syntax=docker/dockerfile:1

FROM golang:1.25-alpine AS sfu-build
WORKDIR /src
COPY extra/pion-sfu/go.mod extra/pion-sfu/go.sum ./
RUN go mod download
COPY extra/pion-sfu/*.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/pion-sfu .

FROM alpine:3.22 AS sfu
RUN mkdir -p /run/sfu && chown 1000:1000 /run/sfu
COPY --from=sfu-build /out/pion-sfu /usr/local/bin/pion-sfu
USER 1000:1000
ENV WRTC_PORT=50000 PION_SFU_IPC=/run/sfu/sfu.sock
ENTRYPOINT ["/bin/sh", "-c", "exec pion-sfu -ip \"${WRTC_PUBLIC_IP:?set WRTC_PUBLIC_IP}\" -port \"$WRTC_PORT\" -ipc \"$PION_SFU_IPC\" ${PION_SFU_VERBOSE:+-verbose}"]

FROM node:26-slim AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV HUSKY=0
COPY package.json package-lock.json ./
COPY patches patches
RUN npm ci --no-audit --no-fund
COPY scripts/vencord.js scripts/vencord.js
COPY client client
RUN VENCORD_DIR=/tmp/vencord node scripts/vencord.js && rm -rf /tmp/vencord
COPY tsconfig.json ./
COPY src src
RUN npm run build:src && npm prune --omit=dev --no-audit --no-fund

FROM node:26-slim AS server
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    CONFIG_PATH=/data/state/config.json \
    STORAGE_LOCATION=/data/storage \
    PION_SFU_IPC=/run/sfu/sfu.sock \
    WRTC_LIBRARY=pion
COPY package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY --chown=node:node assets assets
COPY --from=build --chown=node:node /app/assets/vencord assets/vencord
COPY scripts/client.js scripts/e2ee-anchors.js scripts/clan-badges.js scripts/compress-client.js scripts/docker-configure.js scripts/
COPY docker/entrypoint.sh docker/
ARG REVISION=""
ARG REVISION_TIME="0"
RUN if [ -n "$REVISION" ]; then printf '{"rev":"%s","lastModified":%s}\n' "$REVISION" "$REVISION_TIME" > .rev; fi \
    && mkdir -p /data/state /data/storage /data/client /run/sfu \
    && ln -s /data/client/cache assets/cache \
    && ln -s /data/client/cache_compressed assets/cache_compressed \
    && chown -R node:node /data /run/sfu
USER node
EXPOSE 3001
ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["server"]
