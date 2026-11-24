<script lang="ts">
  import { onMount, tick } from "svelte";
  import { page } from "$app/state";
  import {
    getCountryName,
    type ClaimStatus,
    type EvidenceDirection,
    type LearningKind,
    type ReactionType,
  } from "@geo-coach/shared";
  import ClaimCard from "$lib/components/ClaimCard.svelte";
  import Masked from "$lib/components/Masked.svelte";
  import { recall, setRecall } from "$lib/recall.svelte.js";
  import GameCard from "$lib/components/GameCard.svelte";
  import RoundCoachingCard from "$lib/components/RoundCoachingCard.svelte";
  import RunTimeline from "$lib/components/RunTimeline.svelte";
  import UtteranceText from "$lib/components/UtteranceText.svelte";
  import { formatRelSec } from "$lib/workbench/format.js";
  import { entityHref } from "$lib/links.js";
  import { getDuoStream } from "$lib/live/context.js";
  import { getPendingWork } from "$lib/live/pending-work.svelte.js";
  import { heartbeats, needsRefresh } from "$lib/live/dependencies.js";
  import { singleFlight } from "$lib/live/single-flight.js";
  import EntityChip from "$lib/components/EntityChip.svelte";
  import {
    CLAIM_STATUSES,
    CLAIM_STATUS_META,
    countByStatus,
    filterWorkbenchClaims,
    groupClaimsByCountry,
  } from "$lib/workbench/knowledge.js";
  import { gameSlice, learningGameLinks, roundSlice } from "$lib/workbench/slices.js";
  import type {
    CountryDossier,
    WorkbenchLearning,
    WorkbenchUtterance,
  } from "$lib/server/workbench/view-model.js";

  let { data } = $props();
  let liveWorkbench = $state.raw<{
    base: typeof data.workbench;
    value: NonNullable<typeof data.workbench>;
  } | null>(null);
  const wb = $derived(
    liveWorkbench && liveWorkbench.base === data.workbench ? liveWorkbench.value : data.workbench,
  );

  // A ?run= deep link (X2) opens the SESSION pane on the run's Session, with the run pinned.
  const initialRunId = (() => data.selectedRunId ?? null)();
  const initialSessionId = (() => (initialRunId ? (data.workbench?.selectedSession?.id ?? null) : null))();

  // Navigation & filter state
  let mode = $state<"learnings" | "knowledge" | "session" | "game">(initialRunId ? "session" : "learnings");
  let queueFilter = $state<"all" | "mistakes" | "starred" | "manual" | "stale" | "study">("all");
  let selectedCountry = $state<string | null>((() => page.url.searchParams.get("country"))());
  let selectedPair = $state<[string, string] | null>(null);
  let selectedSessionId = $state<string | null>(initialSessionId);
  let selectedRunId = $state<string | null>(initialRunId);
  // Bumped on every Session switch, so a run history fetched for a Session already left is dropped.
  let sessionGeneration = 0;
  let selectedGameId = $state<string | null>(null);
  let kindFilter = $state<LearningKind | "all">("all");
  let sortMode = $state<"newest" | "hp-leaks">("newest");
  let showDismissed = $state(false);
  let showSuperseded = $state(false);
  let searchQuery = $state("");
  const recallMode = $derived(recall.on);
  let revealedIds = $state<Record<string, boolean>>({});
  // Standalone reveals (X4): a Session's timeline speech, a dossier Claim, a bridge Round's speech.
  let revealedSessionIds = $state<Record<string, boolean>>({});
  let revealedClaimIds = $state<Record<string, boolean>>({});
  let revealedRoundIds = $state<Record<string, boolean>>({});

  function toggleRecall() {
    setRecall(data.player.id, data.duo.id, !recall.on);
    revealedIds = {};
    revealedSessionIds = {};
    revealedClaimIds = {};
    revealedRoundIds = {};
  }

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
  let selectedRoundId = $state<string | null>(null);
  let highlightedUtteranceId = $state<string | null>(null);
  let timelineSearch = $state("");
  let claimStatusFilter = $state<ClaimStatus | "all">("all");
  let claimTopicFilter = $state<string | "all">("all");
  let claimSearch = $state("");

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

  const uncitedSearchHits = $derived.by(() => {
    if (!wb || !searchQuery.trim()) return [] as WorkbenchUtterance[];
    const q = searchQuery.trim().toLowerCase();
    return wb.utterances.filter(
      (u) =>
        u.citedByLearningIds.length === 0 &&
        (!recallMode || revealedSessionIds[u.sessionId]) &&
        u.text.toLowerCase().includes(q),
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

  // The Game behind the active Learning's first Round, for the Inspector's "Full Game" tab
  const primaryGameSlice = $derived.by(() => {
    const roundId = activeLearning?.roundIds[0];
    const round = roundId ? wb?.roundsById[roundId] : null;
    return wb && round ? gameSlice(wb, round.gameId) : null;
  });

  const activeLearningGames = $derived(
    wb && activeLearning ? learningGameLinks(wb, activeLearning.roundIds) : [],
  );

  const claimStatusCounts = $derived(countByStatus(wb?.claims ?? []));
  const claimTopics = $derived([...new Set((wb?.claims ?? []).flatMap((c) => c.topics))].sort());
  const claimGroups = $derived(
    groupClaimsByCountry(
      filterWorkbenchClaims(wb?.claims ?? [], {
        status: claimStatusFilter,
        topic: claimTopicFilter,
        query: claimSearch,
        country: selectedCountry,
      }),
      selectedCountry,
    ),
  );
  const activeLearningClaim = $derived(
    activeLearning?.claimId ? (wb?.claimsById[activeLearning.claimId] ?? null) : null,
  );

  const activeCountryDossier = $derived(
    selectedCountry ? wb?.countryDossiers.find((c) => c.code === selectedCountry) ?? null : null,
  );

  const activeCountryClaims = $derived(
    selectedCountry ? (wb?.claims ?? []).filter((c) => c.countries.includes(selectedCountry!)) : [],
  );

  const standaloneGame = $derived(
    mode === "game" && selectedGameId ? (wb?.gamesById[selectedGameId] ?? null) : null,
  );

  const standaloneGameSlice = $derived(wb && standaloneGame ? gameSlice(wb, standaloneGame.id) : null);

  // A Recording-less Session (no transcript, so not in wb.sessions) stays selected: the pane shows its run
  // history with an empty Transcript.
  const activeSession = $derived.by(() => {
    if (!wb) return null;
    const listed = wb.sessions.find((s) => s.id === selectedSessionId);
    if (listed) return listed;
    const sel = wb.selectedSession;
    if (sel && sel.recordingLess && sel.id === selectedSessionId) {
      return {
        id: sel.id,
        startedAt: sel.startedAt,
        endedAt: sel.startedAt,
        ended: true,
        playerIds: [],
        micCount: 0,
        gameIds: [] as string[],
        recordingIds: [] as string[],
        stoppedRecordingIds: [] as string[],
        ratingDelta: 0,
        extractWorkCount: 0,
        tipsWorkCount: 0,
        status: "up-to-date" as const,
        workRanges: [],
        deletedRanges: [],
      };
    }
    return wb.sessions[0] ?? null;
  });

  const activeRunTimeline = $derived(
    wb?.runTimeline && activeSession && wb.runTimeline.sessionId === activeSession.id ? wb.runTimeline : null,
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
      await refreshWorkbench();
    }
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
    mode = "learnings";
    selectedLearningId = learningId;
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
    await refreshWorkbench();
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
    selectSession(game.sessionIds[0] ?? null);
  }

  async function openRound(roundId: string) {
    const round = wb?.roundsById[roundId];
    if (!round) return;
    selectedRoundId = round.id;
    jumpToGame(round.gameId);
    await scrollToAnchor(`[data-round-anchor="${round.id}"]`);
  }

  async function scrollToAnchor(selector: string) {
    await tick();
    document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function focusUtterance(utteranceId: string, roundId?: string) {
    highlightedUtteranceId = utteranceId;
    const inRound = roundId ? `[data-round-anchor="${roundId}"] ` : "";
    return scrollToAnchor(`${inRound}[data-utterance-anchor="${utteranceId}"]`);
  }

  function openUtterance(utteranceId: string, roundId?: string) {
    const utterance = wb?.utterancesById[utteranceId];
    if (!wb || !utterance) return;
    const round = roundId
      ? wb.roundsById[roundId]
      : Object.values(wb.roundsById).find((r) => r.utteranceIds.includes(utteranceId));
    mode = "session";
    selectSession(utterance.sessionId);
    selectedGameId = round?.gameId ?? null;
    selectedRoundId = round?.id ?? null;
    return focusUtterance(utteranceId, round?.id);
  }

  function jumpToSession(sessionId: string) {
    mode = "session";
    selectSession(sessionId);
    selectedGameId = null;
  }

  /** Every Session selection fetches that Session's run history and clears the selected run. */
  function selectSession(sessionId: string | null) {
    if (sessionId !== selectedSessionId) sessionGeneration += 1;
    sessionMissing = false;
    selectedSessionId = sessionId;
    selectedRunId = null;
    void refreshWorkbench();
  }

  const stream = getDuoStream();
  const pendingWork = getPendingWork();
  // Worker status from the shared store (polled every 15 s while Review is mounted), else the page payload.
  const workerOnline = $derived(pendingWork?.workerOnline ?? wb?.processing.workerOnline ?? false);
  // Set when a refresh found the selected Session gone (entity-level 404 with the Duo still accessible).
  let sessionMissing = $state(false);

  // Live refresh (X5): fetch-and-overlay through /workbench, never invalidateAll (Firefox cancels its request on
  // reload and SvelteKit shows the error screen). Single-flight: a burst costs at most two fetches, in order.
  const refreshWorkbench = singleFlight(async () => {
    const base = data.workbench;
    if (!base) return;
    const generation = sessionGeneration;
    const params = new URLSearchParams();
    const sessionId = selectedSessionId ?? activeSession?.id ?? null;
    if (sessionId) params.set("sessionId", sessionId);
    if (selectedRunId) params.set("run", selectedRunId);
    try {
      const res = await fetch(`/api/duos/${base.duo.id}/workbench?${params}`);
      if (res.status === 401 || res.status === 404) {
        // 401 or a Duo-level 404 clears the Duo (the layout's probe); with ?sessionId= a 404 may be the Session.
        const probe = (await stream?.probe()) ?? "unknown";
        if (probe === "ok" && sessionId && generation === sessionGeneration) {
          sessionMissing = true;
          selectedSessionId = null;
          selectedRunId = null;
          sessionGeneration += 1;
          return true;
        }
        return;
      }
      if (!res.ok) return;
      const value = (await res.json()) as NonNullable<typeof data.workbench>;
      // A response for a Session already left is dropped; another pass fetches the new one.
      if (generation !== sessionGeneration) return true;
      if (base === data.workbench) liveWorkbench = { base, value };
    } catch {
      // Cancelled or offline: keep showing the current data until the next change.
    }
  });

  type SessionWorkRange = NonNullable<typeof wb>["sessions"][number]["workRanges"][number];

  let fixingRangeKey = $state<string | null>(null);
  let fixErrors = $state<Record<string, string>>({});

  function workRangeKey(sessionId: string, wr: SessionWorkRange) {
    return `${sessionId}:${wr.purpose}:${wr.startUtc}`;
  }

  /** The selected Session's jobs for a work range, looked up server-side (scoped, newest per chunk). */
  function workRangeJobs(sessionId: string, wr: SessionWorkRange) {
    return wb?.processing.rangeJobs[workRangeKey(sessionId, wr)] ?? { running: 0, queued: 0, failed: null };
  }

  // A committed stop wins over cached heartbeats (kept up to 90 s): stopped Recordings never count again.
  const stoppedRecordingIds = $derived(new Set(wb?.sessions.flatMap((s) => s.stoppedRecordingIds) ?? []));
  function isSessionRecording(session: { recordingIds: string[] }) {
    return liveStatuses.some(
      (s) =>
        s.recording &&
        s.recordingId !== null &&
        !stoppedRecordingIds.has(s.recordingId) &&
        session.recordingIds.includes(s.recordingId),
    );
  }

  async function fixWorkRange(sessionId: string, wr: SessionWorkRange) {
    if (!wb) return;
    const key = workRangeKey(sessionId, wr);
    fixingRangeKey = key;
    const { [key]: _cleared, ...otherErrors } = fixErrors;
    fixErrors = otherErrors;
    try {
      const res = await fetch(`/api/duos/${wb.duo.id}/processing-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          purpose: wr.purpose,
          startUtc: wr.startUtc,
          endUtc: wr.endUtc,
        }),
      });
      if (!res.ok) {
        // The worker went offline since the last poll: refetch its status at once.
        if (res.status === 503) void pendingWork?.refresh();
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        fixErrors = { ...fixErrors, [key]: body?.error ?? "Could not queue this range." };
        return;
      }
      await refreshWorkbench();
    } catch {
      fixErrors = { ...fixErrors, [key]: "Could not reach the server." };
    } finally {
      fixingRangeKey = null;
    }
  }

  onMount(() => {
    if (initialRunId) void scrollToAnchor(`#run-${initialRunId}`);
    // The layout's shared stream: heartbeats update the status pills; any change or (re)connection refreshes once.
    const stopWorkerPoll = pendingWork?.watchWorker();
    const offStream = stream?.subscribe((batch) => {
      for (const hb of heartbeats(batch)) {
        const others = liveStatuses.filter((s) => s.playerId !== hb.playerId);
        sseLiveStatuses = [...others, hb];
      }
      if (needsRefresh("review", batch)) void refreshWorkbench();
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
      offStream?.();
      stopWorkerPoll?.();
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
    {#if sessionMissing}
      <p
        role="status"
        data-testid="session-missing"
        class="mt-3 rounded-xl border border-[var(--border)] bg-[var(--warn-bg)] px-4 py-2 text-sm text-[var(--warn)]"
      >
        That Session no longer exists.
      </p>
    {/if}

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
            Knowledge Bank
          </div>
          <nav class="mt-1.5 grid gap-0.5 text-xs">
            {#each [["all", `All Claims (${wb.claims.length})`], ...CLAIM_STATUSES.map((st) => [st, `${CLAIM_STATUS_META[st].label} (${claimStatusCounts[st]})`])] as [key, label]}
              <button
                onclick={() => {
                  mode = "knowledge";
                  claimStatusFilter = key as typeof claimStatusFilter;
                  selectedPair = null;
                }}
                class="rounded-md px-2 py-1.5 text-left {mode === 'knowledge' && claimStatusFilter === key
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
                        if (mode !== "knowledge") mode = "learnings";
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
                        {mode === "knowledge"
                          ? c.claimCount
                          : c.learningCount === 0 && c.roundsPlayed > 0
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
              <button
                data-testid="session-button"
                data-session-id={ses.id}
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
                <div
                  class="mt-0.5 mono text-[11px] text-[var(--muted)]"
                  title="Games played in this Session. The rating change counts each Game once, toward the Session it overlaps most (a Game can belong to several Sessions)."
                >
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
                    <button onclick={() => (mode = "knowledge")} class="text-[var(--accent)] hover:underline">
                      Evidence →
                    </button>
                  </div>
                  {#each activeCountryClaims as claim (claim.id)}
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
                </div>
              {/if}

              {#if activeCountryDossier.learningCount === 0 && activeCountryDossier.roundIds.length > 0}
                <div class="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
                  <div class="text-xs font-semibold text-[var(--muted)]">
                    No Learnings yet — bridge from played Rounds:
                  </div>
                  {#each activeCountryDossier.roundIds as rId}
                    {@const slice = roundSlice(wb, rId)}
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

                  {#if gameLinks.length > 0 || item.sessionIds.length > 0}
                    <Masked block revealed={isRevealed} label="">
                    <!-- Primary relationships inline (1b-shell): Session and Game chips; plain text until their pages ship. -->
                    <div class="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-[var(--muted)]" data-testid="learning-chips">
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
                </button>
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
                </div>
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
                          <strong>{wb.players[u.playerId]?.displayName ?? "Player"}:</strong>
                          <UtteranceText duoId={wb.duo.id} utterance={u} editable={false} />
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
        {:else if mode === "knowledge"}
          <!-- Knowledge bank: Claims by country, with their Evidence, and the Duo's Sources -->
          <div class="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 flex flex-wrap items-center gap-2 text-xs">
            <input
              bind:value={claimSearch}
              placeholder="Search Claims"
              class="min-w-[200px] flex-1 rounded-lg border border-[var(--border-strong)] px-2.5 py-1.5 text-sm"
            />
            <select bind:value={claimStatusFilter} class="rounded-lg border border-[var(--border-strong)] px-2 py-1.5">
              <option value="all">All statuses</option>
              {#each CLAIM_STATUSES as st}
                <option value={st}>{CLAIM_STATUS_META[st].label}</option>
              {/each}
            </select>
            <select bind:value={claimTopicFilter} class="rounded-lg border border-[var(--border-strong)] px-2 py-1.5">
              <option value="all">All topics</option>
              {#each claimTopics as topic}
                <option value={topic}>#{topic}</option>
              {/each}
            </select>
            {#if selectedCountry}
              <button
                onclick={() => (selectedCountry = null)}
                class="rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] px-2.5 py-1.5 font-semibold text-[var(--accent-soft-ink)]"
              >
                {selectedCountry} ✕
              </button>
            {/if}
            <button
              onclick={() => (mode = "learnings")}
              class="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 font-medium"
            >
              ← Learnings
            </button>
          </div>

          <p class="px-1 text-[11px] text-[var(--muted)]">
            A Claim's status comes only from its Evidence: Rounds whose location confirms it, your ✓/✗, and Source sections.
            Unconfirmed Claims are guesses, not facts.
          </p>

          {#if claimGroups.length === 0}
            <div class="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--muted)]">
              {wb.claims.length === 0
                ? "No Claims yet. Processing runs and ingested Sources add them."
                : "No Claims match these filters."}
            </div>
          {:else}
            <div class="space-y-4">
              {#each claimGroups as group (group.code ?? "general")}
                <div class="space-y-2">
                  <div class="px-1 text-xs font-bold">
                    {#if group.code}
                      <span class="mono mr-1 text-[var(--accent)]">{group.code}</span>
                    {/if}
                    {group.name}
                    <span class="mono ml-1 font-normal text-[var(--muted)]">{group.claims.length}</span>
                  </div>
                  {#each group.claims as claim (claim.id)}
                    <ClaimCard {claim} {wb} revealedLearningIds={revealedIds} onSetEvidence={setClaimEvidence} onSelectLearning={openLearning} />
                  {/each}
                </div>
              {/each}
            </div>
          {/if}

          <section class="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-2">
            <div class="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Sources ({wb.sources.length})
            </div>
            {#if wb.sources.length === 0}
              <p class="text-xs text-[var(--muted)]">
                No Sources yet. Hand an agent a Plonkit page or guide and ask it to ingest it.
              </p>
            {/if}
            {#each wb.sources as src (src.id)}
              <div class="flex flex-wrap items-center justify-between gap-2 rounded bg-[var(--surface-subtle)] px-2.5 py-1.5 text-xs">
                <span class="min-w-0 truncate">
                  <span class="rounded bg-[var(--badge-bg)] px-1 text-[10px] uppercase text-[var(--badge-ink)]">{src.kind}</span>
                  {#if src.url}
                    <a href={src.url} target="_blank" rel="noopener noreferrer" class="ml-1 font-medium hover:underline">{src.title}</a>
                  {:else}
                    <span class="ml-1 font-medium">{src.title}</span>
                  {/if}
                </span>
                <span class="mono text-[11px] text-[var(--muted)]">
                  v{src.latestVersionNo} · {new Date(src.updatedAt).toLocaleDateString()} · {src.sectionCount} sections · {src.imageCount} images
                </span>
              </div>
            {/each}
          </section>
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
            {#if standaloneGameSlice}
              <GameCard
                onSaved={refreshWorkbench}
                game={standaloneGameSlice.game}
                rounds={standaloneGameSlice.rounds}
                highlightedRoundIds={selectedRoundId ? [selectedRoundId] : []}
                onSelectUtterance={(id) => (highlightedUtteranceId = id)}
              />
            {/if}
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

            {#if activeRunTimeline}
              <RunTimeline
                timeline={activeRunTimeline}
                duoId={wb.duo.id}
                playerName={(id) => (id ? (wb.players[id]?.displayName ?? "Player") : "Player")}
              />
            {/if}

            <!-- Pending work range banners -->
            {#each activeSession.workRanges as wr}
              {@const key = workRangeKey(activeSession.id, wr)}
              {@const jobs = workRangeJobs(activeSession.id, wr)}
              {@const active = jobs.running + jobs.queued > 0}
              {@const recording = isSessionRecording(activeSession)}
              <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--warn-bg)] px-3 py-1.5 text-xs text-[var(--warn)]">
                <div class="min-w-0">
                  <div>
                    <strong>{wr.purpose}</strong> {wr.reason}: {new Date(wr.startUtc).toLocaleTimeString()} – {new Date(wr.endUtc).toLocaleTimeString()}
                  </div>
                  {#each wr.causes as cause}
                    <div class="opacity-80">{cause.playerName}'s Recording: {cause.summary}</div>
                  {/each}
                  {#if wr.lastRun}
                    <div class="opacity-80">
                      Last processed by {wr.lastRun.playerName} with {wr.lastRun.model}{wr.lastRun.finishedAt ? ` at ${new Date(wr.lastRun.finishedAt).toLocaleTimeString()}` : ""}
                    </div>
                  {/if}
                  {#if fixErrors[key] || (jobs.failed && !active)}
                    <div class="font-semibold" role="alert">{fixErrors[key] ?? jobs.failed}</div>
                  {/if}
                </div>
                <button
                  type="button"
                  class="shrink-0 rounded-md bg-[var(--warn)] px-2.5 py-1 font-semibold text-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={active || recording || fixingRangeKey === key || !workerOnline}
                  data-testid="work-range-action"
                  title={!workerOnline
                    ? "The processing worker is offline"
                    : recording
                      ? "Stop recording before processing this Session"
                      : undefined}
                  onclick={() => fixWorkRange(activeSession.id, wr)}
                >
                  {#if jobs.running > 0}
                    Processing…
                  {:else if jobs.queued > 0}
                    Queued
                  {:else if !workerOnline}
                    Worker offline
                  {:else if jobs.failed}
                    Retry
                  {:else if wr.reason === "stale"}
                    Fix
                  {:else}
                    Process
                  {/if}
                </button>
              </div>
            {/each}

            <!-- Deleted speech gaps -->
            {#each activeSession.deletedRanges as dr}
              <div class="rounded-lg border border-dashed border-[var(--border-strong)] px-3 py-1.5 text-xs text-[var(--muted)]">
                Deleted speech ({wb.players[dr.playerId]?.displayName ?? "Player"}): {new Date(dr.startUtc).toLocaleTimeString()} – {new Date(dr.endUtc).toLocaleTimeString()}
              </div>
            {/each}

            <Masked block revealed={Boolean(revealedSessionIds[activeSession.id])}>
            {#snippet placeholder()}
              <button
                type="button"
                data-testid="session-reveal"
                onclick={() => (revealedSessionIds = { ...revealedSessionIds, [activeSession.id]: true })}
                class="w-full rounded-lg border border-dashed border-[var(--border-strong)] py-3 text-xs font-semibold text-[var(--accent)]"
              >
                Recall is on: reveal this Session's Games and speech
              </button>
            {/snippet}
            <!-- Rounds with interleaved Utterances & inline Learning pills -->
            {#each (selectedGameId ? [selectedGameId] : activeSession.gameIds) as gId}
              {@const slice = gameSlice(wb, gId)}
              {#if slice}
                <GameCard
                  onSaved={refreshWorkbench}
                  duoId={wb.duo.id}
                  game={slice.game}
                  rounds={slice.rounds}
                  learnings={slice.learnings}
                  timeline
                  highlightedRoundIds={selectedRoundId ? [selectedRoundId] : []}
                  {highlightedUtteranceId}
                  {timelineSearch}
                  onSelectUtterance={focusUtterance}
                  onSelectLearning={(id) => (selectedLearningId = id)}
                  revealedLearningIds={revealedIds}
                  onAddLearning={openManualModal}
                  onDeleteUtterance={deleteUtterance}
                />
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
                    data-utterance-anchor={u.id}
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
                      <UtteranceText duoId={wb.duo.id} utterance={u} onSaved={refreshWorkbench} />
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
            </Masked>
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
                  <ClaimCard claim={activeLearningClaim} {wb} revealedLearningIds={revealedIds} onSetEvidence={setClaimEvidence} />
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

              <!-- Links back to the Games and Rounds -->
              {#if activeLearningGames.length > 0}
                <Masked block revealed={activeItemRevealed}>
                <div class="space-y-1">
                  <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    From {activeLearningGames.length === 1 ? "Game" : "Games"}
                  </div>
                  {#each activeLearningGames as { game, rounds } (game.id)}
                    <div class="flex flex-wrap items-center gap-1.5 rounded-lg bg-[var(--surface-subtle)] p-2 text-xs">
                      <button
                        onclick={() => {
                          selectedRoundId = null;
                          jumpToGame(game.id);
                        }}
                        class="font-medium text-[var(--accent)] hover:underline"
                      >
                        vs {game.opponentTeamName ?? "Opponents"} · {new Date(game.startedAt).toLocaleDateString()}
                      </button>
                      {#each rounds as round (round.id)}
                        <button
                          onclick={() => openRound(round.id)}
                          class="mono rounded border border-[var(--border-strong)] px-1.5 py-0.5 hover:bg-[var(--surface-hover)]"
                        >
                          R{round.roundNumber}{round.countryCode ? ` ${round.countryCode}` : ""}
                        </button>
                      {/each}
                    </div>
                  {/each}
                </div>
                </Masked>
              {/if}

              <!-- Linked Round Coaching Cards -->
              {#each activeLearning.roundIds as rId}
                {@const slice = roundSlice(wb, rId)}
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

        <label class="block text-xs">
          Game / Round (optional)
          <select
            value={manualRoundIds[0] ?? ""}
            onchange={(e) => {
              const roundId = e.currentTarget.value;
              manualRoundIds = roundId ? [roundId] : [];
            }}
            class="mt-1 w-full rounded border border-[var(--border-strong)] p-2 text-sm"
          >
            <option value="">Not linked</option>
            {#each wb.recentGames as g (g.id)}
              <optgroup label="{new Date(g.startedAt).toLocaleDateString()} vs {g.opponentTeamName ?? 'Opponents'}">
                {#each g.roundIds as rId (rId)}
                  {@const r = wb.roundsById[rId]}
                  {#if r}
                    <option value={r.id}>R{r.roundNumber}{r.countryCode ? ` · ${r.countryCode}` : ""}</option>
                  {/if}
                {/each}
              </optgroup>
            {/each}
          </select>
        </label>

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
