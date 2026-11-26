<script lang="ts">
  // Round page (#82): the Session page's debrief (F, #79) with this Round focused, plus a Claims and Evidence tab
  // beside its transcript. The stepper walks the Game's Rounds page by page. What the Round page held before (its
  // score and Sessions, the exact location and the editable speech) lives in the "Round details" drawer.
  // ?location=1 opens the Round already revealed, with the details on its exact location.
  import { page } from "$app/state";
  import ClaimCard from "$lib/components/ClaimCard.svelte";
  import EntityChip from "$lib/components/EntityChip.svelte";
  import Masked from "$lib/components/Masked.svelte";
  import RoundCoachingCard from "$lib/components/RoundCoachingCard.svelte";
  import UtteranceText from "$lib/components/UtteranceText.svelte";
  import DebriefView from "$lib/debrief/DebriefView.svelte";
  import { SECTION, parseAnchor } from "$lib/anchors.js";
  import { entityHref, links } from "$lib/links.js";
  import { urlDisclosure } from "$lib/url-disclosure.js";
  import { gameTitle, sessionTitle } from "$lib/entity-titles.js";
  import { useEntityRefresh } from "$lib/live/entity-refresh.svelte.js";
  import type { RoundPayload } from "$lib/server/entities/index.js";
  import { roundSlice } from "$lib/workbench/slices.js";
  import { playerInk } from "$lib/player-color.js";

  let { data } = $props();
  const live = useEntityRefresh<RoundPayload>({
    base: () => data.payload,
    url: () => `/api/duos/${data.duo.id}/rounds/${data.payload.round.id}/refresh`,
    consumer: "round",
  });
  const p = $derived(live.current);
  const duoId = $derived(data.duo.id);
  const slice = $derived(roundSlice(p.wb, p.round.id));
  const claims = $derived(p.citingClaimIds.flatMap((id) => (p.wb.claimsById[id] ? [p.wb.claimsById[id]!] : [])));
  const showLocation = $derived(page.url.searchParams.get("location") === "1");
  let speechRevealed = $state(false);
  const title = $derived(`${gameTitle(p.game)} · Round ${p.round.roundNumber}`);
  const gameHref = $derived(links.game(duoId, p.game.id));
  const back = $derived(
    p.homeSession
      ? { label: "Session", href: links.session(duoId, p.homeSession.id) }
      : { label: "Games", href: links.games(duoId) },
  );
  // An anchor to a section of the details (#location, #speech) opens them.
  const anchored = $derived(parseAnchor(page.url.hash));
  const opensDetails = $derived(
    anchored?.kind === "section" && (anchored.id === SECTION.location || anchored.id === SECTION.speech),
  );
</script>

<svelte:head><title>{title} · {data.duo.name}</title></svelte:head>

{#snippet claimsTab(revealed: boolean)}
  <div class="space-y-2" data-testid="round-claims">
    <p class="text-xs font-semibold">Citing Claims ({claims.length})</p>
    {#if claims.length === 0}
      <p class="text-xs text-[var(--muted)]">No Claim cites this Round.</p>
    {:else}
      <Masked block {revealed}>
        <div class="space-y-2">
          {#each claims as c (c.id)}
            <ClaimCard claim={c} wb={p.wb} {duoId} />
          {/each}
        </div>
      </Masked>
    {/if}
  </div>
{/snippet}

{#snippet roundDetails()}
  <div class="space-y-3" data-testid="round-details">
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

    {#if showLocation}
      <section id={SECTION.location} class="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs" data-testid="round-location">
        <h3 class="font-semibold">Location</h3>
        <span class="mono">{p.round.countryName ?? p.round.countryCode ?? "Unknown"}{p.round.regionName ? ` · ${p.round.regionName}` : ""}{p.round.lat !== null && p.round.lng !== null ? ` · ${p.round.lat.toFixed(5)}, ${p.round.lng.toFixed(5)}` : ""}</span>
      </section>
    {/if}

    <details
      id={SECTION.speech}
      use:urlDisclosure={SECTION.speech}
      class="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
      data-testid="round-speech"
    >
      <summary class="cursor-pointer text-xs font-semibold">Speech</summary>
      {#if slice}
        <div class="mt-2">
          <Masked block revealed={speechRevealed || showLocation}>
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
                  <strong class="ml-1" style:color={p.wb.players[u.playerId] ? playerInk(p.wb.players[u.playerId]!.avatarColor) : undefined}
                    >{p.wb.players[u.playerId]?.displayName ?? "Player"}:</strong
                  >
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
  </div>
{/snippet}

<div class="mx-auto max-w-[2320px] px-[clamp(16px,3vw,64px)] pt-3">
  {#if live.missing}
    <p role="status" data-testid="entity-missing" class="mb-2 rounded-xl bg-[var(--warn-bg)] px-4 py-2 text-sm text-[var(--warn)]">
      That Round no longer exists.
    </p>
  {/if}
  <h1 class="sr-only">{title}</h1>
  <a href={gameHref} data-testid="back-link" class="sr-only focus:not-sr-only">← {gameTitle(p.game)}</a>
  <div class="overflow-hidden rounded-xl border border-[var(--border)]">
    {#key p.round.id}
      <DebriefView
        debrief={p.debrief}
        {duoId}
        title={p.homeSession ? sessionTitle(p.homeSession) : "Not recorded"}
        scope={{ kind: "round", roundId: p.round.id }}
        {back}
        roundHref={(r) => links.round(duoId, r.gameId, r.roundNumber)}
        upHref={gameHref}
        roundTab={{ key: SECTION.claims, label: "Claims & Evidence", content: claimsTab }}
        details={{ label: "Round details", content: roundDetails }}
        defaultDrawer={opensDetails ? "details" : null}
        startRevealed={showLocation}
      />
    {/key}
  </div>
</div>
