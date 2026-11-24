<script lang="ts" module>
  export interface ManualPrefill {
    utteranceIds?: string[];
    roundIds?: string[];
    country?: string;
  }
</script>

<script lang="ts">
  // The Manual Learning form (Review and the Session page's inline "+ Learning").
  import type { LearningKind } from "@geo-coach/shared";
  import type { WorkbenchGame, WorkbenchRound } from "$lib/server/workbench/view-model.js";

  let {
    open = $bindable(false),
    duoId,
    games,
    roundsById,
    prefill = {},
    onSaved,
  }: {
    open?: boolean;
    duoId: string;
    /** Games offered in the Game / Round picker, in display order. */
    games: WorkbenchGame[];
    roundsById: Record<string, WorkbenchRound>;
    prefill?: ManualPrefill;
    onSaved?: () => unknown;
  } = $props();

  let kind = $state<LearningKind>("clue");
  let text = $state("");
  let detail = $state("");
  let countries = $state("");
  let topics = $state("");
  let utteranceIds = $state<string[]>([]);
  let roundIds = $state<string[]>([]);

  // Each opening starts from the prefill.
  $effect.pre(() => {
    if (!open) return;
    kind = "clue";
    text = "";
    detail = "";
    countries = prefill.country ?? "";
    topics = "";
    utteranceIds = prefill.utteranceIds ?? [];
    roundIds = prefill.roundIds ?? [];
  });

  async function submit(e: Event) {
    e.preventDefault();
    if (!text.trim()) return;
    const res = await fetch("/api/learnings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        duoId,
        kind,
        text: text.trim(),
        detail: detail.trim() || null,
        countries: countries
          .split(/[,\s]+/)
          .map((c) => c.trim().toUpperCase())
          .filter((c) => c.length === 2),
        regions: [],
        topics: topics
          .split(/[,\s]+/)
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
        utteranceIds,
        roundIds,
      }),
    });
    if (res.ok) {
      open = false;
      await onSaved?.();
    }
  }
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4">
    <form
      onsubmit={submit}
      class="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-3 shadow-lg"
    >
      <div class="flex items-center justify-between">
        <h2 class="text-base font-semibold">Add Manual Learning</h2>
        <button type="button" onclick={() => (open = false)} class="text-xs text-[var(--muted)]">Close (Esc)</button>
      </div>

      <label class="block text-xs">
        Kind
        <select bind:value={kind} class="mt-1 w-full rounded border border-[var(--border-strong)] p-2 text-sm">
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
          bind:value={text}
          placeholder="e.g. Yellow-top bollards with a red reflector point to Bulgaria."
          class="mt-1 w-full rounded border border-[var(--border-strong)] p-2 text-sm"
        />
      </label>

      <label class="block text-xs">
        Detail (optional)
        <textarea rows="3" bind:value={detail} class="mt-1 w-full rounded border border-[var(--border-strong)] p-2 text-sm"></textarea>
      </label>

      <div class="grid grid-cols-2 gap-2">
        <label class="block text-xs">
          ISO Country Codes
          <input
            bind:value={countries}
            placeholder="BG, RO"
            class="mono mt-1 w-full rounded border border-[var(--border-strong)] p-2 text-sm"
          />
        </label>
        <label class="block text-xs">
          Topics
          <input
            bind:value={topics}
            placeholder="bollards, meta"
            class="mt-1 w-full rounded border border-[var(--border-strong)] p-2 text-sm"
          />
        </label>
      </div>

      <label class="block text-xs">
        Game / Round (optional)
        <select
          value={roundIds[0] ?? ""}
          onchange={(e) => {
            const roundId = e.currentTarget.value;
            roundIds = roundId ? [roundId] : [];
          }}
          class="mt-1 w-full rounded border border-[var(--border-strong)] p-2 text-sm"
        >
          <option value="">Not linked</option>
          {#each games as g (g.id)}
            <optgroup label="{new Date(g.startedAt).toLocaleDateString()} vs {g.opponentTeamName ?? 'Opponents'}">
              {#each g.roundIds as rId (rId)}
                {@const r = roundsById[rId]}
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
          onclick={() => (open = false)}
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
