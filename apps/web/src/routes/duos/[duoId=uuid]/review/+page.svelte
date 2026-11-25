<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import {
    getCountryName,
    type EvidenceDirection,
    type LearningKind,
    type ReactionType,
  } from "@geo-coach/shared";
  import ClaimCard from "$lib/components/ClaimCard.svelte";
  import Masked from "$lib/components/Masked.svelte";
  import ManualLearningModal, { type ManualPrefill } from "$lib/components/ManualLearningModal.svelte";
  import { recall, setRecall } from "$lib/recall.svelte.js";
  import GameCard from "$lib/components/GameCard.svelte";
  import RoundCoachingCard from "$lib/components/RoundCoachingCard.svelte";
  import UtteranceText from "$lib/components/UtteranceText.svelte";
  import { formatRelSec } from "$lib/workbench/format.js";
  import { entityHref, links } from "$lib/links.js";
  import ClaimDrawer from "$lib/components/ClaimDrawer.svelte";
  import { parseCountryParam } from "$lib/country-param.js";
  import { updateQuery } from "$lib/stats/url-query.js";
  import type { ClaimPayload } from "$lib/server/entities/knowledge.js";
  import { gameTitle, roundLabel, sessionTitle } from "$lib/entity-titles.js";
  import { getDuoStream } from "$lib/live/context.js";
  import { heartbeats, needsRefresh } from "$lib/live/dependencies.js";
  import { singleFlight } from "$lib/live/single-flight.js";
  import EntityChip from "$lib/components/EntityChip.svelte";
  import { CLAIM_STATUS_META } from "$lib/workbench/knowledge.js";
  import { gameSlice, learningGameLinks, roundSlice } from "$lib/workbench/slices.js";
  import type {
    CountryDossier,
    WorkbenchClaim,
    WorkbenchLearning,
  } from "$lib/server/workbench/view-model.js";
  import type { ReviewRounds } from "$lib/server/workbench/review-view.js";

  let { data } = $props();
  let liveWorkbench = $state.raw<{
    base: typeof data.workbench;
    value: NonNullable<typeof data.workbench>;
  } | null>(null);
  const wb = $derived(
    liveWorkbench && liveWorkbench.base === data.workbench ? liveWorkbench.value : data.workbench,
  );

  // Filter state (#56 4: Review is the Learnings page; Sessions, Games and Knowledge have their own pages).
  let queueFilter = $state<"all" | "mistakes" | "starred" | "manual" | "stale" | "study">("all");
  let selectedCountry = $state<string | null>(parseCountryParam(page.url.searchParams.get("country")));
  /** The Continent -> Country list and dossier headers set ?country= (#56 3b), replacing the history entry. */
  function setCountry(code: string | null) {
    selectedCountry = code;
    showAllCountryClaims = false;
    updateQuery((params) => {
      if (code) params.set("country", code);
      else params.delete("country");
    });
  }
  let kindFilter = $state<LearningKind | "all">("all");
  let sortMode = $state<"newest" | "hp-leaks">("newest");
  let showDismissed = $state(false);
  let showSuperseded = $state(false);
  let searchQuery = $state("");
  const recallMode = $derived(recall.on);
  let revealedIds = $state<Record<string, boolean>>({});
  // Standalone reveals (X4): a dossier Claim, a bridge Round's speech.
  let revealedClaimIds = $state<Record<string, boolean>>({});
  let revealedRoundIds = $state<Record<string, boolean>>({});

  function toggleRecall() {
    setRecall(data.player.id, data.duo.id, !recall.on);
    revealedIds = {};
    revealedClaimIds = {};
    revealedRoundIds = {};
  }

  // ?claim= (#56 3a): the canonical Claim drawer route. Closing keeps the other params.
  const claimParam = $derived(page.url.searchParams.get("claim"));
  const claimCloseHref = $derived.by(() => {
    const params = new URLSearchParams(page.url.searchParams);
    params.delete("claim");
    return `${page.url.pathname}${params.size ? `?${params}` : ""}`;
  });

  function revealLearning(id: string) {
    revealedIds = { ...revealedIds, [id]: true };
  }

  /** The Space handler leaves focused controls alone, so Space on a button never reveals (X4). */
  function isInteractive(el: HTMLElement | null): boolean {
    return Boolean(el?.closest("button, a[href], input, textarea, select, summary, [contenteditable], [role='button']"));
  }
  let inspectorTab = $state<"provenance" | "game">("provenance");
  // A ?learning= deep link pins that Learning, even when the current filters hide it.
  const pinnedLearningId = (() => page.url.searchParams.get("learning"))();
  let selectedLearningId = $state<string | null>(pinnedLearningId);

  // Live SSE heartbeat statuses
  let sseLiveStatuses = $state<typeof data.workbench extends null ? never : NonNullable<typeof data.workbench>["liveStatuses"] | null>(null);
  const liveStatuses = $derived(sseLiveStatuses ?? data.workbench?.liveStatuses ?? []);

  // Manual Learning modal
  let manualOpen = $state(false);
  let manualPrefill = $state<ManualPrefill>({});
  let searchInputEl = $state<HTMLInputElement | null>(null);

  const filteredLearnings = $derived.by(() => {
    if (!wb) return [] as WorkbenchLearning[];
    const q = searchQuery.trim().toLowerCase();
    let items = wb.learnings.filter((l) => {
      if (!showSuperseded && l.status === "superseded") return false;
      if (!showDismissed && l.dismissed) return false;
      if (kindFilter !== "all" && l.kind !== kindFilter) return false;

      if (queueFilter === "mistakes" && !(l.kind === "mistake" || l.worstHpDelta < 0)) return false;
      if (queueFilter === "starred" && !l.starred) return false;
      if (queueFilter === "manual" && l.origin !== "manual") return false;
      if (queueFilter === "stale" && !l.isStale) return false;
      if (queueFilter === "study" && l.kind !== "study") return false;

      if (selectedCountry && !l.countries.includes(selectedCountry)) return false;

      if (q) {
        const answers = recallMode && !revealedIds[l.id] ? [] : [l.text, l.detail ?? "", l.agentNote ?? "", ...l.topics];
        const hay = [
          ...answers,
          ...l.countries,
          ...l.countries.map(getCountryName),
          ...l.regions.map((r) => r.name),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sortMode === "hp-leaks") {
      items = [...items].sort((a, b) => a.worstHpDelta - b.worstHpDelta);
    }
    return items;
  });

  const flattenDossiers = $derived(
    Boolean(selectedCountry || sortMode === "hp-leaks"),
  );

  const groupedLearnings = $derived.by(() => {
    if (flattenDossiers) {
      return [{ code: null as string | null, dossier: null as CountryDossier | null, items: filteredLearnings }];
    }
    const byCode = new Map<string, WorkbenchLearning[]>();
    for (const l of filteredLearnings) {
      const key = l.countries[0] ?? "__GENERAL__";
      const list = byCode.get(key) ?? [];
      list.push(l);
      byCode.set(key, list);
    }
    const dossierByCode = new Map((wb?.countryDossiers ?? []).map((d) => [d.code, d]));
    return [...byCode.entries()].map(([code, items]) => ({
      code: code === "__GENERAL__" ? null : code,
      dossier: code === "__GENERAL__" ? null : (dossierByCode.get(code) ?? null),
      items,
    }));
  });

  const continentsTree = $derived.by(() => {
    if (!wb) return [] as Array<{ continent: string; countries: CountryDossier[] }>;
    const map = new Map<string, CountryDossier[]>();
    for (const c of wb.countryDossiers) {
      const list = map.get(c.continent) ?? [];
      list.push(c);
      map.set(c.continent, list);
    }
    return [...map.entries()].map(([continent, countries]) => ({ continent, countries }));
  });

  const pinnedLearningMissing = $derived(
    pinnedLearningId !== null && selectedLearningId === pinnedLearningId && !wb?.learnings.some((l) => l.id === pinnedLearningId),
  );

  const activeLearning = $derived(
    wb?.learnings.find((l) => l.id === selectedLearningId) ?? filteredLearnings[0] ?? null,
  );

  /** The per-item reveal of the selected Learning (Masked's prop; Recall itself is on <html>). */
  const activeItemRevealed = $derived(activeLearning ? Boolean(revealedIds[activeLearning.id]) : false);

  const activeLearningRevealed = $derived(
    !recallMode || (activeLearning ? Boolean(revealedIds[activeLearning.id]) : false),
  );

  // Review ships Rounds without their speech (reviewView); the cards' full Rounds come on demand for the Rounds on
  // screen. A newer derivation refetches them, and the last ones stay shown until it lands.
  let detail = $state.raw<ReviewRounds & { wb: unknown }>({ wb: null, roundsById: {}, utterancesById: {} });
  const roundSource = $derived(
    wb ? { gamesById: wb.gamesById, learnings: wb.learnings, players: wb.players, roundsById: detail.roundsById, utterancesById: { ...wb.utterancesById, ...detail.utterancesById } } : null,
  );

  // The Game behind the active Learning's first Round, for the Inspector's "Full Game" tab
  const primaryGameId = $derived.by(() => {
    const roundId = activeLearning?.roundIds[0];
    return roundId ? (wb?.roundsById[roundId]?.gameId ?? null) : null;
  });
  const primaryGameSlice = $derived(roundSource && primaryGameId ? gameSlice(roundSource, primaryGameId) : null);

  const activeLearningGames = $derived(
    wb && activeLearning ? learningGameLinks(wb, activeLearning.roundIds) : [],
  );

  const activeLearningClaim = $derived(
    activeLearning?.claimId ? (wb?.claimsById[activeLearning.claimId] ?? null) : null,
  );

  const activeCountryDossier = $derived(
    selectedCountry ? wb?.countryDossiers.find((c) => c.code === selectedCountry) ?? null : null,
  );

  const neededRoundIds = $derived.by(() => {
    const ids = new Set<string>(activeLearning?.roundIds ?? []);
    for (const id of (primaryGameId ? wb?.gamesById[primaryGameId]?.roundIds : null) ?? []) ids.add(id);
    if (activeCountryDossier && activeCountryDossier.learningCount === 0) for (const id of activeCountryDossier.roundIds) ids.add(id);
    return [...ids].sort();
  });

  $effect(() => {
    const current = wb;
    const ids = neededRoundIds;
    if (!current) return;
    const fresh = detail.wb === current;
    const missing = fresh ? ids.filter((id) => !detail.roundsById[id]) : ids;
    if (missing.length === 0) return;
    let cancelled = false;
    const chunks: string[][] = [];
    for (let i = 0; i < missing.length; i += 200) chunks.push(missing.slice(i, i + 200));
    void Promise.all(
      chunks.map(async (chunk) => {
        const res = await fetch(`/api/duos/${current.duo.id}/review/rounds?ids=${chunk.join(",")}`);
        return res.ok ? ((await res.json()) as ReviewRounds) : null;
      }),
    )
      .then((parts) => {
        if (cancelled || wb !== current || parts.some((x) => x === null)) return;
        const keep = detail.wb === current ? detail : { roundsById: {}, utterancesById: {} };
        detail = {
          wb: current,
          roundsById: Object.assign({}, keep.roundsById, ...parts.map((x) => x!.roundsById)),
          utterancesById: Object.assign({}, keep.utterancesById, ...parts.map((x) => x!.utterancesById)),
        };
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });

  // Review ships no Claim bank (reviewView): the selected Country's Claims come on demand, refetched for a newer
  // derivation, the last ones shown until it lands. The first 20 render until asked for the rest.
  let countryClaims = $state.raw<{ wb: unknown; country: string; claims: WorkbenchClaim[] } | null>(null);
  let showAllCountryClaims = $state(false);
  const activeCountryClaims = $derived(
    activeCountryDossier && activeCountryDossier.claimCount > 0 && countryClaims?.country === activeCountryDossier.code
      ? countryClaims.claims
      : [],
  );
  const shownCountryClaims = $derived(showAllCountryClaims ? activeCountryClaims : activeCountryClaims.slice(0, 20));

  $effect(() => {
    const current = wb;
    const country = selectedCountry;
    if (!current || !country || !current.countryDossiers.some((c) => c.code === country && c.claimCount > 0)) return;
    if (countryClaims?.wb === current && countryClaims.country === country) return;
    let cancelled = false;
    fetch(`/api/duos/${current.duo.id}/review/claims?country=${country}`)
      .then(async (res) => {
        if (!res.ok) return;
        const claims = (await res.json()) as WorkbenchClaim[];
        if (!cancelled) countryClaims = { wb: current, country, claims };
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });

  function openManualModal(opts: ManualPrefill = {}) {
    manualPrefill = opts;
    manualOpen = true;
  }

  async function react(learningId: string, reaction: ReactionType) {
    await fetch(`/api/learnings/${learningId}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reaction }),
    });
    await refreshWorkbench();
  }

  async function setClaimEvidence(claimId: string, direction: EvidenceDirection | null) {
    await fetch(`/api/claims/${claimId}/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction }),
    });
    await refreshWorkbench();
  }

  function openLearning(learningId: string) {
    selectedLearningId = learningId;
  }

  /** Cited speech and Round cards open the Round page (its speech), else the Session page (#56 4). */
  function openUtterance(utteranceId: string, roundId?: string) {
    const utterance = roundSource?.utterancesById[utteranceId];
    if (!wb || !roundSource || !utterance) return;
    const round = roundId
      ? wb.roundsById[roundId]
      : Object.values(roundSource.roundsById).find((r) => r.utteranceIds.includes(utteranceId));
    void goto((round ? links.round(wb.duo.id, round.gameId, round.roundNumber) : null) ?? links.session(wb.duo.id, utterance.sessionId));
  }

  const stream = getDuoStream();

  // The Claim drawer (#56 3b): one Claim fetched on demand, refetched on X5's Claim drawer events. A 404 with the
  // Duo still reachable (the probe) says it no longer exists; a response for a Claim already left is dropped.
  let claimDrawer = $state.raw<{ id: string; payload: ClaimPayload | null } | null>(null);
  const loadClaimDrawer = singleFlight(async () => {
    const id = claimParam;
    if (!id) {
      claimDrawer = null;
      return;
    }
    try {
      const res = await fetch(`/api/duos/${data.duo.id}/claims/${encodeURIComponent(id)}`);
      if (id !== claimParam) return true;
      if (res.status === 400 || res.status === 404) {
        if (res.status === 404 && (await stream?.probe()) !== "ok") return;
        if (id === claimParam) claimDrawer = { id, payload: null };
        return;
      }
      if (!res.ok) return;
      const payload = (await res.json()) as ClaimPayload;
      if (id !== claimParam) return true;
      claimDrawer = { id, payload };
    } catch {
      // Offline: keep what the drawer shows.
    }
  });
  $effect(() => {
    void claimParam;
    void loadClaimDrawer();
  });

  async function setDrawerClaimEvidence(claimId: string, direction: EvidenceDirection | null) {
    await setClaimEvidence(claimId, direction);
    await loadClaimDrawer();
  }
  // Live refresh (X5): fetch-and-overlay through /review (#56 3b), never invalidateAll (Firefox cancels its request on
  // reload and SvelteKit shows the error screen). Single-flight: a burst costs at most two fetches, in order.
  const refreshWorkbench = singleFlight(async () => {
    const base = data.workbench;
    if (!base) return;
    try {
      const res = await fetch(`/api/duos/${base.duo.id}/review`);
      if (res.status === 401 || res.status === 404) {
        // 401 or 404 clears the Duo through the layout's probe.
        await stream?.probe();
        return;
      }
      if (!res.ok) return;
      const value = (await res.json()) as NonNullable<typeof data.workbench>;
      if (base === data.workbench) liveWorkbench = { base, value };
    } catch {
      // Cancelled or offline: keep showing the current data until the next change.
    }
  });

  onMount(() => {
    // The layout's shared stream: heartbeats update the status pills; any change or (re)connection refreshes once.
    const offStream = stream?.subscribe((batch) => {
      for (const hb of heartbeats(batch)) {
        const others = liveStatuses.filter((s) => s.playerId !== hb.playerId);
        sseLiveStatuses = [...others, hb];
      }
      if (needsRefresh("review", batch)) void refreshWorkbench();
      if (claimParam && needsRefresh("knowledge", batch)) void loadClaimDrawer();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");

      if (e.key === "Escape") {
        if (manualOpen) manualOpen = false;
        else if (inInput) target.blur();
        return;
      }
      if (inInput) return;

      if (e.key === "/") {
        e.preventDefault();
        searchInputEl?.focus();
      } else if (e.key === "r") {
        toggleRecall();
      } else if (e.key === " " && recallMode && activeLearning && !isInteractive(target)) {
        e.preventDefault();
        revealLearning(activeLearning.id);
      } else if (e.key === "s" && activeLearning) {
        void react(activeLearning.id, "star");
      } else if ((e.key === "j" || e.key === "k") && filteredLearnings.length > 0) {
        const idx = filteredLearnings.findIndex((l) => l.id === activeLearning?.id);
        const nextIdx =
          e.key === "j"
            ? Math.min(filteredLearnings.length - 1, idx + 1)
            : Math.max(0, idx - 1);
        selectedLearningId = filteredLearnings[nextIdx]?.id ?? null;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      offStream?.();
      window.removeEventListener("keydown", onKeyDown);
    };
  });
</script>

{#if !wb}
  <main class="mx-auto max-w-xl p-8">
    <h1 class="text-lg font-semibold">No Duo configured</h1>
    <p class="mt-2 text-sm text-[var(--muted)]">
      Your account isn't attached to a Duo yet. Seed a Duo with <code>pnpm db:seed</code>.
    </p>
  </main>
{:else}
  <div class="mx-auto max-w-[2320px] px-[clamp(16px,3vw,64px)] py-4">
    <!-- Top Command Header -->
    <header class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-xs">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-base font-bold tracking-tight text-[var(--ink)]">Learnings</h1>

        {#if wb.duo.currentRating !== null}
          {@const dist = wb.duo.targetRating - wb.duo.currentRating}
          <span class="mono rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--accent-soft-ink)]">
            {wb.duo.currentRating} ELO · {dist > 0 ? `${dist} to ${wb.duo.targetDivision}` : `${wb.duo.targetDivision} reached`}
          </span>
        {/if}

        <!-- Live Companion status pills (status only, never transcript text) -->
        {#each liveStatuses as st}
          <span
            class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium {st.recording
              ? 'bg-[var(--ok-bg)] text-[var(--ok)]'
              : 'bg-[var(--surface-subtle)] text-[var(--muted)]'}"
          >
            <span class="h-2 w-2 rounded-full {st.recording ? 'bg-[var(--ok)]' : 'bg-[var(--muted)]'}"></span>
            {st.playerName} {st.recording ? "recording" : "online"}
            {#if !st.uploadOk}
              · retry
            {/if}
          </span>
        {/each}

        {#if wb.totalPendingRanges > 0}
          {@const firstPending = wb.sessions.find((s) => s.extractWorkCount > 0)}
          <a
            href={firstPending ? links.session(wb.duo.id, firstPending.id) : links.sessions(wb.duo.id)}
            class="rounded-full bg-[var(--warn-bg)] px-2.5 py-0.5 text-xs font-semibold text-[var(--warn)] hover:opacity-90"
          >
            {wb.totalPendingRanges} range{wb.totalPendingRanges === 1 ? "" : "s"} need processing →
          </a>
        {/if}
      </div>

      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span class="hidden lg:inline text-[var(--muted)] mono">j/k nav · / search · s star · r recall</span>
        <button
          onclick={() => openManualModal()}
          class="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-semibold text-[var(--accent-ink)] hover:opacity-95"
        >
          + Manual Learning
        </button>
      </div>
    </header>

    {#if pinnedLearningMissing}
      <p
        role="status"
        data-testid="learning-missing"
        class="mt-3 rounded-xl border border-[var(--warn-border,var(--border))] bg-[var(--warn-bg)] px-4 py-2 text-sm text-[var(--warn)]"
      >
        That Learning no longer exists.
      </p>
    {/if}
    {#if data.runMissing}
      <p
        role="status"
        data-testid="run-missing"
        class="mt-3 rounded-xl border border-[var(--border)] bg-[var(--warn-bg)] px-4 py-2 text-sm text-[var(--warn)]"
      >
        That run no longer exists.
      </p>
    {/if}

    <!-- Recent Games -->
    <section class="mt-3">
      <div class="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
        <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Recent Games
        </div>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          {#if wb.recentGames.length === 0}
            <span class="text-xs text-[var(--muted)]">No ranked Games synced yet.</span>
          {:else}
            {#each wb.recentGames.slice(0, 10) as g (g.id)}
              <span data-testid="recent-game">
                <EntityChip
                  kind="game"
                  label={`${g.won ? "W" : "L"}${g.ratingDelta !== null ? ` ${g.ratingDelta >= 0 ? "+" : ""}${g.ratingDelta}` : ""} · ${gameTitle(g)}`}
                  href={entityHref({ kind: "game", duoId: wb.duo.id, id: g.id })}
                />
              </span>
            {/each}
          {/if}
        </div>
      </div>

    </section>

    <!-- 3-Pane Coaching Workbench -->
    <div class="mt-3 grid items-start gap-3 lg:grid-cols-[245px_minmax(0,1fr)_clamp(380px,33%,620px)]">
      <!-- Left Sticky Atlas Rail -->
      <aside class="sticky top-4 max-h-[calc(100vh-32px)] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 space-y-4">
        <div>
          <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Coaching Queues
          </div>
          <nav class="mt-1.5 grid gap-0.5 text-xs">
            {#each [
              ["all", "All Learnings"],
              ["mistakes", "Mistakes & HP Leaks"],
              ["starred", "★ Starred"],
              ["manual", "Manual"],
              ["stale", "Stale Learnings"],
              ["study", "Study Items"],
            ] as [key, label]}
              <button
                onclick={() => {
                  queueFilter = key as typeof queueFilter;
                  setCountry(null);
                }}
                class="rounded-md px-2 py-1.5 text-left {queueFilter === key && !selectedCountry
                  ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent-soft-ink)]'
                  : 'hover:bg-[var(--surface-subtle)]'}"
              >
                {label}
              </button>
            {/each}
          </nav>
        </div>

        <div>
          <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Knowledge Bank
          </div>
          <a href={links.knowledge(wb.duo.id)} data-testid="review-knowledge" class="mt-1.5 block rounded-md px-2 py-1.5 text-xs hover:bg-[var(--surface-subtle)]"
            >All Claims ({wb.claimCount}) and Sources →</a
          >
        </div>

        <div>
          <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Continent → Country
          </div>
          <div class="mt-1.5 space-y-2 text-xs">
            {#each continentsTree as group}
              <div>
                <div class="px-1 text-[11px] font-semibold text-[var(--muted)]">{group.continent}</div>
                <div class="mt-0.5 grid gap-0.5">
                  {#each group.countries as c}
                    <button
                      onclick={() => {
                        setCountry(selectedCountry === c.code ? null : c.code);
                      }}
                      class="flex items-center justify-between rounded px-2 py-1 text-left {selectedCountry === c.code
                        ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent-soft-ink)]'
                        : 'hover:bg-[var(--surface-subtle)]'}"
                    >
                      <span class="truncate">
                        <span class="mono mr-1 text-[11px] text-[var(--muted)]">{c.code}</span>
                        {c.name}
                      </span>
                      <span class="mono flex items-center gap-1 text-[11px]">
                        {#if c.missCount > 0}
                          <span class="h-1.5 w-1.5 rounded-full bg-[var(--danger)]" title="{c.missCount} misses"></span>
                        {/if}
                        {c.learningCount === 0 && c.roundsPlayed > 0
                            ? "0·NR"
                            : c.learningCount}
                      </span>
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>

        <div>
          <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Sessions
          </div>
          <div class="mt-1.5 grid gap-1 text-xs">
            {#each wb.sessions as ses}
              <a
                href={links.session(wb.duo.id, ses.id)}
                data-testid="session-link"
                data-session-id={ses.id}
                class="rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-1.5 text-left hover:border-[var(--border-strong)]"
              >
                <div class="flex items-center justify-between">
                  <span class="font-medium">{new Date(ses.startedAt).toLocaleDateString()}</span>
                  <span
                    class="h-2 w-2 rounded-full {ses.status === 'up-to-date'
                      ? 'bg-[var(--ok)]'
                      : ses.status === 'stale'
                        ? 'bg-[var(--warn)]'
                        : 'bg-[var(--info)]'}"
                    title={ses.status}
                  ></span>
                </div>
                <div
                  class="mt-0.5 mono text-[11px] text-[var(--muted)]"
                  title="Games played in this Session. The rating change counts each Game once, toward the Session it overlaps most (a Game can belong to several Sessions)."
                >
                  {ses.gameIds.length}G · {ses.micCount} mic{ses.micCount === 1 ? "" : "s"} · {ses.ratingDelta >= 0 ? "+" : ""}{ses.ratingDelta}
                </div>
              </a>
            {/each}
          </div>
        </div>
      </aside>

      <!-- Center Workspace -->
      <main class="min-w-0 space-y-3">
        <!-- Filter & Search Command Bar -->
          <div class="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 flex flex-wrap items-center gap-2 text-xs">
            <input
              bind:this={searchInputEl}
              bind:value={searchQuery}
              placeholder="Search Learnings (/)"
              class="min-w-[200px] flex-1 rounded-lg border border-[var(--border-strong)] px-2.5 py-1.5 text-sm"
            />
            <select bind:value={kindFilter} class="rounded-lg border border-[var(--border-strong)] px-2 py-1.5">
              <option value="all">All kinds</option>
              <option value="clue">Clue</option>
              <option value="distinguisher">Distinguisher</option>
              <option value="mistake">Mistake</option>
              <option value="strategy">Strategy</option>
              <option value="study">Study item</option>
              <option value="other">Other</option>
            </select>
            <select bind:value={sortMode} class="rounded-lg border border-[var(--border-strong)] px-2 py-1.5">
              <option value="newest">Sort: Newest</option>
              <option value="hp-leaks">Sort: HP leaks</option>
            </select>
            <label class="inline-flex items-center gap-1">
              <input type="checkbox" bind:checked={showDismissed} /> Dismissed
            </label>
            <label class="inline-flex items-center gap-1">
              <input type="checkbox" bind:checked={showSuperseded} /> Superseded
            </label>
            <button
              onclick={() => {
                toggleRecall();
              }}
              class="rounded-lg border px-2.5 py-1.5 font-semibold {recallMode
                ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]'
                : 'border-[var(--border-strong)] bg-[var(--surface-subtle)] text-[var(--ink)] hover:bg-[var(--surface-hover)]'}"
            >
              Recall {recallMode ? "ON" : "OFF"} (r)
            </button>
          </div>

          <!-- Single-Country Coaching Telemetry Banner + 0-Learning Country Bridge -->
          {#if activeCountryDossier}
            <div class="rounded-xl border border-[var(--accent)]/40 bg-[var(--surface)] p-4">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 class="text-base font-bold">
                    <span class="mono mr-1.5 text-[var(--accent)]">{activeCountryDossier.code}</span>
                    {activeCountryDossier.name}
                  </h2>
                  <div class="mono mt-0.5 text-xs text-[var(--muted)]">
                    {activeCountryDossier.roundsPlayed} Rounds · Avg {activeCountryDossier.avgScore ?? "—"} · {activeCountryDossier.missCount} misses · Net {activeCountryDossier.netHpDelta >= 0 ? "+" : ""}{activeCountryDossier.netHpDelta} HP
                  </div>
                </div>
                <button
                  onclick={() => openManualModal({ country: activeCountryDossier.code })}
                  class="rounded-lg border border-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)]"
                >
                  + Add {activeCountryDossier.code} Learning
                </button>
              </div>

              {#if activeCountryClaims.length > 0}
                <div class="mt-3 space-y-1.5 border-t border-[var(--border)] pt-3">
                  <div class="flex items-center justify-between text-xs font-semibold text-[var(--muted)]">
                    <span>Knowledge bank · {activeCountryClaims.length} Claim{activeCountryClaims.length === 1 ? "" : "s"}</span>
                    <a href={links.knowledge(wb.duo.id, { country: activeCountryDossier.code })} data-testid="dossier-evidence" class="text-[var(--accent)] hover:underline">
                      Evidence →
                    </a>
                  </div>
                  {#each shownCountryClaims as claim (claim.id)}
                    <Masked block revealed={Boolean(revealedClaimIds[claim.id])}>
                      {#snippet placeholder()}
                        <button
                          type="button"
                          data-testid="claim-reveal"
                          onclick={() => (revealedClaimIds = { ...revealedClaimIds, [claim.id]: true })}
                          class="w-full rounded-lg border border-dashed border-[var(--border-strong)] px-2.5 py-1.5 text-left text-xs text-[var(--muted)]"
                        >
                          Claim hidden (Recall) · Reveal
                        </button>
                      {/snippet}
                      <ClaimCard {claim} {wb} compact revealedLearningIds={revealedIds} onSetEvidence={setClaimEvidence} />
                    </Masked>
                  {/each}
                  {#if shownCountryClaims.length < activeCountryClaims.length}
                    <button
                      type="button"
                      data-testid="country-claims-more"
                      onclick={() => (showAllCountryClaims = true)}
                      class="w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-[var(--accent)] hover:bg-[var(--surface-subtle)]"
                    >
                      Show all {activeCountryClaims.length} Claims
                    </button>
                  {/if}
                </div>
              {/if}

              {#if activeCountryDossier.learningCount === 0 && activeCountryDossier.roundIds.length > 0}
                <div class="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
                  <div class="text-xs font-semibold text-[var(--muted)]">
                    No Learnings yet — bridge from played Rounds:
                  </div>
                  {#each activeCountryDossier.roundIds as rId}
                    {@const slice = roundSource ? roundSlice(roundSource, rId) : null}
                    {#if slice}
                      <Masked block revealed={Boolean(revealedRoundIds[rId])}>
                        {#snippet placeholder()}
                          <RoundCoachingCard round={slice.round} utterances={slice.utterances} players={slice.players} recallHidden />
                          <button
                            type="button"
                            data-testid="round-reveal"
                            onclick={() => (revealedRoundIds = { ...revealedRoundIds, [rId]: true })}
                            class="mt-1 text-xs font-medium text-[var(--accent)] hover:underline"
                          >
                            Reveal this Round's speech
                          </button>
                        {/snippet}
                        <RoundCoachingCard round={slice.round} utterances={slice.utterances} players={slice.players} />
                      </Masked>
                    {/if}
                  {/each}
                </div>
              {/if}
            </div>
          {/if}

          <!-- Learnings List (grouped by Country Dossier unless flattened) -->
          {#if filteredLearnings.length === 0}
            <div class="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--muted)]">
              No Learnings match these filters.
            </div>
          {:else}
            <div class="space-y-4">
              {#each groupedLearnings as group}
                <div class="space-y-2">
                  {#if group.dossier}
                    <div class="flex items-center justify-between px-1 text-xs">
                      <button
                        onclick={() => setCountry(group.dossier!.code)}
                        class="font-bold text-[var(--ink)] hover:text-[var(--accent)]"
                      >
                        <span class="mono mr-1 text-[var(--accent)]">{group.dossier.code}</span>
                        {group.dossier.name}
                      </button>
                      <span class="mono text-[11px] text-[var(--muted)]">
                        {group.dossier.roundsPlayed}R · avg {group.dossier.avgScore ?? "—"} · {group.dossier.missCount} misses · {group.dossier.netHpDelta >= 0 ? "+" : ""}{group.dossier.netHpDelta} HP
                      </span>
                    </div>
                  {:else if !flattenDossiers && group.code === null}
                    <div class="px-1 text-xs font-bold text-[var(--muted)]">General & Tactics</div>
                  {/if}

                  {#each group.items as item}
                {@const isSelected = activeLearning?.id === item.id}
                {@const isRevealed = Boolean(revealedIds[item.id])}
                {@const gameLinks = learningGameLinks(wb, item.roundIds)}
                <div
                  data-learning-row={item.id}
                  data-selected={isSelected ? "1" : undefined}
                  class="relative rounded-xl border bg-[var(--surface)] transition-colors {isSelected
                    ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]/30'
                    : 'border-[var(--border)] hover:border-[var(--border-strong)]'}"
                >
                <button
                  type="button"
                  data-testid="learning-select"
                  onclick={() => (selectedLearningId = item.id)}
                  class="w-full cursor-pointer p-3.5 text-left"
                >
                  <div class="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span class="rounded bg-[var(--surface-subtle)] px-1.5 py-0.5 font-semibold uppercase">
                        {item.kind}
                      </span>
                      {#if item.origin === "agent"}
                        <span class="rounded bg-[var(--info-bg)] px-1.5 py-0.5 font-semibold text-[var(--info)]">Tip</span>
                      {:else if item.origin === "manual"}
                        <span class="rounded bg-[var(--manual-bg)] px-1.5 py-0.5 font-semibold text-[var(--manual)]">Manual</span>
                      {/if}
                      {#each item.countries as code}
                        <span class="mono rounded bg-[var(--badge-bg)] px-1.5 py-0.5 font-semibold text-[var(--badge-ink)]">{code}</span>
                      {/each}
                      {#if item.isDebrief}
                        <span class="rounded bg-[var(--debrief-bg)] px-1.5 py-0.5 text-[var(--debrief)]">Debrief</span>
                      {/if}
                      {#if item.isStale}
                        <span class="rounded bg-[var(--warn-bg)] px-1.5 py-0.5 text-[var(--warn)]">Stale</span>
                      {/if}
                      {#if item.status === "superseded"}
                        <span class="rounded bg-[var(--badge-bg)] px-1.5 py-0.5 text-[var(--muted)]">Superseded</span>
                      {/if}
                      {#if item.claimId && wb.claimsById[item.claimId]}
                        {@const claimStatus = wb.claimsById[item.claimId]!.status}
                        <span
                          title="Claim: {CLAIM_STATUS_META[claimStatus].hint}"
                          class="rounded px-1.5 py-0.5 {claimStatus === 'verified'
                            ? 'bg-[var(--ok-bg)] text-[var(--ok)]'
                            : claimStatus === 'disproved'
                              ? 'bg-[var(--danger-bg)] text-[var(--danger)]'
                              : claimStatus === 'disputed'
                                ? 'bg-[var(--warn-bg)] text-[var(--warn)]'
                                : 'border border-dashed border-[var(--border-strong)] text-[var(--muted)]'}"
                        >
                          {claimStatus === "speculated" ? "? " : ""}{CLAIM_STATUS_META[claimStatus].label}
                        </span>
                      {/if}
                    </div>
                    <div class="flex items-center gap-1.5 mono">
                      {#if item.worstHpDelta < 0}
                        <span class="text-[var(--danger)] font-semibold">{item.worstHpDelta} HP</span>
                      {/if}
                      {#if item.starred}<span class="text-[var(--star)]">★</span>{/if}
                      {#if item.done}<span class="text-[var(--ok)]">✓ Done</span>{/if}
                    </div>
                  </div>

                  <p class="mt-2 text-sm font-medium text-[var(--ink)]" data-answer="learning-text">
                    <Masked revealed={isRevealed} label="Reveal or press Space to show the takeaway">{item.text}</Masked>
                  </p>

                  {#if item.topics.length > 0}
                    <Masked block revealed={isRevealed} label="">
                    <div class="mt-1.5 flex flex-wrap gap-1">
                      {#each item.topics as topic}
                        <span class="rounded-full bg-[var(--surface-subtle)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
                          #{topic}
                        </span>
                      {/each}
                    </div>
                    </Masked>
                  {/if}

                </button>
                    {#if gameLinks.length > 0 || item.sessionIds.length > 0}
                      <Masked block revealed={isRevealed} label="">
                      <!-- Primary relationships inline (1b-shell): Session and Game chips; plain text until their pages ship. -->
                      <div class="-mt-2 px-3.5 pb-3 flex flex-wrap items-center gap-1 text-[11px] text-[var(--muted)]" data-testid="learning-chips">
                        {#each item.sessionIds as sid (sid)}
                          {@const ses = wb.sessions.find((x) => x.id === sid)}
                          <EntityChip
                            kind="session"
                            label={ses ? new Date(ses.startedAt).toLocaleDateString() : "Session"}
                            href={entityHref({ kind: "session", duoId: wb.duo.id, id: sid })}
                          />
                        {/each}
                        {#each gameLinks as gl (gl.game.id)}
                          <EntityChip
                            kind="game"
                            label={`vs ${gl.game.opponentTeamName ?? "Opponents"} · ${gl.rounds.map((r) => `R${r.roundNumber}`).join(", ")}`}
                            href={entityHref({ kind: "game", duoId: wb.duo.id, id: gl.game.id })}
                          />
                        {/each}
                      </div>
                      </Masked>
                    {/if}
                {#if !isRevealed}
                  <!-- Shown only while Recall masks this row (a sibling of the select control, never nested). -->
                  <span class="recall-mask-placeholder">
                    <button
                      type="button"
                      data-testid="learning-reveal"
                      onclick={() => {
                        selectedLearningId = item.id;
                        revealLearning(item.id);
                      }}
                      class="absolute right-3 bottom-3 rounded-md border border-[var(--accent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)]"
                    >
                      Reveal
                    </button>
                  </span>
                {/if}
                {#if item.claimId}
                  <!-- The Claim trigger: a sibling of the select control (never nested), opening its drawer. -->
                  <div class="px-3.5 pb-2">
                    <a
                      href={links.review(wb.duo.id, { claim: item.claimId })}
                      data-sveltekit-noscroll
                      data-testid="learning-claim"
                      class="text-[11px] font-semibold text-[var(--accent)] hover:underline">Claim</a
                    >
                  </div>
                {/if}
                </div>
                  {/each}
                </div>
              {/each}
            </div>
          {/if}

      </main>

      <!-- Right Sticky Coaching Inspector -->
      <aside class="sticky top-4 max-h-[calc(100vh-32px)] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-4">
        {#if !activeLearning}
          <p class="text-xs text-[var(--muted)]">Select a Learning to inspect its Coaching Provenance and Round context.</p>
        {:else}
          {@const primaryRound = activeLearning.roundIds[0] ? wb.roundsById[activeLearning.roundIds[0]] : null}
          {@const primaryGame = primaryRound ? wb.gamesById[primaryRound.gameId] : null}

          <div class="flex items-center gap-2 border-b border-[var(--border)] pb-2 text-xs">
            <button
              onclick={() => (inspectorTab = "provenance")}
              class="rounded-md px-2.5 py-1 font-semibold {inspectorTab === 'provenance'
                ? 'bg-[var(--accent-soft)] text-[var(--accent-soft-ink)]'
                : 'text-[var(--muted)]'}"
            >
              Coaching Provenance
            </button>
            {#if primaryGame && activeLearningRevealed}
              <button
                onclick={() => (inspectorTab = "game")}
                class="rounded-md px-2.5 py-1 font-semibold {inspectorTab === 'game'
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-soft-ink)]'
                  : 'text-[var(--muted)]'}"
              >
                Full Game ({primaryGame.roundIds.length}R)
              </button>
            {/if}
          </div>

          {#if inspectorTab === "game" && primaryGame && activeLearningRevealed}
            <div class="space-y-2">
              {#if primaryGameSlice}
                <Masked block revealed={activeItemRevealed}>
                  <GameCard
                    onSaved={refreshWorkbench}
                    game={primaryGameSlice.game}
                    rounds={primaryGameSlice.rounds}
                    highlightedRoundIds={activeLearning.roundIds}
                    revealedLearningIds={revealedIds}
                    onSelectUtterance={openUtterance}
                  />
                </Masked>
              {/if}
            </div>
          {:else}
            <div class="space-y-3" data-testid="active-learning" data-learning-id={activeLearning.id}>
              <Masked block revealed={activeItemRevealed}>
                {#snippet placeholder()}
                  <button
                    data-testid="inspector-reveal"
                    onclick={() => revealLearning(activeLearning.id)}
                    class="w-full rounded-lg bg-[var(--accent)] py-2 text-xs font-semibold text-[var(--accent-ink)]"
                  >
                    Reveal Takeaway (Space)
                  </button>
                {/snippet}
                <h3 class="text-sm font-semibold text-[var(--ink)]" data-answer="inspector-text">{activeLearning.text}</h3>
                {#if activeLearning.detail}
                  <p class="text-xs text-[var(--muted)]">{activeLearning.detail}</p>
                {/if}
                {#if activeLearning.agentNote}
                  <div class="rounded-lg bg-[var(--warn-bg)] p-2.5 text-xs text-[var(--warn)]">
                    <strong>Agent note:</strong> {activeLearning.agentNote}
                  </div>
                {/if}
              </Masked>

              <!-- Reactions -->
              <div class="flex flex-wrap gap-1.5 text-xs">
                <button
                  onclick={() => react(activeLearning.id, "star")}
                  class="rounded-md border px-2.5 py-1 {activeLearning.starred
                    ? 'border-[var(--star-border)] bg-[var(--star-bg)] font-semibold text-[var(--star)]'
                    : 'border-[var(--border-strong)] hover:bg-[var(--surface-hover)]'}"
                >
                  ★ {activeLearning.starred ? "Starred" : "Star"}
                </button>
                {#if activeLearning.kind === "study"}
                  <button
                    onclick={() => react(activeLearning.id, "done")}
                    class="rounded-md border px-2.5 py-1 {activeLearning.done
                      ? 'border-[var(--ok-border)] bg-[var(--ok-bg)] font-semibold text-[var(--ok)]'
                      : 'border-[var(--border-strong)] hover:bg-[var(--surface-hover)]'}"
                  >
                    ✓ {activeLearning.done ? "Done" : "Mark done"}
                  </button>
                {/if}
                <button
                  onclick={() => react(activeLearning.id, "dismiss")}
                  class="rounded-md border px-2.5 py-1 {activeLearning.dismissed
                    ? 'border-[var(--danger-border)] bg-[var(--danger-bg)] font-semibold text-[var(--danger)]'
                    : 'border-[var(--border-strong)] hover:bg-[var(--surface-hover)]'}"
                >
                  {activeLearning.dismissed ? "Dismissed" : "Dismiss"}
                </button>
              </div>

              {#if activeLearningClaim}
                <Masked block revealed={activeItemRevealed}>
                <div class="space-y-1">
                  <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Rests on Claim
                  </div>
                  <ClaimCard claim={activeLearningClaim} {wb} duoId={wb.duo.id} revealedLearningIds={revealedIds} onSetEvidence={setClaimEvidence} onSelectLearning={openLearning} />
                </div>
                </Masked>
              {/if}

              <!-- Two-way supersession links -->
              {#if activeLearning.supersededByLearningIds.length > 0}
                <Masked block revealed={activeItemRevealed}>
                <div class="rounded-lg bg-[var(--surface-subtle)] p-2 text-xs">
                  Superseded by newer run:
                  {#each activeLearning.supersededByLearningIds as repId}
                    <button
                      onclick={() => (selectedLearningId = repId)}
                      class="ml-1 text-[var(--accent)] underline"
                    >
                      View replacement →
                    </button>
                  {/each}
                </div>
                </Masked>
              {/if}
              {#if activeLearning.supersedesLearningIds.length > 0}
                <Masked block revealed={activeItemRevealed}>
                <div class="rounded-lg bg-[var(--surface-subtle)] p-2 text-xs">
                  Replaces:
                  {#each activeLearning.supersedesLearningIds as oldId}
                    <button
                      onclick={() => {
                        showSuperseded = true;
                        selectedLearningId = oldId;
                      }}
                      class="ml-1 text-[var(--accent)] underline"
                    >
                      View earlier →
                    </button>
                  {/each}
                </div>
                </Masked>
              {/if}

              <!-- Links back to the Sessions, Games and Rounds -->
              {#if activeLearning.sessionIds.length > 0}
                <div class="flex flex-wrap items-center gap-1.5 text-xs" data-testid="from-session">
                  <span class="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">From Session</span>
                  {#each activeLearning.sessionIds as sid (sid)}
                    {@const ses = wb.sessions.find((x) => x.id === sid)}
                    <EntityChip
                      kind="session"
                      label={ses ? sessionTitle(ses) : "Session"}
                      href={entityHref({ kind: "session", duoId: wb.duo.id, id: sid })}
                    />
                  {/each}
                </div>
              {/if}
              {#if activeLearningGames.length > 0}
                <Masked block revealed={activeItemRevealed}>
                <div class="space-y-1">
                  <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    From {activeLearningGames.length === 1 ? "Game" : "Games"}
                  </div>
                  {#each activeLearningGames as { game, rounds } (game.id)}
                    <div class="flex flex-wrap items-center gap-1.5 rounded-lg bg-[var(--surface-subtle)] p-2 text-xs" data-testid="from-game">
                      <EntityChip kind="game" label={gameTitle(game)} href={entityHref({ kind: "game", duoId: wb.duo.id, id: game.id })} />
                      {#each rounds as round (round.id)}
                        <EntityChip
                          kind="round"
                          label={roundLabel(round)}
                          href={entityHref({ kind: "round", duoId: wb.duo.id, id: round.id, gameId: round.gameId, roundNumber: round.roundNumber })}
                        />
                      {/each}
                    </div>
                  {/each}
                </div>
                </Masked>
              {/if}

              <!-- Linked Round Coaching Cards -->
              {#each activeLearning.roundIds as rId}
                {@const slice = roundSource ? roundSlice(roundSource, rId) : null}
                {#if slice}
                  <Masked block revealed={activeItemRevealed}>
                    {#snippet placeholder()}
                      <RoundCoachingCard round={slice.round} utterances={slice.utterances} players={slice.players} recallHidden />
                    {/snippet}
                    <RoundCoachingCard
                      round={slice.round}
                      utterances={slice.utterances}
                      players={slice.players}
                      onSelectUtterance={openUtterance}
                    />
                  </Masked>
                {/if}
              {/each}

              <!-- Cited Transcript Excerpt -->
              {#if activeLearning.utteranceIds.length > 0}
                <Masked block revealed={activeItemRevealed}>
                <div class="space-y-1">
                  <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Cited Speech
                  </div>
                  {#each activeLearning.utteranceIds as uId}
                    {@const u = wb.utterancesById[uId]}
                    {#if u}
                      <div class="rounded-lg bg-[var(--surface-subtle)] p-2 text-xs">
                        <button
                          type="button"
                          onclick={() => openUtterance(u.id)}
                          title="Open in Session timeline"
                          class="mono cursor-pointer text-[var(--accent)] hover:underline"
                        >
                          {primaryRound ? formatRelSec(primaryRound.startTime, u.startedAt) : new Date(u.startedAt).toISOString().slice(11, 19)}
                        </button>
                        <strong class="ml-1.5">{wb.players[u.playerId]?.displayName ?? "Player"}:</strong>
                        <UtteranceText duoId={wb.duo.id} utterance={u} editable={false} />
                      </div>
                    {/if}
                  {/each}
                </div>
                </Masked>
              {/if}

              <!-- Provenance Footer -->
              <div class="border-t border-[var(--border)] pt-2 text-[11px] text-[var(--muted)] space-y-0.5">
                {#if activeLearning.runMeta}
                  <div>
                    Source: {activeLearning.purpose} run · {activeLearning.runMeta.agent} / {activeLearning.runMeta.model} ({activeLearning.runMeta.promptVersion})
                  </div>
                {:else}
                  <div>Source: Manual Learning</div>
                {/if}
                <div>Created {new Date(activeLearning.createdAt).toLocaleString()}</div>
              </div>
            </div>
          {/if}
        {/if}
      </aside>
    </div>
  </div>

  {#if claimParam && claimDrawer?.id === claimParam}
    <ClaimDrawer
      claim={claimDrawer.payload?.claim ?? null}
      closeHref={claimCloseHref}
      revealed={Boolean(revealedClaimIds[claimParam])}
      onReveal={() => (revealedClaimIds = { ...revealedClaimIds, [claimParam!]: true })}
      card={{
        wb: claimDrawer.payload?.wb ?? wb,
        duoId: wb.duo.id,
        revealedLearningIds: revealedIds,
        onSetEvidence: setDrawerClaimEvidence,
        onSelectLearning: openLearning,
      }}
    />
  {/if}

  <ManualLearningModal
    bind:open={manualOpen}
    duoId={wb.duo.id}
    games={wb.recentGames}
    roundsById={wb.roundsById}
    prefill={manualPrefill}
    onSaved={refreshWorkbench}
  />
{/if}
