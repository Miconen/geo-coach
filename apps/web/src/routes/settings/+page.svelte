<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { THEMES } from "@geo-coach/shared";
  import { getTheme, setTheme } from "$lib/theme.svelte.js";
  import { getDeveloperMode, setDeveloperMode } from "$lib/developer-mode.svelte.js";

  let { data } = $props();
  let scope = $state<"companion" | "mcp">("companion");
  let label = $state("My PC");
  let ttlDays = $state(90);
  let newlyIssuedToken = $state<string | null>(null);
  let hotwordsByDuo = $state<Record<string, string>>({});
  $effect(() => {
    for (const d of data.duos) {
      if (!(d.id in hotwordsByDuo)) {
        hotwordsByDuo[d.id] = d.hotwords.join("\n");
      }
    }
  });
  let feedback = $state("");

  async function issueToken(e: Event) {
    e.preventDefault();
    newlyIssuedToken = null;
    const res = await fetch("/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, label, ttlDays }),
    });
    const out = await res.json();
    if (res.ok) {
      newlyIssuedToken = out.rawToken;
      await invalidateAll();
    } else {
      feedback = out.error ?? "Failed to issue token";
    }
  }

  async function revoke(id: string) {
    await fetch(`/api/tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await invalidateAll();
  }

  async function saveHotwords(duoId: string) {
    const words = (hotwordsByDuo[duoId] ?? "")
      .split(/[\n,]+/)
      .map((w) => w.trim())
      .filter(Boolean);
    const res = await fetch(`/api/duos/${duoId}/hotwords`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hotwords: words }),
    });
    feedback = res.ok ? "Hotwords saved (Companion fetches on next Start)." : "Save failed.";
    await invalidateAll();
  }
</script>

<main class="mx-auto max-w-4xl p-6 space-y-6">
  <header class="flex items-center justify-between">
    <div>
      <a href="/" class="text-xs font-medium text-[var(--accent)] hover:underline">← Back to Workbench</a>
      <h1 class="text-xl font-semibold">Settings & Tokens</h1>
      <p class="text-xs text-[var(--muted)]">Signed in as {data.player.displayName}</p>
    </div>
    <form method="POST" action="/auth/logout">
      <button class="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface-hover)]">
        Sign out
      </button>
    </form>
  </header>

  {#if feedback}
    <div class="rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2 text-xs text-[var(--accent-soft-ink)]">
      {feedback}
    </div>
  {/if}

  <section class="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-4">
    <div>
      <h2 class="text-base font-semibold">Appearance</h2>
      <p class="text-xs text-[var(--muted)]">
        Choose a dark or light palette for this browser. The same theme set is available in the local Companion UI.
      </p>
    </div>

    <div class="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {#each THEMES as theme}
        {@const active = getTheme() === theme.id}
        <button
          type="button"
          onclick={() => setTheme(theme.id)}
          aria-pressed={active}
          class="flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors cursor-pointer {active
            ? 'border-[var(--accent)] bg-[var(--accent-soft)]/60 ring-1 ring-[var(--accent)]/40'
            : 'border-[var(--border)] bg-[var(--surface-subtle)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]'}"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-semibold text-[var(--ink)]">{theme.name}</span>
            <span class="rounded bg-[var(--badge-bg)] px-1.5 py-0.5 text-[10px] font-medium uppercase text-[var(--muted)]">
              {theme.appearance}
            </span>
          </div>
          <div class="flex items-center gap-1.5" aria-hidden="true">
            <span
              class="h-4 w-7 rounded border border-black/20"
              style="background: {theme.swatches.bg}"
            ></span>
            <span
              class="h-4 w-7 rounded border border-black/20"
              style="background: {theme.swatches.surface}"
            ></span>
            <span
              class="h-4 w-5 rounded border border-black/20"
              style="background: {theme.swatches.accent}"
            ></span>
            <span
              class="h-4 w-5 rounded border border-black/20"
              style="background: {theme.swatches.ink}"
            ></span>
          </div>
          <p class="text-[11px] leading-snug text-[var(--muted)]">{theme.description}</p>
        </button>
      {/each}
    </div>
  </section>

  <section class="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
    <div class="flex items-center justify-between gap-4">
      <div>
        <h2 id="developer-mode-heading" class="text-base font-semibold">Developer mode</h2>
        <p class="text-xs text-[var(--muted)]">
          Adds a <code class="mono">{"{ }"}</code> badge to Game and Round cards that shows the props each one
          receives. Only for this browser.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={getDeveloperMode()}
        aria-labelledby="developer-mode-heading"
        onclick={() => setDeveloperMode(!getDeveloperMode())}
        class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors {getDeveloperMode()
          ? 'border-[var(--accent)] bg-[var(--accent)]'
          : 'border-[var(--border-strong)] bg-[var(--surface-inset)]'}"
      >
        <span
          class="inline-block h-3.5 w-3.5 rounded-full shadow transition-transform {getDeveloperMode()
            ? 'translate-x-4 bg-[var(--accent-ink)]'
            : 'translate-x-0.5 bg-[var(--muted)]'}"
          aria-hidden="true"
        ></span>
      </button>
    </div>
  </section>

  <section class="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-4">
    <div>
      <h2 class="text-base font-semibold">Scoped Bearer Tokens</h2>
      <p class="text-xs text-[var(--muted)]">
        Issue separate tokens for your local <code>companion</code> uploader and remote <code>mcp</code> AI agents.
        MCP endpoint: <code class="mono">{data.origin}/mcp</code>
      </p>
    </div>

    <form onsubmit={issueToken} class="flex flex-wrap items-end gap-3">
      <label class="text-xs">
        Scope
        <select bind:value={scope} class="mt-1 block rounded border border-[var(--border-strong)] px-2 py-1.5 text-sm">
          <option value="companion">companion (audio/game upload)</option>
          <option value="mcp">mcp (AI processing runs)</option>
        </select>
      </label>
      <label class="text-xs">
        Label
        <input bind:value={label} class="mt-1 block rounded border border-[var(--border-strong)] px-2.5 py-1.5 text-sm" />
      </label>
      <label class="text-xs">
        Expires (days)
        <input type="number" bind:value={ttlDays} min="1" max="365" class="mt-1 block w-24 rounded border border-[var(--border-strong)] px-2 py-1.5 text-sm" />
      </label>
      <button type="submit" class="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] hover:opacity-95">
        Issue Token
      </button>
    </form>

    {#if newlyIssuedToken}
      <div class="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] p-3 text-xs text-[var(--warn)]">
        <div class="font-semibold">Copy this token now — it will not be shown again:</div>
        <code class="mono mt-1 block break-all rounded border border-[var(--border)] bg-[var(--surface-inset)] p-2 text-[var(--ink)]">{newlyIssuedToken}</code>
      </div>
    {/if}

    <div class="divide-y divide-[var(--border)] text-xs">
      {#each data.tokens as tok}
        <div class="flex items-center justify-between py-2.5">
          <div>
            <span class="rounded bg-[var(--surface-subtle)] px-1.5 py-0.5 font-semibold uppercase">{tok.scope}</span>
            <strong class="ml-2">{tok.label}</strong>
            <span class="mono ml-2 text-[var(--muted)]">{tok.tokenPrefix}…</span>
            <span class="ml-2 text-[var(--muted)]">
              Expires {new Date(tok.expiresAt).toLocaleDateString()}
              {#if tok.revokedAt} · <span class="text-[var(--danger)]">Revoked</span>{/if}
            </span>
          </div>
          {#if !tok.revokedAt}
            <button onclick={() => revoke(tok.id)} class="text-[var(--danger)] hover:underline">
              Revoke
            </button>
          {/if}
        </div>
      {/each}
    </div>
  </section>

  <section class="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-4">
    <div>
      <h2 class="text-base font-semibold">Duo Whisper Hotwords</h2>
      <p class="text-xs text-[var(--muted)]">
        Place names and GeoGuessr terms passed to faster-whisper's <code>hotwords</code> parameter (one per line or comma-separated).
      </p>
    </div>

    {#each data.duos as duo}
      <div class="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
        <div class="text-sm font-semibold">{duo.name}</div>
        <textarea
          rows="4"
          bind:value={hotwordsByDuo[duo.id]}
          class="mono w-full rounded border border-[var(--border-strong)] p-2 text-xs"
        ></textarea>
        <button
          onclick={() => saveHotwords(duo.id)}
          class="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-ink)] hover:opacity-95"
        >
          Save Hotwords
        </button>
      </div>
    {/each}
  </section>
</main>
