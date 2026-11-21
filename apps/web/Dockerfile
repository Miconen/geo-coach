FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

RUN pnpm install --frozen-lockfile --filter @geo-coach/web...
RUN pnpm --filter @geo-coach/web build
RUN pnpm --filter @geo-coach/web exec esbuild src/lib/server/db/migrate.ts \
      --bundle --platform=node --format=esm --packages=external \
      --outfile=build-migrate.mjs
RUN pnpm --filter @geo-coach/web exec esbuild src/lib/server/db/seed.ts \
      --bundle --platform=node --format=esm \
      --external:drizzle-orm --external:postgres --external:zod \
      --outfile=build-seed.mjs

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    PROMPTS_DIR=/app/apps/web/prompts \
    MIGRATIONS_DIR=/app/apps/web/drizzle

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /app/apps/web/build ./apps/web/build
COPY --from=build /app/apps/web/build-migrate.mjs ./apps/web/build-migrate.mjs
COPY --from=build /app/apps/web/build-seed.mjs ./apps/web/build-seed.mjs
COPY --from=build /app/apps/web/drizzle ./apps/web/drizzle
COPY --from=build /app/apps/web/prompts ./apps/web/prompts

EXPOSE 3000
CMD ["node", "apps/web/build"]
