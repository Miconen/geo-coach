# geo-coach

Voice-captured GeoGuessr ranked team-duels coaching workbench.

## Architecture & Domain Rules
- **Vocabulary:** Read `GLOSSARY.md` first and use its exact domain terms (`Duo`, `Player`, `Opponent`, `Game`, `Round`, `Learning`, `Tip`, `Study item`, `Utterance`, `Session`, `Recording`, `Transcript`, `Processing run`, `Companion`).
- **ADRs:** Read `docs/adr/0001-derived-staleness-and-supersession.md` and `docs/adr/0002-processing-run-purpose.md`. Raw data is stored; UTC alignment, Rounds, Utterance↔Round links, staleness, and purpose-scoped Learning supersession are derived.
- **Public repo:** Never commit recordings, transcripts, `.env` files, `_ncfa` cookies, or secrets.
- **Migrations:** Expand/contract only — every Drizzle migration must stay compatible with the previous release's code.
- **API compatibility:** Companion endpoints accept the current and previous `X-GeoCoach-Api-Version`.

## Layout
- `packages/shared` — Zod API contracts, UUIDv7, pure GeoGuessr & timestamp derivation helpers.
- `apps/web` — Single Node SvelteKit 5 server (SSR UI, Companion API, `/mcp` Streamable HTTP, Drizzle + Postgres 17, SSE).
- `apps/companion` — Local Docker Companion (TS server + SQLite outbox + AudioWorklet Svelte recording page + Python `faster-whisper` service).
- `infra/` — VPS bootstrap script, Caddyfile, production compose, Cloudflare setup guide.

## Agent skills
- **Issue tracker:** GitHub Issues (`Miconen/geo-coach`) via `gh` CLI. See `docs/agents/issue-tracker.md`.
- **Triage labels:** `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.
- **Domain docs:** `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.
