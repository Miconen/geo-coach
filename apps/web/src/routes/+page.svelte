<script lang="ts">
  import { onMount } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { getCountryName, type DuoSseEvent, type LearningKind, type ReactionType } from "@geo-coach/shared";
  import RoundCoachingCard from "$lib/components/RoundCoachingCard.svelte";
  import ThemeSwitcher from "$lib/components/ThemeSwitcher.svelte";
  import type {
    CountryDossier,
    WorkbenchLearning,
    WorkbenchUtterance,
  } from "$lib/server/workbench/view-model.js";

  let { data } = $props();
  const wb = $derived(data.workbench);

  // Navigation & filter state
  let mode = $state<"learnings" | "session" | "game">("learnings");
  let queueFilter = $state<"all" | "mistakes" | "starred" | "manual" | "stale" | "study">("all");
  let selectedCountry = $state<string | null>(null);
  let selectedPair = $state<[string, string] | null>(null);
  let selectedSessionId = $state<string | null>(null);
  let selectedGameId = $state<string | null>(null);
  let kindFilter = $state<LearningKind | "all">("all");
  let sortMode = $state<"newest" | "hp-leaks">("newest");
  let showDismissed = $state(false);
  let showSuperseded = $state(false);
  let searchQuery = $state("");
  let recallMode = $state(false);
  let revealedIds = $state<Record<string, boolean>>({});
  let inspectorTab = $state<"provenance" | "game">("provenance");
  let selectedLearningId = $state<string | null>(null);
  let selectedRoundId = $state<string | null>(null);
  let highlightedUtteranceId = $state<string | null>(null);
  let timelineSearch = $state("");

  // Live SSE heartbeat statuses
  let sseLiveStatuses = $state<typeof data.workbench extends null ? never : NonNullable<typeof data.workbench>["liveStatuses"] | null>(null);
  const liveStatuses = $derived(sseLiveStatuses ?? data.workbench?.liveStatuses ?? []);

  // Manual Learning modal
  let manualOpen = $state(false);
  let manualKind = $state<LearningKind>("clue");
  let manualText = $state("");
  let manualDetail = $state("");
  let manualCountries = $state("");
  let manualTopics = $state("");
  let manualUtteranceIds = $state<string[]>([]);
  let manualRoundIds = $state<string[]>([]);
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
      if (selectedPair) {
        const [a, b] = selectedPair;
        if (!(l.countries.includes(a) && l.countries.includes(b))) return false;
      }

      if (q) {
        const hay = [
          l.text,
          l.detail ?? "",
          l.agentNote ?? "",
          ...l.countries,
          ...l.countries.map(getCountryName),
          ...l.regions.map((r) => r.name),
          ...l.topics,
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

  const uncitedSearchHits = $derived.by(() => {
    if (!wb || !searchQuery.trim()) return [] as WorkbenchUtterance[];
    const q = searchQuery.trim().toLowerCase();
    return wb.utterances.filter(
      (u) => u.citedByLearningIds.length === 0 && u.text.toLowerCase().includes(q),
    );
  });

  const flattenDossiers = $derived(
    Boolean(selectedCountry || selectedPair || sortMode === "hp-leaks"),
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

  const activeLearning = $derived(
    wb?.learnings.find((l) => l.id === selectedLearningId) ?? filteredLearnings[0] ?? null,
  );

  const activeLearningRevealed = $derived(
    !recallMode || (activeLearning ? Boolean(revealedIds[activeLearning.id]) : false),
  );

  const activeCountryDossier = $derived(
    selectedCountry ? wb?.countryDossiers.find((c) => c.code === selectedCountry) ?? null : null,
  );

  const standaloneGame = $derived(
    mode === "game" && selectedGameId ? (wb?.gamesById[selectedGameId] ?? null) : null,
  );

  const activeSession = $derived(
    wb?.sessions.find((s) => s.id === selectedSessionId) ?? wb?.sessions[0] ?? null,
  );

  const visibleSessionRoundIds = $derived.by(() => {
    if (!wb || !activeSession) return [] as string[];
    const gIds = selectedGameId ? [selectedGameId] : activeSession.gameIds;
    return gIds.flatMap((gId) => wb.gamesById[gId]?.roundIds ?? []);
  });

  const betweenGameUtterances = $derived.by(() => {
    if (!wb || !activeSession) return [] as WorkbenchUtterance[];
    const roundUtteranceSet = new Set<string>();
    for (const gId of activeSession.gameIds) {
      for (const rId of wb.gamesById[gId]?.roundIds ?? []) {
        for (const uId of wb.roundsById[rId]?.utteranceIds ?? []) {
          roundUtteranceSet.add(uId);
        }
      }
    }
    const allSessionUs = wb.utterances.filter(
      (u) => u.sessionId === activeSession.id && !roundUtteranceSet.has(u.id),
    );
    if (!selectedGameId) return allSessionUs;
    const g = wb.gamesById[selectedGameId];
    if (!g) return [];
    const gIdx = activeSession.gameIds.indexOf(selectedGameId);
    const nextGame =
      gIdx >= 0 && gIdx + 1 < activeSession.gameIds.length
        ? wb.gamesById[activeSession.gameIds[gIdx + 1]!]
        : null;
    const postStart = Date.parse(g.endedAt);
    const postEnd = nextGame ? Date.parse(nextGame.startedAt) : Number.POSITIVE_INFINITY;
    return allSessionUs.filter((u) => {
      const ts = Date.parse(u.startedAt);
      return ts >= postStart && ts < postEnd;
    });
  });

  function openManualModal(opts: { utteranceIds?: string[]; roundIds?: string[]; country?: string } = {}) {
    manualKind = "clue";
    manualText = "";
    manualDetail = "";
    manualCountries = opts.country ?? "";
    manualTopics = "";
    manualUtteranceIds = opts.utteranceIds ?? [];
    manualRoundIds = opts.roundIds ?? [];
    manualOpen = true;
  }

  async function submitManualLearning(e: Event) {
    e.preventDefault();
    if (!wb || !manualText.trim()) return;
    const countries = manualCountries
      .split(/[,\s]+/)
      .map((c) => c.trim().toUpperCase())
      .filter((c) => c.length === 2);
    const topics = manualTopics
      .split(/[,\s]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    const res = await fetch("/api/learnings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        duoId: wb.duo.id,
        kind: manualKind,
        text: manualText.trim(),
        detail: manualDetail.trim() || null,
        countries,
        regions: [],
        topics,
        utteranceIds: manualUtteranceIds,
        roundIds: manualRoundIds,
      }),
    });
    if (res.ok) {
      manualOpen = false;
      await invalidateAll();
    }
  }

  async function react(learningId: string, reaction: ReactionType) {
    await fetch(`/api/learnings/${learningId}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reaction }),
    });
    await invalidateAll();
  }

  async function deleteUtterance(u: WorkbenchUtterance) {
    if (!wb) return;
    if (!confirm("Permanently delete this Utterance across all Transcript versions?")) return;
    await fetch(`/api/recordings/${u.recordingId}/delete-speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        duoId: wb.duo.id,
        startUtc: u.startedAt,
        endUtc: u.endedAt,
      }),
    });
    await invalidateAll();
  }

  function jumpToGame(gameId: string) {
    if (!wb) return;
    const game = wb.gamesById[gameId];
    if (!game) return;
    selectedGameId = game.id;
    // Games played while nobody recorded have no Session timeline to jump into
    if (game.sessionIds.length === 0) {
      mode = "game";
      return;
    }
    mode = "session";
    selectedSessionId = game.sessionIds[0] ?? null;
  }

  function jumpToSession(sessionId: string) {
    mode = "session";
    selectedSessionId = sessionId;
    selectedGameId = null;
  }

  function formatRelSec(baseIso: string, targetIso: string): string {
    const diffSec = Math.round((Date.parse(targetIso) - Date.parse(baseIso)) / 1000);
    const sign = diffSec < 0 ? "-" : "+";
    const abs = Math.abs(diffSec);
    const m = Math.floor(abs / 60);
    const s = String(abs % 60).padStart(2, "0");
    return `${sign}${m}:${s}`;
  }

  onMount(() => {
    let es: EventSource | null = null;
    if (wb) {
      es = new EventSource(`/api/duos/${wb.duo.id}/events`);
      es.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data) as DuoSseEvent;
          if (parsed.type === "heartbeat") {
            const others = liveStatuses.filter((s) => s.playerId !== parsed.playerId);
            sseLiveStatuses = [...others, parsed];
          } else if (parsed.type === "changed") {
            void invalidateAll();
          }
        } catch {
          // ignore malformed event
        }
      };
    }

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
        recallMode = !recallMode;
        revealedIds = {};
      } else if (e.key === " " && recallMode && activeLearning) {
        e.preventDefault();
        revealedIds = { ...revealedIds, [activeLearning.id]: true };
      } else if (e.key === "s" && activeLearning) {
        void react(activeLearning.id, "star");
      } else if ((e.key === "j" || e.key === "k") && mode === "learnings" && filteredLearnings.length > 0) {
        const idx = filteredLearnings.findIndex((l) => l.id === activeLearning?.id);
        const nextIdx =
          e.key === "j"
            ? Math.min(filteredLearnings.length - 1, idx + 1)
            : Math.max(0, idx - 1);
        selectedLearningId = filteredLearnings[nextIdx]?.id ?? null;
      } else if ((e.key === "j" || e.key === "k") && mode === "session" && visibleSessionRoundIds.length > 0) {
        const idx = visibleSessionRoundIds.indexOf(selectedRoundId ?? "");
        const nextIdx =
          e.key === "j"
            ? Math.min(visibleSessionRoundIds.length - 1, idx + 1)
            : Math.max(0, idx <= 0 ? 0 : idx - 1);
        selectedRoundId = visibleSessionRoundIds[nextIdx] ?? null;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      es?.close();
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
        <span class="text-base font-bold tracking-tight text-[var(--ink)]">{wb.duo.name}</span>

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
          <button
            onclick={() => {
              const firstPending = wb.sessions.find((s) => s.extractWorkCount > 0);
              if (firstPending) jumpToSession(firstPending.id);
            }}
            class="rounded-full bg-[var(--warn-bg)] px-2.5 py-0.5 text-xs font-semibold text-[var(--warn)] hover:opacity-90"
          >
            {wb.totalPendingRanges} range{wb.totalPendingRanges === 1 ? "" : "s"} need processing →
          </button>
        {/if}
      </div>

      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span class="hidden lg:inline text-[var(--muted)] mono">j/k nav · / search · s star · r recall</span>
        <ThemeSwitcher />
        <button
          onclick={() => openManualModal()}
          class="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-semibold text-[var(--accent-ink)] hover:opacity-95"
        >
          + Manual Learning
        </button>
        <a
          href="/settings"
          class="rounded-lg border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-2.5 py-1.5 font-medium text-[var(--ink)] hover:bg-[var(--surface-hover)]"
        >
          Settings
        </a>
        <span class="rounded-full bg-[var(--surface-subtle)] px-2.5 py-1 font-medium border border-[var(--border)]">
          {data.player.displayName}
        </span>
      </div>
    </header>

    <!-- Command Telemetry Strip: Recent Games + Confusion Pairs -->
    <section class="mt-3 grid gap-3 lg:grid-cols-[1.2fr_1fr]">
      <div class="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
        <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Recent Games
        </div>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          {#if wb.recentGames.length === 0}
            <span class="text-xs text-[var(--muted)]">No ranked Games synced yet.</span>
          {:else}
            {#each wb.recentGames.slice(0, 10) as g}
              <button
                onclick={() => jumpToGame(g.id)}
                class="mono inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:border-[var(--accent)] {g.won
                  ? 'border-[var(--ok-border)] bg-[var(--ok-bg)] text-[var(--ok)]'
                  : 'border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]'}"
              >
                <span>{g.won ? "W" : "L"}</span>
                {#if g.ratingDelta !== null}
                  <span>{g.ratingDelta >= 0 ? "+" : ""}{g.ratingDelta}</span>
                {/if}
              </button>
            {/each}
          {/if}
        </div>
      </div>

      <div class="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
        <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Confusion Pairs
        </div>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          {#if wb.confusionPairs.length === 0}
            <span class="text-xs text-[var(--muted)]">No confusion pairs yet.</span>
          {:else}
            {#each wb.confusionPairs.slice(0, 8) as pair}
              {@const active =
                selectedPair &&
                selectedPair[0] === pair.countries[0] &&
                selectedPair[1] === pair.countries[1]}
              <button
                onclick={() => {
                  mode = "learnings";
                  selectedCountry = null;
                  selectedPair = active ? null : pair.countries;
                }}
                class="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs {active
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--accent-soft-ink)]'
                  : 'border-[var(--border)] bg-[var(--surface-subtle)] hover:border-[var(--border-strong)]'}"
              >
                <span class="mono font-semibold">{pair.countries[0]} ↔ {pair.countries[1]}</span>
                {#if pair.missCount > 0}
                  <span class="mono rounded bg-[var(--danger-bg)] px-1 text-[10px] text-[var(--danger)]">
                    {pair.missCount} miss{pair.missCount === 1 ? "" : "es"}
                  </span>
                {/if}
              </button>
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
                  mode = "learnings";
                  queueFilter = key as typeof queueFilter;
                  selectedCountry = null;
                  selectedPair = null;
                }}
                class="rounded-md px-2 py-1.5 text-left {mode === 'learnings' && queueFilter === key && !selectedCountry && !selectedPair
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
            Atlas (Region → Country)
          </div>
          <div class="mt-1.5 space-y-2 text-xs">
            {#each continentsTree as group}
              <div>
                <div class="px-1 text-[11px] font-semibold text-[var(--muted)]">{group.continent}</div>
                <div class="mt-0.5 grid gap-0.5">
                  {#each group.countries as c}
                    <button
                      onclick={() => {
                        mode = "learnings";
                        selectedPair = null;
                        selectedCountry = selectedCountry === c.code ? null : c.code;
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
                        {c.learningCount === 0 && c.roundsPlayed > 0 ? "0·NR" : c.learningCount}
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
              <button
                onclick={() => jumpToSession(ses.id)}
                class="rounded-md border px-2 py-1.5 text-left {mode === 'session' && activeSession?.id === ses.id
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-[var(--border)] bg-[var(--surface-subtle)] hover:border-[var(--border-strong)]'}"
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
                <div class="mt-0.5 mono text-[11px] text-[var(--muted)]">
                  {ses.gameIds.length}G · {ses.micCount} mic{ses.micCount === 1 ? "" : "s"} · {ses.ratingDelta >= 0 ? "+" : ""}{ses.ratingDelta}
                </div>
              </button>
            {/each}
          </div>
        </div>
      </aside>

      <!-- Center Workspace -->
      <main class="min-w-0 space-y-3">
        {#if mode === "learnings"}
          <!-- Filter & Search Command Bar -->
          <div class="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 flex flex-wrap items-center gap-2 text-xs">
            <input
              bind:this={searchInputEl}
              bind:value={searchQuery}
              placeholder="Search Learnings & uncited speech (/)"
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
                recallMode = !recallMode;
                revealedIds = {};
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

              {#if activeCountryDossier.learningCount === 0 && activeCountryDossier.roundIds.length > 0}
                <div class="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
                  <div class="text-xs font-semibold text-[var(--muted)]">
                    No Learnings yet — bridge from played Rounds:
                  </div>
                  {#each activeCountryDossier.roundIds as rId}
                    {@const round = wb.roundsById[rId]}
                    {#if round}
                      <RoundCoachingCard
                        {round}
                        players={wb.players}
                        utterancesById={wb.utterancesById}
                      />
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
                        onclick={() => (selectedCountry = group.dossier!.code)}
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
                {@const isRevealed = !recallMode || Boolean(revealedIds[item.id])}
                <button
                  type="button"
                  onclick={() => {
                    selectedLearningId = item.id;
                    if (recallMode) revealedIds = { ...revealedIds, [item.id]: true };
                  }}
                  class="w-full text-left cursor-pointer rounded-xl border bg-[var(--surface)] p-3.5 transition-colors {isSelected
                    ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]/30'
                    : 'border-[var(--border)] hover:border-[var(--border-strong)]'}"
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
                    </div>
                    <div class="flex items-center gap-1.5 mono">
                      {#if item.worstHpDelta < 0}
                        <span class="text-[var(--danger)] font-semibold">{item.worstHpDelta} HP</span>
                      {/if}
                      {#if item.starred}<span class="text-[var(--star)]">★</span>{/if}
                      {#if item.done}<span class="text-[var(--ok)]">✓ Done</span>{/if}
                    </div>
                  </div>

                  <p class="mt-2 text-sm font-medium text-[var(--ink)]">
                    {#if isRevealed}
                      {item.text}
                    {:else}
                      <span class="rounded bg-[var(--badge-bg)] px-2 py-0.5 text-xs text-[var(--muted)]">
                        Click or press Space to reveal takeaway
                      </span>
                    {/if}
                  </p>

                  {#if item.topics.length > 0 && isRevealed}
                    <div class="mt-1.5 flex flex-wrap gap-1">
                      {#each item.topics as topic}
                        <span class="rounded-full bg-[var(--surface-subtle)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
                          #{topic}
                        </span>
                      {/each}
                    </div>
                  {/if}
                </button>
                  {/each}
                </div>
              {/each}
            </div>
          {/if}

          <!-- Uncited Raw Speech Search Hits -->
          {#if uncitedSearchHits.length > 0}
            <section class="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-2">
              <div class="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Uncited Raw Speech Matches ({uncitedSearchHits.length})
              </div>
              {#each ["unprocessed", "stale", "processed"] as statusKey}
                {@const hits = uncitedSearchHits.filter((u) => u.rangeStatus === statusKey)}
                {#if hits.length > 0}
                  <div class="space-y-1">
                    <div class="text-[11px] font-semibold text-[var(--muted)]">
                      {statusKey === "unprocessed"
                        ? "Unprocessed range"
                        : statusKey === "stale"
                          ? "Stale range"
                          : "Processed · not extracted"}
                    </div>
                    {#each hits as u}
                      <div class="flex items-center justify-between gap-2 rounded bg-[var(--surface-subtle)] px-2.5 py-1.5 text-xs">
                        <span>
                          <strong>{wb.players[u.playerId]?.displayName ?? "Player"}:</strong> {u.text}
                        </span>
                        <button
                          onclick={() => {
                            jumpToSession(u.sessionId);
                            highlightedUtteranceId = u.id;
                          }}
                          class="text-[var(--accent)] hover:underline whitespace-nowrap"
                        >
                          Timeline →
                        </button>
                      </div>
                    {/each}
                  </div>
                {/if}
              {/each}
            </section>
          {/if}
        {:else if standaloneGame}
          {@const g = standaloneGame}
          <!-- Game without a Session: its Rounds only, no speech -->
          <div class="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 class="text-base font-bold">
                  Game · {new Date(g.startedAt).toLocaleString()}
                </h2>
                <div class="mono text-xs text-[var(--muted)]">
                  vs {g.opponentTeamName ?? "Opponents"} · {g.won ? "Win" : "Loss"} ({g.duoRatingBefore ?? "?"} → {g.duoRatingAfter ?? "?"}) · {g.roundIds.length} Rounds
                </div>
              </div>
              <button
                onclick={() => (mode = "learnings")}
                class="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-xs font-medium"
              >
                ← Learnings
              </button>
            </div>
            <p class="text-xs text-[var(--muted)]">
              No Recording covers this Game, so there's no speech or Session to show.
            </p>
            {#each g.roundIds as rId}
              {@const round = wb.roundsById[rId]}
              {#if round}
                <RoundCoachingCard
                  {round}
                  players={wb.players}
                  utterancesById={wb.utterancesById}
                  highlighted={selectedRoundId === round.id}
                  onSelectUtterance={(id) => (highlightedUtteranceId = id)}
                />
              {/if}
            {/each}
          </div>
        {:else if activeSession}
          <!-- Session Timeline Mode -->
          <div class="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 class="text-base font-bold">
                  Session · {new Date(activeSession.startedAt).toLocaleString()}
                </h2>
                <div class="mono text-xs text-[var(--muted)]">
                  {activeSession.gameIds.length} Games · {activeSession.micCount} mic{activeSession.micCount === 1 ? "" : "s"} · {activeSession.ended ? "Ended" : "Active / recent"}
                </div>
              </div>
              <button
                onclick={() => (mode = "learnings")}
                class="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-xs font-medium"
              >
                ← Learnings
              </button>
            </div>

            <!-- Game filter pills + in-timeline search -->
            <div class="flex flex-wrap items-center gap-1.5 text-xs">
              <button
                onclick={() => (selectedGameId = null)}
                class="rounded-md border px-2.5 py-1 {selectedGameId === null
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--accent-soft-ink)]'
                  : 'border-[var(--border)]'}"
              >
                Full Session
              </button>
              {#each activeSession.gameIds as gId, i}
                {@const g = wb.gamesById[gId]}
                {#if g}
                  <button
                    onclick={() => (selectedGameId = g.id)}
                    class="mono rounded-md border px-2.5 py-1 {selectedGameId === g.id
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--accent-soft-ink)]'
                      : 'border-[var(--border)]'}"
                  >
                    Game {i + 1} ({g.won ? "W" : "L"} · {g.micCount} mic{g.micCount === 1 ? "" : "s"})
                  </button>
                {/if}
              {/each}
              <div class="ml-auto flex items-center gap-1">
                <input
                  bind:value={timelineSearch}
                  placeholder="Highlight in timeline..."
                  class="rounded border border-[var(--border-strong)] px-2 py-1 text-xs"
                />
                {#if timelineSearch}
                  <button
                    onclick={() => (timelineSearch = "")}
                    class="rounded border border-[var(--border)] px-1.5 py-1 text-[11px]"
                  >
                    Clear
                  </button>
                {/if}
              </div>
            </div>

            <!-- Pending work range banners -->
            {#each activeSession.workRanges as wr}
              <div class="rounded-lg bg-[var(--warn-bg)] px-3 py-1.5 text-xs text-[var(--warn)]">
                <strong>{wr.purpose}</strong> {wr.reason}: {new Date(wr.startUtc).toLocaleTimeString()} – {new Date(wr.endUtc).toLocaleTimeString()}
              </div>
            {/each}

            <!-- Deleted speech gaps -->
            {#each activeSession.deletedRanges as dr}
              <div class="rounded-lg border border-dashed border-[var(--border-strong)] px-3 py-1.5 text-xs text-[var(--muted)]">
                Deleted speech ({wb.players[dr.playerId]?.displayName ?? "Player"}): {new Date(dr.startUtc).toLocaleTimeString()} – {new Date(dr.endUtc).toLocaleTimeString()}
              </div>
            {/each}

            <!-- Rounds with interleaved Utterances & inline Learning pills -->
            {#each (selectedGameId ? [selectedGameId] : activeSession.gameIds) as gId}
              {@const g = wb.gamesById[gId]}
              {#if g}
                <div class="space-y-3 border-t border-[var(--border)] pt-3">
                  <div class="text-xs font-semibold text-[var(--muted)]">
                    Game vs {g.opponentTeamName ?? "Opponents"} · {g.won ? "Win" : "Loss"} ({g.duoRatingBefore ?? "?"} → {g.duoRatingAfter ?? "?"}) · {g.micCount} mic{g.micCount === 1 ? "" : "s"}
                  </div>
                  {#each g.roundIds as rId}
                    {@const round = wb.roundsById[rId]}
                    {#if round}
                      <div class="space-y-1.5">
                        <RoundCoachingCard
                          {round}
                          players={wb.players}
                          utterancesById={wb.utterancesById}
                          highlighted={selectedRoundId === round.id}
                          onSelectUtterance={(id) => (highlightedUtteranceId = id)}
                        />

                        {#if round.learningIds.length > 0}
                          <div class="flex flex-wrap gap-1.5 pl-2">
                            {#each round.learningIds as lId}
                              {@const l = wb.learnings.find((x) => x.id === lId)}
                              {#if l}
                                {@const isDebrief = round.debriefLearningIds.includes(l.id)}
                                <button
                                  onclick={() => (selectedLearningId = l.id)}
                                  class="rounded-full px-2.5 py-0.5 text-xs {isDebrief
                                    ? 'bg-[var(--debrief-bg)] text-[var(--debrief)]'
                                    : 'bg-[var(--accent-soft)] text-[var(--accent-soft-ink)]'}"
                                >
                                  {isDebrief ? "Debrief ← between-Game talk: " : `${l.kind}: `}{l.text}
                                </button>
                              {/if}
                            {/each}
                          </div>
                        {/if}

                        {#each round.utteranceIds as uId}
                          {@const u = wb.utterancesById[uId]}
                          {#if u}
                            {@const speaker = wb.players[u.playerId]}
                            {@const matchHighlight =
                              timelineSearch.trim() !== "" &&
                              u.text.toLowerCase().includes(timelineSearch.trim().toLowerCase())}
                            <div
                              class="ml-3 flex items-start justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs {highlightedUtteranceId === u.id || matchHighlight
                                ? 'bg-[var(--warn-bg)]'
                                : 'bg-[var(--surface-subtle)]'}"
                            >
                              <div>
                                <span class="mono text-[var(--muted)]">{formatRelSec(round.startTime, u.startedAt)}</span>
                                <strong
                                  class="ml-1.5"
                                  style="color: {speaker?.avatarColor
                                    ? `color-mix(in srgb, ${speaker.avatarColor}, #ffffff var(--speaker-lighten))`
                                    : 'var(--ink)'}"
                                >
                                  {speaker?.displayName ?? "Player"}:
                                </strong>
                                <span class="ml-1">{u.text}</span>
                              </div>
                              <div class="flex items-center gap-2 shrink-0">
                                <button
                                  onclick={() => openManualModal({ utteranceIds: [u.id], roundIds: [round.id], country: round.countryCode ?? undefined })}
                                  class="text-[var(--accent)] hover:underline"
                                >
                                  + Learning
                                </button>
                                {#if speaker?.isCurrentPlayer}
                                  <button
                                    onclick={() => deleteUtterance(u)}
                                    class="text-[var(--danger)] hover:underline"
                                  >
                                    Delete
                                  </button>
                                {/if}
                              </div>
                            </div>
                          {/if}
                        {/each}
                      </div>
                    {/if}
                  {/each}
                </div>
              {/if}
            {/each}

            <!-- Between-Game & Post-Game Talk -->
            {#if betweenGameUtterances.length > 0}
              <div class="space-y-1.5 border-t border-[var(--border)] pt-3">
                <div class="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {selectedGameId ? "Post-Game Debrief Talk" : "Between-Game & Session Talk"}
                </div>
                {#each betweenGameUtterances as u}
                  {@const speaker = wb.players[u.playerId]}
                  {@const matchHighlight =
                    timelineSearch.trim() !== "" &&
                    u.text.toLowerCase().includes(timelineSearch.trim().toLowerCase())}
                  <div
                    class="flex items-start justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs {highlightedUtteranceId === u.id || matchHighlight
                      ? 'bg-[var(--warn-bg)]'
                      : 'bg-[var(--surface-subtle)]'}"
                  >
                    <div>
                      <span class="mono text-[var(--muted)]">{new Date(u.startedAt).toISOString().slice(11, 19)}</span>
                      <strong
                        class="ml-1.5"
                        style="color: {speaker?.avatarColor
                          ? `color-mix(in srgb, ${speaker.avatarColor}, #ffffff var(--speaker-lighten))`
                          : 'var(--ink)'}"
                      >
                        {speaker?.displayName ?? "Player"}:
                      </strong>
                      <span class="ml-1">{u.text}</span>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <button
                        onclick={() => openManualModal({ utteranceIds: [u.id] })}
                        class="text-[var(--accent)] hover:underline"
                      >
                        + Learning
                      </button>
                      {#if speaker?.isCurrentPlayer}
                        <button
                          onclick={() => deleteUtterance(u)}
                          class="text-[var(--danger)] hover:underline"
                        >
                          Delete
                        </button>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
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
            {#if mode === "learnings" && primaryGame && activeLearningRevealed}
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
              {#each primaryGame.roundIds as rId}
                {@const r = wb.roundsById[rId]}
                {#if r}
                  <RoundCoachingCard
                    round={r}
                    players={wb.players}
                    utterancesById={wb.utterancesById}
                    highlighted={activeLearning.roundIds.includes(r.id)}
                  />
                {/if}
              {/each}
            </div>
          {:else}
            <div class="space-y-3">
              {#if activeLearningRevealed}
                <h3 class="text-sm font-semibold text-[var(--ink)]">{activeLearning.text}</h3>
                {#if activeLearning.detail}
                  <p class="text-xs text-[var(--muted)]">{activeLearning.detail}</p>
                {/if}
                {#if activeLearning.agentNote}
                  <div class="rounded-lg bg-[var(--warn-bg)] p-2.5 text-xs text-[var(--warn)]">
                    <strong>Agent note:</strong> {activeLearning.agentNote}
                  </div>
                {/if}
              {:else}
                <button
                  onclick={() => (revealedIds = { ...revealedIds, [activeLearning.id]: true })}
                  class="w-full rounded-lg bg-[var(--accent)] py-2 text-xs font-semibold text-[var(--accent-ink)]"
                >
                  Reveal Takeaway (Space)
                </button>
              {/if}

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

              <!-- Two-way supersession links -->
              {#if activeLearning.supersededByLearningIds.length > 0}
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
              {/if}
              {#if activeLearning.supersedesLearningIds.length > 0}
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
              {/if}

              <!-- Linked Round Coaching Cards -->
              {#each activeLearning.roundIds as rId}
                {@const r = wb.roundsById[rId]}
                {#if r}
                  <RoundCoachingCard
                    round={r}
                    players={wb.players}
                    utterancesById={wb.utterancesById}
                    recallHidden={!activeLearningRevealed}
                  />
                {/if}
              {/each}

              <!-- Cited Transcript Excerpt -->
              {#if activeLearning.utteranceIds.length > 0 && activeLearningRevealed}
                <div class="space-y-1">
                  <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Cited Speech
                  </div>
                  {#each activeLearning.utteranceIds as uId}
                    {@const u = wb.utterancesById[uId]}
                    {#if u}
                      <div class="rounded-lg bg-[var(--surface-subtle)] p-2 text-xs">
                        <span class="mono text-[var(--muted)]">
                          {primaryRound ? formatRelSec(primaryRound.startTime, u.startedAt) : new Date(u.startedAt).toISOString().slice(11, 19)}
                        </span>
                        <strong class="ml-1.5">{wb.players[u.playerId]?.displayName ?? "Player"}:</strong>
                        <span class="ml-1">{u.text}</span>
                      </div>
                    {/if}
                  {/each}
                </div>
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

  <!-- Manual Learning Modal -->
  {#if manualOpen}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4">
      <form
        onsubmit={submitManualLearning}
        class="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-3 shadow-lg"
      >
        <div class="flex items-center justify-between">
          <h2 class="text-base font-semibold">Add Manual Learning</h2>
          <button type="button" onclick={() => (manualOpen = false)} class="text-xs text-[var(--muted)]">
            Close (Esc)
          </button>
        </div>

        <label class="block text-xs">
          Kind
          <select bind:value={manualKind} class="mt-1 w-full rounded border border-[var(--border-strong)] p-2 text-sm">
            <option value="clue">Clue</option>
            <option value="distinguisher">Distinguisher</option>
            <option value="mistake">Mistake</option>
            <option value="strategy">Strategy</option>
            <option value="study">Study item</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label class="block text-xs">
          One-sentence takeaway
          <input
            required
            bind:value={manualText}
            placeholder="e.g. Yellow-top bollards with a red reflector point to Bulgaria."
            class="mt-1 w-full rounded border border-[var(--border-strong)] p-2 text-sm"
          />
        </label>

        <label class="block text-xs">
          Detail (optional)
          <textarea
            rows="3"
            bind:value={manualDetail}
            class="mt-1 w-full rounded border border-[var(--border-strong)] p-2 text-sm"
          ></textarea>
        </label>

        <div class="grid grid-cols-2 gap-2">
          <label class="block text-xs">
            ISO Country Codes
            <input
              bind:value={manualCountries}
              placeholder="BG, RO"
              class="mono mt-1 w-full rounded border border-[var(--border-strong)] p-2 text-sm"
            />
          </label>
          <label class="block text-xs">
            Topics
            <input
              bind:value={manualTopics}
              placeholder="bollards, meta"
              class="mt-1 w-full rounded border border-[var(--border-strong)] p-2 text-sm"
            />
          </label>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onclick={() => (manualOpen = false)}
            class="rounded-lg border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs hover:bg-[var(--surface-hover)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-[var(--accent-ink)] hover:opacity-95"
          >
            Save Manual Learning
          </button>
        </div>
      </form>
    </div>
  {/if}
{/if}
