<script lang="ts">
  // Game page (#82): the Session page's debrief (F, #79) scoped to this Game, plus an HP-over-Rounds strip above
  // its Round tiles. What the Game page held before (its Rounds, Sessions, runs and Learnings by Round) lives in
  // the "Game details" drawer, which an anchor to one of those sections opens.
  import { page } from "$app/state";
  import DebriefView from "$lib/debrief/DebriefView.svelte";
  import EntityChip from "$lib/components/EntityChip.svelte";
  import LearningRow from "$lib/components/LearningRow.svelte";
  import RoundStrip from "$lib/components/RoundStrip.svelte";
  import { SECTION, parseAnchor } from "$lib/anchors.js";
  import { entityHref, links } from "$lib/links.js";
  import { urlDisclosure } from "$lib/url-disclosure.js";
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

  // The back control: the Game's Session, or the Games list when no one recorded it.
  const back = $derived(
    p.homeSession
      ? { label: "Session", href: links.session(duoId, p.homeSession.id) }
      : { label: "Games", href: links.games(duoId) },
  );
  // An anchor to a section of the details (#runs, #learning-<id>, …) opens them; a Round anchor focuses the Round.
  const DETAIL_SECTIONS = new Set<string>([SECTION.rounds, SECTION.sessions, SECTION.runs, SECTION.learnings]);
  const anchored = $derived(parseAnchor(page.url.hash));
  const opensDetails = $derived(
    anchored !== null && (anchored.kind === "section" ? DETAIL_SECTIONS.has(anchored.id) : anchored.kind !== "round"),
  );

  const counts = (c: { current: number; surviving: number } | null, label: string, draft: boolean) =>
    c ? (draft ? `${label}: ${c.surviving} draft` : `${label}: ${c.current} current of ${c.surviving} surviving`) : null;
  const shortId = (id: string) => id.slice(-6);
</script>

<svelte:head><title>{gameTitle(p.game)} · {data.duo.name}</title></svelte:head>

{#snippet gameDetails()}
  <div class="space-y-3" data-testid="game-details">
    <section id={SECTION.rounds} class="space-y-1.5" aria-label="Rounds">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Rounds</h3>
      <RoundStrip {duoId} {rounds} />
    </section>

    <section id={SECTION.sessions} class="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Sessions" data-testid="game-sessions">
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

    <details
      id={SECTION.runs}
      use:urlDisclosure={SECTION.runs}
      class="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
      data-testid="game-runs"
    >
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
            <div class="mt-1 grid gap-0.5 text-[var(--muted)]">
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

    <details
      id={SECTION.learnings}
      use:urlDisclosure={SECTION.learnings}
      class="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
      data-testid="round-learnings"
    >
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
  </div>
{/snippet}

<div class="mx-auto max-w-[2320px] px-[clamp(16px,3vw,64px)] pt-3">
  {#if live.missing}
    <p role="status" data-testid="entity-missing" class="mb-2 rounded-xl bg-[var(--warn-bg)] px-4 py-2 text-sm text-[var(--warn)]">
      That Game no longer exists.
    </p>
  {/if}
  <h1 class="sr-only">{gameTitle(p.game)}</h1>
  <a href={back.href} data-testid="back-link" class="sr-only focus:not-sr-only">← {back.label}</a>
  <div class="overflow-hidden rounded-xl border border-[var(--border)]">
    <DebriefView
      debrief={p.debrief}
      {duoId}
      title={p.homeSession ? sessionTitle(p.homeSession) : "Not recorded"}
      scope={{ kind: "game", gameId: p.game.id }}
      {back}
      hpStrip
      details={{ label: "Game details", content: gameDetails }}
      defaultDrawer={opensDetails ? "details" : null}
    />
  </div>
</div>
