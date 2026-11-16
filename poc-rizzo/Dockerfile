FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/detector-http/package.json ./packages/detector-http/package.json
COPY poc-horizon/package.json ./poc-horizon/package.json
COPY poc-rizzo/package.json ./poc-rizzo/package.json
RUN pnpm install --frozen-lockfile --filter node-rizzo-pii-spike...
COPY poc-rizzo/tsconfig.json ./poc-rizzo/tsconfig.json
COPY packages/detector-http/tsconfig.json ./packages/detector-http/tsconfig.json
COPY packages/detector-http/src ./packages/detector-http/src
COPY poc-rizzo/src ./poc-rizzo/src
RUN pnpm --filter @pagopa/detector-http build && \
    pnpm --filter node-rizzo-pii-spike build && \
    pnpm --filter node-rizzo-pii-spike deploy --prod --legacy /opt/app

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production BIND_HOST=0.0.0.0 PORT=8000 \
    TRANSFORMERS_OFFLINE=1 HF_HUB_OFFLINE=1
COPY --from=build /opt/app ./
COPY poc-rizzo/model-manifest.json poc-rizzo/MODEL_LICENSE ./
COPY poc-rizzo/models ./models
RUN node --input-type=module -e "import{readFile}from'node:fs/promises';import{createReadStream}from'node:fs';import{createHash}from'node:crypto';const m=JSON.parse(await readFile('model-manifest.json'));for(const [f,e]of Object.entries(m.files)){const h=createHash('sha256');for await(const c of createReadStream('models/'+f))h.update(c);if(h.digest('hex')!==e)throw Error('MODEL_HASH_MISMATCH '+f)}" && test -z "$(command -v python || command -v python3)"
USER node
EXPOSE 8000
CMD ["node", "dist/index.js"]
