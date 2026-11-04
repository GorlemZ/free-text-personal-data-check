FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    TRANSFORMERS_OFFLINE=1 \
    HF_HUB_OFFLINE=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY model-manifest.json ./
COPY scripts ./scripts
COPY models ./models
COPY src ./src
COPY bench ./bench
RUN node scripts/prefetch.mjs --verify-only
USER node
EXPOSE 8000
CMD ["node", "src/server.mjs"]
