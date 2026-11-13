FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    TRANSFORMERS_OFFLINE=1 \
    HF_HUB_OFFLINE=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY model-manifest.json ./
COPY models ./models
RUN node dist/scripts/prefetch.js --verify-only
USER node
EXPOSE 8000
CMD ["node", "dist/index.js"]
