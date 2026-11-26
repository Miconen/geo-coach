<script lang="ts">
  // Duo chrome (#56 1b-shell): breadcrumb and where-am-I, section nav, Duo switcher, pending-work badge.
  // Children are keyed by Duo, so switching Duos never reuses one Duo's page state for another.
  import { onMount, untrack } from "svelte";
  import { afterNavigate, beforeNavigate, goto } from "$app/navigation";
  import { page } from "$app/state";
  import ThemeSwitcher from "$lib/components/ThemeSwitcher.svelte";
  import { followHash } from "$lib/anchors.js";
  import { DUO_SECTIONS, duoSection } from "$lib/duo-sections.js";
  import { links } from "$lib/links.js";
  import { setDuoStream } from "$lib/live/context.js";
  import { needsRefresh } from "$lib/live/dependencies.js";
  import { browserStreamDeps, DuoStream, type StreamStatus } from "$lib/live/duo-stream.js";
  import { clearRecallAttribute, syncRecall } from "$lib/recall.svelte.js";
  import { PendingWorkStore, setPendingWork } from "$lib/live/pending-work.svelte.js";
  import SharedMapHost from "$lib/map/SharedMapHost.svelte";
  import { SharedMap, setSharedMap } from "$lib/map/shared-map.svelte.js";

  let { data, children } = $props();
  // One Mapbox map per tab (#78), shared by every Duo page: pages slot it in and publish a scene.
  const sharedMap = new SharedMap();
  setSharedMap(sharedMap);
  const duoId = $derived(data.duo.id);

  // Recall (X4): the stored preference for this Player and Duo, applied before the keyed children render.
  $effect.pre(() => syncRecall(data.player.id, duoId));

  // One event stream per tab (X5), shared by every Duo page through context; it follows Duo switches.
  const stream = new DuoStream(untrack(() => data.duo.id), browserStreamDeps());
  setDuoStream(stream);
  let streamStatus = $state<StreamStatus>("idle");
  $effect(() => stream.switchDuo(duoId, untrack(() => data.servedAt)));
  // Events that arrive during a navigation are held and delivered once it commits (or fails).
  beforeNavigate((nav) => {
    if (nav.willUnload) return;
    stream.beginNavigation();
    nav.complete.then(
      () => stream.endNavigation(),
      () => stream.endNavigation(),
    );
  });
  onMount(() => {
    const offStatus = stream.onStatus((s) => (streamStatus = s));
    // The badge refetches on a catch-up (a change since the page was served, or a reconnect) and Session or run events.
    const offBatch = stream.subscribe((batch) => {
      if (needsRefresh("pending-work", batch)) void pendingWork.refresh();
    });
    stream.start(data.servedAt);
    return () => {
      offStatus();
      offBatch();
      stream.dispose();
      pendingWork.dispose();
      clearRecallAttribute();
    };
  });

  // Id anchors (#73): a URL's #round-…, #learning-… or section anchor scrolls to and highlights its element, on a
  // cold load, after a link navigation and on a hash change. An element that renders late gets two retries.
  function followLocationHash() {
    const hash = location.hash;
    if (!hash || followHash(hash)) return;
    for (const ms of [250, 1000]) setTimeout(() => location.hash === hash && followHash(hash), ms);
  }
  afterNavigate((nav) => {
    if (nav.type !== "popstate") followLocationHash();
  });
  onMount(() => {
    window.addEventListener("hashchange", followLocationHash);
    return () => window.removeEventListener("hashchange", followLocationHash);
  });

  // Entity pages add their own crumbs below the section (the parent first, then the page itself).
  const crumbs = $derived((page.data.crumbs ?? []) as Array<{ label: string; href?: string }>);
  // The nav highlights the section (#75); the breadcrumb already starts at Home, so it names only the others.
  const section = $derived(duoSection(page.route.id));
  const current = $derived(section?.key === "home" ? null : section);

  // Pending extract ranges and worker status, fetched lazily (never part of the layout load).
  const pendingWork = new PendingWorkStore(
    untrack(() => data.duo.id),
    () => void stream.probe(),
  );
  setPendingWork(pendingWork);
  const pending = $derived(pendingWork.extractCount);
  $effect(() => pendingWork.setDuo(duoId));
  onMount(() => void pendingWork.refresh());

  function switchDuo(id: string) {
    if (id !== duoId) void goto(current ? current.href(id) : links.duo(id));
  }
</script>

{#if streamStatus === "revoked"}
  <!-- Revoked (X5): the Duo's data is cleared, not kept on screen. -->
  <main class="mx-auto max-w-xl space-y-3 px-4 py-16 text-center" data-testid="duo-revoked">
    {#if stream.revokedBy === "signed-out"}
      <h1 class="text-xl font-bold">You were signed out</h1>
      <a class="text-sm font-medium text-[var(--accent)] hover:underline" href={links.login(page.url.pathname + page.url.search)}>Sign in again</a>
    {:else}
      <h1 class="text-xl font-bold">You no longer have access to this Duo</h1>
      <a class="text-sm font-medium text-[var(--accent)] hover:underline" href="/">Go home</a>
    {/if}
  </main>
{:else}
  <div class="mx-auto max-w-[2320px] px-[clamp(16px,3vw,64px)] pt-3">
    <nav
      aria-label="Duo"
      data-stream={streamStatus}
      class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs"
    >
      <ol class="flex flex-wrap items-center gap-1.5" aria-label="Breadcrumb" data-testid="breadcrumb">
        <li><a class="font-semibold text-[var(--ink)] hover:underline" href={links.duo(duoId)} data-testid="crumb-duo">{data.duo.name}</a></li>
        {#if current}
          <li aria-hidden="true" class="text-[var(--muted)]">›</li>
          {#if crumbs.length > 0}
            <li><a class="text-[var(--muted)] hover:text-[var(--ink)] hover:underline" href={current.href(duoId)}>{current.label}</a></li>
          {:else}
            <li aria-current="page" class="text-[var(--muted)]">{current.label}</li>
          {/if}
          {#each crumbs as c, i (i)}
            <li aria-hidden="true" class="text-[var(--muted)]">›</li>
            {#if c.href && i < crumbs.length - 1}
              <li><a class="text-[var(--muted)] hover:text-[var(--ink)] hover:underline" href={c.href}>{c.label}</a></li>
            {:else}
              <li aria-current="page" class="text-[var(--muted)]">{c.label}</li>
            {/if}
          {/each}
        {/if}
      </ol>
      <div class="flex flex-wrap items-center gap-1.5">
        {#each DUO_SECTIONS as s}
          <a
            href={s.href(duoId)}
            data-testid="section-{s.key}"
            aria-current={section?.key === s.key ? "page" : undefined}
            class="rounded-lg px-2.5 py-1 font-medium {section?.key === s.key
              ? 'bg-[var(--accent-soft)] text-[var(--accent-soft-ink)]'
              : 'text-[var(--ink)] hover:bg-[var(--surface-hover)]'}">{s.label}</a
          >
        {/each}
        {#if pending}
          <a
            href={links.review(duoId)}
            data-testid="pending-work"
            class="rounded-full bg-[var(--warn-bg)] px-2.5 py-0.5 font-semibold text-[var(--warn)]"
            >{pending} range{pending === 1 ? "" : "s"} to process</a
          >
        {/if}
        {#if data.duos.length > 1}
          <label class="flex items-center gap-1 text-[var(--muted)]">
            <span class="sr-only">Duo</span>
            <select
              class="rounded-lg border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-2 py-1 text-[var(--ink)]"
              value={duoId}
              onchange={(e) => switchDuo(e.currentTarget.value)}
            >
              {#each data.duos as d}
                <option value={d.id}>{d.name}</option>
              {/each}
            </select>
          </label>
        {/if}
        <a href={links.settings()} class="rounded-lg px-2.5 py-1 font-medium text-[var(--ink)] hover:bg-[var(--surface-hover)]"
          >Settings</a
        >
        <ThemeSwitcher />
        <span class="rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-2.5 py-1 font-medium">
          {data.player.displayName}
        </span>
      </div>
    </nav>
  </div>

  {#key duoId}
    {@render children()}
  {/key}
{/if}
<SharedMapHost map={sharedMap} />
