<script lang="ts">
  // Knowledge (#56 3a): the Duo's Sources (compact, at the top) and its Claims with voting, search, status and topic
  // filters and ?country=. Under Recall every Claim is masked with its own reveal, and a masked Claim matches no
  // search. ?claim= opens the Claim drawer in place.
  import { page } from "$app/state";
  import type { EvidenceDirection } from "@geo-coach/shared";
  import ClaimCard from "$lib/components/ClaimCard.svelte";
  import ClaimDrawer from "$lib/components/ClaimDrawer.svelte";
  import EntityChip from "$lib/components/EntityChip.svelte";
  import Masked from "$lib/components/Masked.svelte";
  import { parseCountryParam } from "$lib/country-param.js";
  import { links } from "$lib/links.js";
  import { useEntityRefresh } from "$lib/live/entity-refresh.svelte.js";
  import { recall } from "$lib/recall.svelte.js";
  import type { KnowledgePayload } from "$lib/server/entities/index.js";
  import { updateQuery } from "$lib/stats/url-query.js";
  import {
    CLAIM_STATUSES,
    CLAIM_STATUS_META,
    filterWorkbenchClaims,
    groupClaimsByCountry,
  } from "$lib/workbench/knowledge.js";

  let { data } = $props();
  const duoId = $derived(data.duo.id);
  const live = useEntityRefresh<KnowledgePayload>({
    base: () => data.payload,
    url: () => `/api/duos/${data.duo.id}/knowledge/refresh`,
    consumer: "knowledge",
  });
  const p = $derived(live.current);

  let search = $state("");
  let status = $state<(typeof CLAIM_STATUSES)[number] | "all">("all");
  let topic = $state("all");
  let country = $state<string | null>(parseCountryParam(page.url.searchParams.get("country")));
  let revealedClaims = $state<Record<string, boolean>>({});
  let revealedLearnings = $state<Record<string, boolean>>({});

  const masked = (id: string) => recall.on && !revealedClaims[id];
  const topics = $derived([...new Set(p.claims.flatMap((c) => c.topics))].sort());
  const filtered = $derived(filterWorkbenchClaims(p.claims, { status, topic, query: search, country, masked }));
  const groups = $derived(groupClaimsByCountry(filtered, country));
  // Claim cards render 100 at a time (a Duo's bank runs to thousands; a multi-Country Claim shows once per Country);
  // changing a filter resets the window.
  const cardTotal = $derived(groups.reduce((n, g) => n + g.claims.length, 0));
  let shownCount = $state(100);
  $effect(() => {
    void [status, topic, search, country];
    shownCount = 100;
  });
  const shownGroups = $derived.by(() => {
    let budget = shownCount;
    const out: { group: (typeof groups)[number]; claims: (typeof groups)[number]["claims"] }[] = [];
    for (const group of groups) {
      if (budget <= 0) break;
      out.push({ group, claims: group.claims.slice(0, budget) });
      budget -= group.claims.length;
    }
    return out;
  });

  const claimParam = $derived(page.url.searchParams.get("claim"));
  const drawerClaim = $derived(claimParam ? (p.claims.find((c) => c.id === claimParam) ?? null) : null);

  function setCountry(next: string | null) {
    country = next;
    updateQuery((params) => {
      if (next) params.set("country", next);
      else params.delete("country");
    });
  }

  async function setClaimEvidence(claimId: string, direction: EvidenceDirection | null) {
    await fetch(`/api/claims/${claimId}/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction }),
    });
    await live.refresh();
  }

  const cardProps = $derived({
    wb: p.wb,
    duoId,
    revealedLearningIds: revealedLearnings,
    onSetEvidence: setClaimEvidence,
    learningHref: (id: string) => links.review(duoId, { learning: id }),
  });
  const closeHref = $derived(links.knowledge(duoId, { country }));
</script>

<svelte:head><title>Knowledge · {data.duo.name}</title></svelte:head>

<main class="mx-auto max-w-[1400px] space-y-3 px-[clamp(16px,3vw,64px)] py-4">
  <header class="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
    <h1 class="text-base font-bold tracking-tight">Knowledge</h1>
    <p class="mt-0.5 text-[11px] text-[var(--muted)]">
      A Claim's status comes only from its Evidence: Rounds whose location confirms it, your ✓/✗, and Source sections.
      Unconfirmed Claims are guesses, not facts.
    </p>
  </header>

  <section class="space-y-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3" data-testid="sources">
    <h2 class="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Sources ({p.sources.length})</h2>
    {#each p.sources as src (src.id)}
      <div class="flex flex-wrap items-center justify-between gap-2 text-xs" data-testid="source-row">
        <span class="flex min-w-0 items-center gap-1.5">
          <span class="rounded bg-[var(--badge-bg)] px-1 text-[10px] uppercase text-[var(--badge-ink)]">{src.kind}</span>
          <EntityChip kind="source" label={src.title} href={links.source(duoId, src.id)} />
          {#if src.url}<a href={src.url} target="_blank" rel="noopener noreferrer" class="text-[11px] text-[var(--muted)] hover:underline">original ↗</a>{/if}
        </span>
        <span class="mono text-[11px] text-[var(--muted)]">
          v{src.latestVersionNo} of {src.versionCount} · {new Date(src.updatedAt).toLocaleDateString()} · {src.sectionCount} sections · {src.imageCount} images
        </span>
      </div>
    {:else}
      <p class="text-xs text-[var(--muted)]">No Sources yet. Hand an agent a Plonkit page or guide and ask it to ingest it.</p>
    {/each}
  </section>

  <div class="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
    <input
      bind:value={search}
      placeholder="Search Claims"
      data-testid="claim-search"
      class="min-w-[200px] flex-1 rounded-lg border border-[var(--border-strong)] px-2.5 py-1.5 text-sm"
    />
    <select bind:value={status} class="rounded-lg border border-[var(--border-strong)] px-2 py-1.5" data-testid="claim-status">
      <option value="all">All statuses</option>
      {#each CLAIM_STATUSES as st (st)}<option value={st}>{CLAIM_STATUS_META[st].label}</option>{/each}
    </select>
    <select bind:value={topic} class="rounded-lg border border-[var(--border-strong)] px-2 py-1.5" data-testid="claim-topic">
      <option value="all">All topics</option>
      {#each topics as t (t)}<option value={t}>#{t}</option>{/each}
    </select>
    {#if country}
      <button
        type="button"
        data-testid="country-filter"
        onclick={() => setCountry(null)}
        class="rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] px-2.5 py-1.5 font-semibold text-[var(--accent-soft-ink)]"
        >{country} ✕</button
      >
    {/if}
    <span class="mono ml-auto text-[var(--muted)]" data-testid="claim-count">{filtered.length} Claim{filtered.length === 1 ? "" : "s"}</span>
  </div>

  {#if groups.length === 0}
    <div class="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--muted)]">
      {p.claims.length === 0 ? "No Claims yet. Processing runs and ingested Sources add them." : "No Claims match these filters."}
    </div>
  {:else}
    <div class="space-y-4">
      {#each shownGroups as { group, claims } (group.code ?? "general")}
        <section class="space-y-2">
          <h2 class="px-1 text-xs font-bold">
            {#if group.code}<button type="button" class="mono mr-1 text-[var(--accent)] hover:underline" onclick={() => setCountry(group.code)}>{group.code}</button>{/if}
            {group.name}
            <span class="mono ml-1 font-normal text-[var(--muted)]">{group.claims.length}</span>
          </h2>
          {#each claims as claim (claim.id)}
            <div class="space-y-1" data-testid="knowledge-claim" data-claim-id={claim.id}>
              <Masked block revealed={Boolean(revealedClaims[claim.id])}>
                {#snippet placeholder()}
                  <div class="flex items-center gap-2 rounded-xl border border-dashed border-[var(--border-strong)] px-3 py-2 text-xs">
                    <span class="font-semibold uppercase text-[var(--muted)]">{CLAIM_STATUS_META[claim.status].label}</span>
                    <button
                      type="button"
                      data-testid="claim-reveal"
                      class="font-semibold text-[var(--accent)]"
                      onclick={() => (revealedClaims = { ...revealedClaims, [claim.id]: true })}>Reveal</button
                    >
                  </div>
                {/snippet}
                <ClaimCard {claim} {...cardProps} />
              </Masked>
              <a
                href={links.knowledge(duoId, { country, claim: claim.id })}
                data-sveltekit-noscroll
                data-testid="open-claim"
                class="px-1 text-[11px] font-medium text-[var(--accent)] hover:underline">Open Claim</a
              >
            </div>
          {/each}
        </section>
      {/each}
      {#if shownCount < cardTotal}
        <button
          type="button"
          data-testid="claims-more"
          onclick={() => (shownCount += 100)}
          class="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--surface-subtle)]"
        >
          Show {Math.min(100, cardTotal - shownCount)} more of {cardTotal - shownCount} remaining
        </button>
      {/if}
    </div>
  {/if}
</main>

{#if claimParam}
  <ClaimDrawer
    claim={drawerClaim}
    {closeHref}
    revealed={Boolean(claimParam && revealedClaims[claimParam])}
    onReveal={() => (revealedClaims = { ...revealedClaims, [claimParam!]: true })}
    card={cardProps}
  />
{/if}
