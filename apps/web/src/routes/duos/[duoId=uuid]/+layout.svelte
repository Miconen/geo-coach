<script lang="ts">
  // Duo chrome (#56 1b-shell): breadcrumb and where-am-I, section nav, Duo switcher, pending-work badge.
  // Children are keyed by Duo, so switching Duos never reuses one Duo's page state for another.
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import ThemeSwitcher from "$lib/components/ThemeSwitcher.svelte";
  import { links } from "$lib/links.js";

  let { data, children } = $props();
  const duoId = $derived(data.duo.id);

  const SECTIONS = [
    { key: "review", label: "Review", href: (id: string) => links.review(id) },
    { key: "stats", label: "Stats", href: (id: string) => links.stats(id) },
  ] as const;
  const current = $derived(SECTIONS.find((s) => page.route.id?.startsWith(`/duos/[duoId=uuid]/${s.key}`)) ?? null);

  // Pending extract ranges, fetched lazily (never part of the layout load).
  let pending = $state<number | null>(null);
  $effect(() => {
    const id = duoId;
    pending = null;
    fetch(`/api/duos/${id}/pending-work`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { ranges: Array<{ purpose: string; count: number }> } | null) => {
        if (!body || id !== duoId) return;
        pending = body.ranges.filter((r) => r.purpose === "extract").reduce((sum, r) => sum + r.count, 0);
      })
      .catch(() => {});
  });

  function switchDuo(id: string) {
    if (id !== duoId) void goto(current ? current.href(id) : links.duo(id));
  }
</script>

<div class="mx-auto max-w-[2320px] px-[clamp(16px,3vw,64px)] pt-3">
  <nav
    aria-label="Duo"
    class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs"
  >
    <ol class="flex flex-wrap items-center gap-1.5" aria-label="Breadcrumb" data-testid="breadcrumb">
      <li class="font-semibold text-[var(--ink)]">{data.duo.name}</li>
      {#if current}
        <li aria-hidden="true" class="text-[var(--muted)]">›</li>
        <li aria-current="page" class="text-[var(--muted)]">{current.label}</li>
      {/if}
    </ol>
    <div class="flex flex-wrap items-center gap-1.5">
      {#each SECTIONS as s}
        <a
          href={s.href(duoId)}
          aria-current={current?.key === s.key ? "page" : undefined}
          class="rounded-lg px-2.5 py-1 font-medium {current?.key === s.key
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
