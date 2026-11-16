FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY poc-horizon/package.json ./poc-horizon/package.json
COPY poc-rizzo/package.json ./poc-rizzo/package.json
RUN pnpm install --frozen-lockfile --filter poc-horizon-pii-check...
COPY poc-horizon/tsconfig.json ./poc-horizon/tsconfig.json
COPY poc-horizon/src ./poc-horizon/src
RUN pnpm --filter poc-horizon-pii-check build && \
    pnpm --filter poc-horizon-pii-check deploy --prod --legacy /opt/app

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    TRANSFORMERS_OFFLINE=1 \
    HF_HUB_OFFLINE=1
COPY --from=build /opt/app ./
COPY poc-horizon/model-manifest.json ./model-manifest.json
COPY poc-horizon/models ./models
RUN node --input-type=module -e "import{readFile,stat}from'node:fs/promises';import{createReadStream}from'node:fs';import{createHash}from'node:crypto';const m=JSON.parse(await readFile('model-manifest.json'));for(const f of m.files){const p='models/'+m.model+'/'+f.path;const s=await stat(p);if(s.size!==f.size)throw Error('MODEL_SIZE_MISMATCH '+f.path);if(f.sha256){const h=createHash('sha256');for await(const c of createReadStream(p))h.update(c);if(h.digest('hex')!==f.sha256)throw Error('MODEL_HASH_MISMATCH '+f.path)}}" && \
    test -z "$(command -v python || command -v python3)"
USER node
EXPOSE 8000
CMD ["node", "dist/index.js"]
