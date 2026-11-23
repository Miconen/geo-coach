<script lang="ts">
  import { untrack } from "svelte";

  interface Rule {
    source: string;
    replacement: string;
    countryCode: string | null;
    enabled: boolean;
    starter: boolean;
  }
  interface Occurrence {
    utteranceId: string;
    charStart: number;
    charEnd: number;
    originalText: string;
  }
  interface Suggestion {
    source: string;
    replacement: string;
    countryCode: string;
    score: number;
    count: number;
    example: string;
    occurrences: Occurrence[];
  }
  interface Edit {
    id: string;
    originalText: string;
    replacement: string;
    context: string;
  }

  const EDIT_PAGE = 100;

  let { duoId, duoName }: { duoId: string; duoName: string } = $props();

  let rules = $state<Rule[]>([]);
  let suggestions = $state<Suggestion[]>([]);
  let edits = $state<Edit[]>([]);
  let totalEdits = $state(0);
  let editLimit = $state(EDIT_PAGE);
  let loading = $state(true);
  let scanning = $state(false);
  let busy = $state(false);
  let error = $state("");
  let source = $state("");
  let replacement = $state("");
  let ruleCountry = $state("");

  async function refresh(rescan: boolean) {
    if (rescan) scanning = true;
    try {
      const res = await fetch(
        `/api/duos/${duoId}/corrections?suggestions=${rescan ? 1 : 0}&edits=${editLimit}`,
      );
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        error = out.error ?? "Could not load corrections.";
        return;
      }
      rules = out.rules;
      edits = out.edits;
      totalEdits = out.totalEdits;
      if (out.suggestions) suggestions = out.suggestions;
    } catch {
      error = "Could not reach the server.";
    } finally {
      loading = false;
      scanning = false;
    }
  }

  async function act(
    body: Record<string, unknown>,
    after: { rescan?: boolean; resolved?: Suggestion } = {},
  ): Promise<boolean> {
    if (busy) return false;
    busy = true;
    error = "";
    try {
      const res = await fetch(`/api/duos/${duoId}/corrections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        error = out.error ?? "Could not save that change.";
        return false;
      }
      if (after.resolved) suggestions = suggestions.filter((s) => s !== after.resolved);
      await refresh(after.rescan ?? false);
      return true;
    } catch {
      error = "Could not reach the server.";
      return false;
    } finally {
      busy = false;
    }
  }

  async function addRule(e: Event) {
    e.preventDefault();
    const countryCode = ruleCountry.trim() || null;
    if (await act({ action: "saveRule", source, replacement, countryCode }, { rescan: true })) {
      source = "";
      replacement = "";
      ruleCountry = "";
    }
  }

  async function loadMoreEdits() {
    editLimit += EDIT_PAGE;
    await refresh(false);
  }

  $effect(() => {
    void duoId;
    untrack(() => void refresh(true));
  });
</script>

<div class="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
  <div class="text-sm font-semibold">{duoName}</div>

  {#if error}
    <p role="alert" class="text-xs text-[var(--danger)]">{error}</p>
  {/if}

  {#if loading}
    <p class="text-xs text-[var(--muted)]">Loading corrections…</p>
  {:else}
    <div class="space-y-2">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-xs font-semibold">Suggestions ({suggestions.length})</h3>
        <button
          disabled={busy || scanning}
          onclick={() => {
            error = "";
            void refresh(true);
          }}
          class="text-xs text-[var(--accent)] hover:underline disabled:opacity-50"
        >
          {scanning ? "Scanning…" : "Rescan"}
        </button>
      </div>
      {#if suggestions.length === 0}
        <p class="text-xs text-[var(--muted)]">Nothing to review.</p>
      {/if}
      {#each suggestions as s (`${s.source}:${s.replacement}:${s.countryCode}`)}
        <div class="rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-xs">
          <div>
            <span class="mono">{s.source}</span> → <strong>{s.replacement}</strong>
            <span class="text-[var(--muted)]">
              · {s.countryCode} · seen {s.count} {s.count === 1 ? "time" : "times"}
            </span>
          </div>
          <p class="mt-1 text-[var(--muted)]">“{s.example}”</p>
          <div class="mt-2 flex flex-wrap gap-3">
            <button
              disabled={busy}
              onclick={() =>
                act(
                  { action: "saveRule", source: s.source, replacement: s.replacement, countryCode: s.countryCode },
                  { resolved: s },
                )}
              class="font-semibold text-[var(--accent)] hover:underline disabled:opacity-50"
            >
              Always in {s.countryCode}
            </button>
            <button
              disabled={busy}
              onclick={() =>
                act(
                  { action: "applyOnce", replacement: s.replacement, occurrences: s.occurrences },
                  { resolved: s },
                )}
              class="text-[var(--accent)] hover:underline disabled:opacity-50"
            >
              Fix {s.occurrences.length === 1 ? "this one" : `these ${s.occurrences.length}`}
            </button>
            <button
              disabled={busy}
              onclick={() =>
                act({ action: "dismiss", source: s.source, replacement: s.replacement }, { resolved: s })}
              class="text-[var(--muted)] hover:underline disabled:opacity-50"
            >
              Dismiss
            </button>
          </div>
        </div>
      {/each}
    </div>

    <form onsubmit={addRule} class="flex flex-wrap items-end gap-2">
      <label class="text-xs">
        Whisper hears
        <input bind:value={source} required maxlength="120" class="mt-1 block rounded border border-[var(--border-strong)] px-2 py-1 text-xs" />
      </label>
      <label class="text-xs">
        Replace with
        <input bind:value={replacement} required maxlength="120" class="mt-1 block rounded border border-[var(--border-strong)] px-2 py-1 text-xs" />
      </label>
      <label class="text-xs">
        Country (optional)
        <input
          bind:value={ruleCountry}
          maxlength="2"
          placeholder="BR"
          class="mt-1 block w-24 rounded border border-[var(--border-strong)] px-2 py-1 text-xs uppercase"
        />
      </label>
      <button type="submit" disabled={busy} class="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-ink)] hover:opacity-95 disabled:opacity-50">
        Add rule
      </button>
    </form>

    <div class="space-y-1">
      <h3 class="text-xs font-semibold">Rules ({rules.length})</h3>
      <div class="divide-y divide-[var(--border)] text-xs">
        {#each rules as r (`${r.source}:${r.countryCode ?? ""}`)}
          <div class="flex items-center justify-between gap-3 py-1.5">
            <span class={r.enabled ? "" : "text-[var(--muted)] line-through"}>
              <span class="mono">{r.source}</span> → <strong>{r.replacement}</strong>
              <span class="ml-1 text-[var(--muted)]">{r.countryCode ?? "everywhere"}</span>
              {#if r.starter}<span class="ml-1 text-[var(--muted)]">starter</span>{/if}
            </span>
            <span class="flex shrink-0 gap-3">
              <button
                disabled={busy}
                onclick={() =>
                  act(
                    {
                      action: "saveRule",
                      source: r.source,
                      replacement: r.replacement,
                      countryCode: r.countryCode,
                      enabled: !r.enabled,
                    },
                    { rescan: true },
                  )}
                class="text-[var(--accent)] hover:underline disabled:opacity-50"
              >
                {r.enabled ? "Disable" : "Enable"}
              </button>
              {#if !r.starter}
                <button
                  disabled={busy}
                  onclick={() =>
                    act({ action: "deleteRule", source: r.source, countryCode: r.countryCode }, { rescan: true })}
                  class="text-[var(--danger)] hover:underline disabled:opacity-50"
                >
                  Delete
                </button>
              {/if}
            </span>
          </div>
        {/each}
      </div>
    </div>

    {#if totalEdits > 0}
      <div class="space-y-1">
        <h3 class="text-xs font-semibold">One-off fixes ({totalEdits})</h3>
        <div class="divide-y divide-[var(--border)] text-xs">
          {#each edits as e (e.id)}
            <div class="flex items-center justify-between gap-3 py-1.5">
              <span>
                <span class="mono">{e.originalText}</span> → <strong>{e.replacement}</strong>
                <span class="ml-1 text-[var(--muted)]">“{e.context}”</span>
              </span>
              <button
                disabled={busy}
                onclick={() => act({ action: "undoEdit", editId: e.id }, { rescan: true })}
                class="shrink-0 text-[var(--danger)] hover:underline disabled:opacity-50"
              >
                Undo
              </button>
            </div>
          {/each}
        </div>
        {#if edits.length < totalEdits}
          <button
            disabled={busy}
            onclick={loadMoreEdits}
            class="text-xs text-[var(--accent)] hover:underline disabled:opacity-50"
          >
            Show more ({totalEdits - edits.length} left)
          </button>
        {/if}
      </div>
    {/if}
  {/if}
</div>
