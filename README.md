# geo-coach

Voice-captured coaching workbench for a GeoGuessr ranked team-duels **Duo**. Each Player records only their own mic locally, transcribes on their own GPU with `faster-whisper`, syncs raw ranked team-duel payloads and replays from GeoGuessr, and runs manual AI **Processing runs** over a remote **MCP** server to turn spoken callouts and debriefs into **Learnings** linked back to **Games**, **Rounds**, and **Utterances**.

See [GLOSSARY.md](GLOSSARY.md) for domain terms and [docs/adr/](docs/adr/) for core architecture decisions.

## Repo layout

- `apps/web` — Single Node 24 SvelteKit 5 server (SSR A3 coaching workbench UI, Companion REST API, `/mcp` stateless Streamable HTTP server, Discord OAuth + scoped tokens, Drizzle + Postgres 17, per-Duo SSE).
- `apps/companion` — Local Docker Companion (TS server, `node:sqlite` outbox, Svelte AudioWorklet recording page on `127.0.0.1:4173`, sequential GeoGuessr poller, and Python CUDA `faster-whisper` transcriber).
- `packages/shared` — Zod API contracts, RFC 9562 UUIDv7, ISO 3166-1 alpha-2 country catalog, clock-offset math, and pure GeoGuessr/Round/Utterance derivation.
- `infra/` — LeaseWeb VPS bootstrap (`bootstrap.sh`), production Docker Compose, Caddyfile, and Cloudflare setup guide.

## Local development

Prerequisites: Node 22+ (24 LTS recommended), pnpm 10, and Docker or Podman (for Postgres 17; `pnpm dev` uses whichever is on PATH, or `CONTAINER_CLI`).

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Start Postgres, run migrations, and seed a dev Duo + two Players:
   ```bash
   docker compose -f compose.dev.yml up -d postgres
   pnpm db:migrate
   pnpm db:seed
   ```
3. Start the full dev stack (Postgres, SvelteKit web app on `http://localhost:5173`, and Companion on `http://127.0.0.1:4173` using the fake transcriber):
   ```bash
   pnpm dev
   ```
4. Sign in and connect the Companion:
   - Open `http://localhost:5173/login` and pick a seeded Player under **Development Login** (only active when `NODE_ENV=development`).
   - Open `http://localhost:5173/settings` and issue a `companion` token (and an `mcp` token for AI processing runs).
   - Open `http://127.0.0.1:4173`, paste the `companion` token (and optionally your GeoGuessr `_ncfa` cookie) into **Local Settings**, save, pick the Duo, and press **Start Recording**.

### Real GPU Whisper locally (optional)

```bash
docker compose -f compose.dev.yml --profile gpu up -d transcriber
TRANSCRIBER_MODE=http pnpm dev
```

## Running an AI Processing run over MCP

Point any MCP-compatible agent at `https://<your-domain>/mcp` (or `http://localhost:5173/mcp` locally) with header:

```text
Authorization: Bearer <your gc_mcp_... token>
```

Available tools: `get_instructions`, `list_work`, `start_run`, `read_range`, `add_learnings`, `finish_run` (plus `extract` and `tips` prompts).

## Companion on a Player's PC

Use [apps/companion/compose.yml](apps/companion/compose.yml) with Docker Desktop (WSL2 + NVIDIA GPU). Audio stays in a local Docker volume (converted to FLAC after Stop) and never leaves the PC. Update between Sessions with `./update.sh` (or `./update.ps1`).

## Useful commands

```bash
pnpm typecheck                  # TypeScript + svelte-check across all workspaces
pnpm test                       # Vitest suite (uses in-process PGlite + real Drizzle migrations)
pnpm build                      # Production builds for shared, web, and companion
pnpm db:generate                # Generate a new Drizzle SQL migration
pnpm db:migrate                 # Apply Drizzle migrations to DATABASE_URL
pnpm db:seed                    # Seed Duos and Players (set SEED_CONFIG_PATH for custom JSON)
pnpm --filter @geo-coach/web db:rebuild-derived  # Rebuild derived Games & Rounds from raw jsonb
```

## Production deployment

See [infra/README.md](infra/README.md) for the one-time Cloudflare, VPS bootstrap, GHCR public package, and GitHub `production` environment setup. Pushes to `main` run checks, build images, dump Postgres, run migrations, and deploy via [.github/workflows/deploy.yml](.github/workflows/deploy.yml).
