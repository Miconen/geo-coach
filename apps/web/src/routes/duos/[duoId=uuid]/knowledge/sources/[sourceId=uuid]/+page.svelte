<script lang="ts">
  // A Source (#56 3a): one pinned excerpt (?section=), never a reader, and the version's section list. Excerpts are
  // reference text and stay unmasked (X4); reload-only (no live refresh).
  import { links } from "$lib/links.js";

  let { data } = $props();
  const v = $derived(data.view);
  const duoId = $derived(data.duo.id);
</script>

<svelte:head><title>{v.source.title} · {data.duo.name}</title></svelte:head>

<main class="mx-auto max-w-[1000px] space-y-3 px-[clamp(16px,3vw,64px)] py-4">
  <header class="space-y-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
    <h1 class="text-base font-bold tracking-tight">{v.source.title}</h1>
    <div class="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]" data-testid="source-version">
      <span class="rounded bg-[var(--badge-bg)] px-1 text-[10px] uppercase text-[var(--badge-ink)]">{v.source.kind}</span>
      <span class="mono">v{v.version.versionNo} · {new Date(v.version.createdAt).toLocaleDateString()}</span>
      {#if !v.version.current}
        <a class="text-[var(--accent)] hover:underline" href={links.source(duoId, v.source.id)}>Current is v{v.latestVersionNo}</a>
      {/if}
      {#if v.source.url}<a href={v.source.url} target="_blank" rel="noopener noreferrer" class="hover:underline">original ↗</a>{/if}
    </div>
  </header>

  {#if v.excerpt}
    <article id={v.excerpt.anchor} class="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm" data-testid="source-excerpt">
      <h2 class="font-semibold">{v.excerpt.heading}</h2>
      {#each v.excerpt.blocks as block, i (i)}
        {#if block.kind === "code"}
          <pre class="overflow-x-auto rounded bg-[var(--surface-subtle)] px-3 py-2 text-xs"><code>{block.text}</code></pre>
        {:else}
          <p class="whitespace-pre-line">
            {#each block.parts as part, j (j)}{#if "img" in part}<img
                  src={part.img.src}
                  alt={part.img.alt}
                  title={part.img.title ?? undefined}
                  data-testid="excerpt-image"
                  class="my-1 inline-block max-h-64 max-w-full rounded border border-[var(--border)]"
                />{:else}{part.text}{/if}{/each}
          </p>
        {/if}
      {/each}
    </article>
  {:else if v.sectionMissing}
    <p role="status" data-testid="section-missing" class="rounded-xl bg-[var(--warn-bg)] px-4 py-2 text-sm text-[var(--warn)]">
      That section is not in this version. Pick one below.
    </p>
  {/if}

  <nav aria-label="Sections" class="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-xs" data-testid="source-sections">
    <h2 class="mb-1 font-semibold uppercase tracking-wide text-[var(--muted)]">Sections</h2>
    <ul class="space-y-0.5">
      {#each v.sections as s (s.anchor)}
        <li style="padding-left: {Math.max(0, s.level - 1) * 12}px">
          <a
            href={links.source(duoId, v.source.id, { v: v.version.versionNo, section: s.anchor })}
            class="hover:underline {v.excerpt?.anchor === s.anchor ? 'font-semibold text-[var(--ink)]' : 'text-[var(--accent)]'}">{s.heading}</a
          >
        </li>
      {/each}
    </ul>
  </nav>
</main>
