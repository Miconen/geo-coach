<script lang="ts">
  // Game page (#56 2a(ii)): h1 title; parent Games; inline Rounds with scores and Session chips; disclosure runs
  // (run-wide and Game-scoped counts) and per-Round Learnings.
  import EntityChip from "$lib/components/EntityChip.svelte";
  import GameScoreboard from "$lib/components/GameScoreboard.svelte";
  import LearningRow from "$lib/components/LearningRow.svelte";
  import RoundStrip from "$lib/components/RoundStrip.svelte";
  import { entityHref, links } from "$lib/links.js";
  import { gameTitle, roundLabel, sessionTitle } from "$lib/entity-titles.js";
  import { useEntityRefresh } from "$lib/live/entity-refresh.svelte.js";
  import type { GamePayload } from "$lib/server/entities/index.js";

  let { data } = $props();
  const live = useEntityRefresh<GamePayload>({
    base: () => data.payload,
    url: () => `/api/duos/${data.duo.id}/games/${data.payload.game.id}/refresh`,
    consumer: "game",
  });
  const p = $derived(live.current);
  const duoId = $derived(data.duo.id);
  const rounds = $derived(p.game.roundIds.flatMap((id) => (p.wb.roundsById[id] ? [p.wb.roundsById[id]!] : [])));
  let revealed = $state<Record<string, boolean>>({});

  const counts = (c: { current: number; surviving: number } | null, label: string, draft: boolean) =>
    c ? (draft ? `${label}: ${c.surviving} draft` : `${label}: ${c.current} current of ${c.surviving} surviving`) : null;
  const shortId = (id: string) => id.slice(-6);
</script>

<svelte:head><title>{gameTitle(p.game)} · {data.duo.name}</title></svelte:head>

<main class="mx-auto max-w-[1400px] space-y-3 px-[clamp(16px,3vw,64px)] py-4">
  <a href={links.games(duoId)} data-testid="back-link" class="text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)]">← Games</a>
  <header class="space-y-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
    <h1 class="text-base font-bold tracking-tight">{gameTitle(p.game)}</h1>
    <GameScoreboard game={p.game} />
  </header>
  {#if live.missing}
    <p role="status" data-testid="entity-missing" class="rounded-xl bg-[var(--warn-bg)] px-4 py-2 text-sm text-[var(--warn)]">
      That Game no longer exists.
    </p>
  {/if}

  <section class="space-y-1.5" aria-label="Rounds">
    <h2 class="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Rounds</h2>
    <RoundStrip {duoId} {rounds} />
  </section>

  <section class="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Sessions" data-testid="game-sessions">
    <span class="font-semibold text-[var(--muted)]">Sessions:</span>
    {#each p.sessions as s (s.id)}
      <EntityChip kind="session" label={sessionTitle(s)} href={entityHref({ kind: "session", duoId, id: s.id })} />
    {:else}
      <span class="text-[var(--muted)]">no overlapping Session</span>
    {/each}
    {#if p.relatedSessions.length > 0}
      <span class="ml-2 font-semibold text-[var(--muted)]">Related by citation:</span>
      {#each p.relatedSessions as s (s.id)}
        <EntityChip kind="session" label={sessionTitle(s)} href={entityHref({ kind: "session", duoId, id: s.id })} />
      {/each}
    {/if}
  </section>

  <details class="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3" data-testid="game-runs">
    <summary class="cursor-pointer text-xs font-semibold">Runs ({p.runs.length})</summary>
    <ul class="mt-2 space-y-1.5">
      {#each p.runs as gr (gr.row.key)}
        <li class="rounded-lg border border-[var(--border)] px-3 py-2 text-xs" data-testid="game-run" data-run-id={gr.row.runId}>
          <div class="flex flex-wrap items-center gap-2">
            <span class="mono font-semibold">{gr.row.purpose}</span>
            <span class="rounded-full border border-[var(--border-strong)] px-2 py-0.5">{gr.row.status}</span>
            <EntityChip
              kind="run"
              label={`run ${shortId(gr.row.runId!)}`}
              href={entityHref({ kind: "run", duoId, id: gr.row.runId!, sessionId: gr.sessionId })}
            />
            {#if gr.sessionStartedAt && !p.sessions.some((s) => s.id === gr.sessionId)}
              <EntityChip
                kind="session"
                label={sessionTitle({ startedAt: gr.sessionStartedAt })}
                href={entityHref({ kind: "session", duoId, id: gr.sessionId })}
              />
            {/if}
            {#if gr.evidenceOnly}
              <span class="text-[var(--muted)]" data-testid="evidence-only">
                evidence only: {gr.game.claimsCreated + gr.game.claimsWithNewEvidence} Claim{gr.game.claimsCreated + gr.game.claimsWithNewEvidence === 1 ? "" : "s"}
              </span>
            {/if}
          </div>
          <div class="mt-1 grid gap-0.5 text-[var(--muted)] sm:grid-cols-2">
            <div data-testid="run-wide-counts">
              <span class="font-semibold">Whole run:</span>
              {counts(gr.row.learnings, "Learnings", gr.row.draft) ?? ""}
              {counts(gr.row.callLabels, "Call labels", gr.row.draft) ?? ""}
              · Claims created: {gr.row.claimsCreated} · Existing Claims with new Evidence: {gr.row.claimsWithNewEvidence}
            </div>
            <div data-testid="game-scoped-counts">
              <span class="font-semibold">This Game:</span>
              {counts(gr.game.learnings, "Learnings", gr.row.draft) ?? ""}
              {counts(gr.game.callLabels, "Call labels", gr.row.draft) ?? ""}
              · Claims created: {gr.game.claimsCreated} · Existing Claims with new Evidence: {gr.game.claimsWithNewEvidence}
            </div>
          </div>
        </li>
      {:else}
        <li class="text-xs text-[var(--muted)]">No runs touch this Game yet.</li>
      {/each}
    </ul>
  </details>

  <details class="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3" data-testid="round-learnings">
    <summary class="cursor-pointer text-xs font-semibold">Learnings by Round</summary>
    {#each rounds as r (r.id)}
      {@const ls = p.wb.learnings.filter((l) => l.roundIds.includes(r.id))}
      {#if ls.length > 0}
        <div class="mt-2 space-y-1">
          <EntityChip
            kind="round"
            label={roundLabel(r)}
            href={entityHref({ kind: "round", duoId, id: r.id, gameId: r.gameId, roundNumber: r.roundNumber })}
          />
          <ul class="space-y-1">
            {#each ls as l (l.id)}
              <LearningRow
                {duoId}
                learning={l}
                revealed={Boolean(revealed[l.id])}
                onReveal={() => (revealed = { ...revealed, [l.id]: true })}
                runLabel={l.runId ? `run ${shortId(l.runId)}` : null}
              />
            {/each}
          </ul>
        </div>
      {/if}
    {/each}
  </details>
</main>
