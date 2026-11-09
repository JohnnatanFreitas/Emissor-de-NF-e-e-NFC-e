# 1) Compila o front-end (web/)
FROM node:24-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# 2) Servidor
FROM node:24-bookworm-slim
# Certificado e validação de XML rodam em JavaScript/WASM: só curl (healthcheck) e fuso horário.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl tzdata \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 WEB_DIR=/app/web/dist TZ=America/Sao_Paulo
COPY package.json package-lock.json ./
# O postinstall ajusta a node-sped-nfe (scripts/ajustar-sped-nfe.mjs): precisa estar aqui antes do npm ci.
COPY scripts ./scripts
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY --from=web /web/dist ./web/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fs http://127.0.0.1:3000/api/saude || exit 1
CMD ["node", "src/server.js"]
