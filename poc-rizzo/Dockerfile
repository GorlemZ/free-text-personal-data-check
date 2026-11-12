FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production BIND_HOST=0.0.0.0 PORT=8000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src
COPY scripts ./scripts
COPY model-manifest.json MODEL_LICENSE ./
COPY models ./models
RUN test -z "$(command -v python || command -v python3)"
USER node
EXPOSE 8000
CMD ["node", "src/server.mjs"]
