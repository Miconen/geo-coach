<script lang="ts">
  // Round page (#56 2a(ii)): h1 Game + number; parent Game (the in-page Back control links there, also when the
  // Round was reached from Stats); inline score and Learnings; disclosure speech and citing Claims.
  // ?location=1#location shows the exact location, behind its own Recall reveal.
  import { page } from "$app/state";
  import ClaimRow from "$lib/components/ClaimRow.svelte";
  import EntityChip from "$lib/components/EntityChip.svelte";
  import LearningRow from "$lib/components/LearningRow.svelte";
  import Masked from "$lib/components/Masked.svelte";
  import RoundCoachingCard from "$lib/components/RoundCoachingCard.svelte";
  import UtteranceText from "$lib/components/UtteranceText.svelte";
  import { entityHref, links } from "$lib/links.js";
  import { gameTitle, sessionTitle } from "$lib/entity-titles.js";
  import { useEntityRefresh } from "$lib/live/entity-refresh.svelte.js";
  import type { RoundPayload } from "$lib/server/entities/index.js";
  import { roundSlice } from "$lib/workbench/slices.js";

  let { data } = $props();
  const live = useEntityRefresh<RoundPayload>({
    base: () => data.payload,
    url: () => `/api/duos/${data.duo.id}/rounds/${data.payload.round.id}/refresh`,
    consumer: "round",
  });
  const p = $derived(live.current);
  const duoId = $derived(data.duo.id);
  const slice = $derived(roundSlice(p.wb, p.round.id));
  const learnings = $derived(p.wb.learnings.filter((l) => l.roundIds.includes(p.round.id)));
  const claims = $derived(p.citingClaimIds.flatMap((id) => (p.wb.claimsById[id] ? [p.wb.claimsById[id]!] : [])));
  const showLocation = $derived(page.url.searchParams.get("location") === "1");
  let revealed = $state<Record<string, boolean>>({});
  let speechRevealed = $state(false);
  let locationRevealed = $state(false);
  const shortId = (id: string) => id.slice(-6);
  const title = $derived(`${gameTitle(p.game)} · Round ${p.round.roundNumber}`);
</script>

<svelte:head><title>{title} · {data.duo.name}</title></svelte:head>

<main class="mx-auto max-w-[1400px] space-y-3 px-[clamp(16px,3vw,64px)] py-4">
  <a href={links.game(duoId, p.game.id)} data-testid="back-link" class="text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)]"
    >← {gameTitle(p.game)}</a
  >
  <header class="space-y-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
    <h1 class="text-base font-bold tracking-tight">{title}</h1>
    <div class="flex flex-wrap items-center gap-2 text-xs" data-testid="round-score">
      <span class="mono">{p.round.duoBestScore} – {p.round.opponentBestScore}</span>
      {#if p.round.hpDelta !== 0}
        <span class="mono {p.round.hpDelta < 0 ? 'text-[var(--danger)]' : 'text-[var(--ok)]'}">{p.round.hpDelta > 0 ? "+" : ""}{p.round.hpDelta} HP</span>
      {/if}
      {#if p.round.damageMultiplier !== 1}<span class="text-[var(--muted)]">×{p.round.damageMultiplier}</span>{/if}
      {#each p.sessions as s (s.id)}
        <EntityChip kind="session" label={sessionTitle(s)} href={entityHref({ kind: "session", duoId, id: s.id })} />
      {/each}
    </div>
  </header>
  {#if live.missing}
    <p role="status" data-testid="entity-missing" class="rounded-xl bg-[var(--warn-bg)] px-4 py-2 text-sm text-[var(--warn)]">
      That Round no longer exists.
    </p>
  {/if}

  {#if showLocation}
    <section id="location" class="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-xs" data-testid="round-location">
      <h2 class="font-semibold">Location</h2>
      <Masked revealed={locationRevealed}>
        {#snippet placeholder()}
          <button type="button" class="font-semibold text-[var(--accent)]" onclick={() => (locationRevealed = true)}>Reveal location</button>
        {/snippet}
        <span class="mono">{p.round.countryName ?? p.round.countryCode ?? "Unknown"}{p.round.regionName ? ` · ${p.round.regionName}` : ""}{p.round.lat !== null && p.round.lng !== null ? ` · ${p.round.lat.toFixed(5)}, ${p.round.lng.toFixed(5)}` : ""}</span>
      </Masked>
    </section>
  {/if}

  <section class="space-y-1.5" aria-label="Learnings">
    <h2 class="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Learnings</h2>
    <ul class="space-y-1">
      {#each learnings as l (l.id)}
        <LearningRow
          {duoId}
          learning={l}
          revealed={Boolean(revealed[l.id])}
          onReveal={() => (revealed = { ...revealed, [l.id]: true })}
          runLabel={l.runId ? `run ${shortId(l.runId)}` : null}
        />
      {:else}
        <li class="text-xs text-[var(--muted)]">No Learnings from this Round yet.</li>
      {/each}
    </ul>
  </section>

  <details class="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3" data-testid="round-speech">
    <summary class="cursor-pointer text-xs font-semibold">Speech</summary>
    {#if slice}
      <div class="mt-2">
        <Masked block revealed={speechRevealed}>
          {#snippet placeholder()}
            <RoundCoachingCard round={slice.round} utterances={slice.utterances} players={slice.players} recallHidden />
            <button type="button" data-testid="round-reveal" class="mt-1 text-xs font-medium text-[var(--accent)]" onclick={() => (speechRevealed = true)}
              >Reveal this Round's speech</button
            >
          {/snippet}
          <RoundCoachingCard round={slice.round} utterances={slice.utterances} players={slice.players} />
          <ul class="mt-2 space-y-1" data-testid="round-utterances">
            {#each slice.utterances as u (u.id)}
              <li class="rounded bg-[var(--surface-subtle)] px-2 py-1 text-xs">
                <span class="mono text-[var(--muted)]">{new Date(u.startedAt).toISOString().slice(11, 19)}</span>
                <strong class="ml-1">{p.wb.players[u.playerId]?.displayName ?? "Player"}:</strong>
                <UtteranceText {duoId} utterance={u} countryCode={p.round.countryCode} onSaved={live.refresh} />
              </li>
            {:else}
              <li class="text-xs text-[var(--muted)]">No speech in this Round.</li>
            {/each}
          </ul>
        </Masked>
      </div>
    {/if}
  </details>

  <details class="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3" data-testid="round-claims">
    <summary class="cursor-pointer text-xs font-semibold">Citing Claims ({claims.length})</summary>
    <ul class="mt-2 space-y-1">
      {#each claims as c (c.id)}
        <ClaimRow {duoId} claim={c} revealed={Boolean(revealed[c.id])} onReveal={() => (revealed = { ...revealed, [c.id]: true })} />
      {:else}
        <li class="text-xs text-[var(--muted)]">No Claim cites this Round.</li>
      {/each}
    </ul>
  </details>
</main>
