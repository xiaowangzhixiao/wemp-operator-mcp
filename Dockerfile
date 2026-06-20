FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    WEMP_MCP_HOST=0.0.0.0 \
    WEMP_MCP_PORT=3333

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node mcp ./mcp
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node templates ./templates
COPY --chown=node:node README.md LICENSE ./

RUN mkdir -p /app/data /app/config \
    && chown -R node:node /app/data /app/config

USER node

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3333/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["npm", "run", "mcp:start"]
