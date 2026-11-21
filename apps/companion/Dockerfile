FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/companion ./apps/companion

RUN pnpm install --frozen-lockfile --filter @geo-coach/companion...
RUN pnpm --filter @geo-coach/companion build

FROM node:24-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    COMPANION_HOST=0.0.0.0 \
    COMPANION_PORT=4173 \
    COMPANION_DATA_DIR=/data

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/companion/package.json ./apps/companion/package.json
COPY --from=build /app/apps/companion/node_modules ./apps/companion/node_modules
COPY --from=build /app/apps/companion/dist ./apps/companion/dist

EXPOSE 4173
CMD ["node", "apps/companion/dist/index.js"]
