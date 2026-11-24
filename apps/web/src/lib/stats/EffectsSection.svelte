<script lang="ts">
  // "What happens when…" on /stats: pick a condition and an outcome, see the
  // outcome when the condition holds against when it doesn't, optionally split by
  // country, Mode or Map, plus an automatic scan for strong patterns. The choice
  // lives in the URL so a finding can be bookmarked and shared.
  import { page } from "$app/state";
  import { updateQuery } from "./url-query.js";
  import {
    MIN_EFFECT_ROUNDS,
    SCAN_MIN_Z,
    applyFilter,
    compareEffect,
    effectConditions,
    effectContext,
    effectOutcomes,
    getCountryName,
    scanEffects,
    splitEffect,
    type EffectFormat,
    type EffectResult,
    type EffectSplit,
    type GameMode,
    type StatsFilter,
    type StatsPayload,
  } from "@geo-coach/shared";
  import { formatNumber, formatPercent, formatSeconds, formatSigned, unitLabel } from "./overview-text.js";
  import { MODE_LABELS } from "./players-text.js";

  let { payload, filter }: { payload: StatsPayload; filter: StatsFilter } = $props();

  const conditions = $derived(effectConditions(payload.players));
  const outcomes = $derived(effectOutcomes(payload.players));
  const ctx = $derived(effectContext(payload));
  const rounds = $derived(applyFilter(payload, filter).rounds);

  const PARAM = { when: "effWhen", outcome: "effOut", by: "effBy" } as const;
  const SPLITS: { id: EffectSplit | ""; label: string }[] = [
    { id: "", label: "No split" },
    { id: "country", label: "Per country" },
    { id: "mode", label: "Per Mode" },
    { id: "map", label: "Per Map" },
  ];

  let whenId = $state(page.url.searchParams.get(PARAM.when) ?? "");
  let outcomeId = $state(page.url.searchParams.get(PARAM.outcome) ?? "");
  let by = $state<EffectSplit | "">((page.url.searchParams.get(PARAM.by) as EffectSplit | null) ?? "");

  const condition = $derived(conditions.find((c) => c.id === whenId) ?? conditions[0]!);
  const outcome = $derived(outcomes.find((o) => o.id === outcomeId) ?? outcomes[0]!);
  const result = $derived(compareEffect(rounds, condition, outcome, ctx));
  const split = $derived(by ? splitEffect(rounds, condition, outcome, ctx, by) : []);
  const findings = $derived(scanEffects(rounds, conditions, outcomes, ctx).slice(0, 12));

  function choose(next: { when?: string; outcome?: string; by?: EffectSplit | "" }) {
    if (next.when !== undefined) whenId = next.when;
    if (next.outcome !== undefined) outcomeId = next.outcome;
    if (next.by !== undefined) by = next.by;
    updateQuery((params) => {
      params.set(PARAM.when, condition.id);
      params.set(PARAM.outcome, outcome.id);
      if (by) params.set(PARAM.by, by);
      else params.delete(PARAM.by);
    });
  }

  function value(v: number | null, format: EffectFormat): string {
    return format === "percent" ? formatPercent(v) : format === "seconds" ? formatSeconds(v) : formatNumber(v);
  }

  function diffText(v: number | null, format: EffectFormat): string {
    if (v === null) return "–";
    if (format === "percent") return `${formatSigned(v * 100)} pts`;
    if (format === "seconds") return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1)} s`;
    return formatSigned(v);
  }

  function verdict(r: EffectResult): string {
    if (r.diff === null) return "Not enough Rounds on both sides to compare.";
    if (Math.min(r.when.n, r.otherwise.n) < MIN_EFFECT_ROUNDS) {
      return `Too few Rounds to tell (fewer than ${MIN_EFFECT_ROUNDS} on one side).`;
    }
    return r.real
      ? `A real difference: ${diffText(r.diff, outcome.format)} (95% range ${diffText(r.low, outcome.format)} to ${diffText(r.high, outcome.format)}).`
      : `Within noise: ${diffText(r.diff, outcome.format)}, but anywhere from ${diffText(r.low, outcome.format)} to ${diffText(r.high, outcome.format)} is plausible.`;
  }

  function splitLabel(key: string): string {
    if (by === "country") return getCountryName(key);
    if (by === "mode") return MODE_LABELS[key as GameMode] ?? key;
    return key;
  }

  const inputClass =
    "rounded-lg border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-2 py-1 text-xs text-[var(--ink)]";
  const statValue = "text-2xl font-bold text-[var(--ink)]";
  const statLabel = "text-xs text-[var(--muted)]";
  const th = "px-2 py-1 text-right font-semibold whitespace-nowrap";
  const td = "px-2 py-1 text-right mono";
</script>

<div class="space-y-5">
  <div class="flex flex-wrap items-center gap-2 text-sm text-[var(--ink)]">
    <span class="font-bold">When</span>
    <select class={inputClass} value={condition.id} onchange={(e) => choose({ when: e.currentTarget.value })}>
      {#each conditions as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
    </select>
    <span class="font-bold">what happens to</span>
    <select class={inputClass} value={outcome.id} onchange={(e) => choose({ outcome: e.currentTarget.value })}>
      {#each outcomes as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
    </select>
    <select class={inputClass} value={by} onchange={(e) => choose({ by: e.currentTarget.value as EffectSplit | "" })}>
      {#each SPLITS as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
    </select>
  </div>

  <div class="flex flex-wrap items-end gap-x-10 gap-y-3">
    <div>
      <span class={statValue}>{value(result.when.value, outcome.format)}</span>
      <span class={statLabel}>when it holds · {unitLabel("rounds", result.when.n)}</span>
    </div>
    <div>
      <span class={statValue}>{value(result.otherwise.value, outcome.format)}</span>
      <span class={statLabel}>otherwise · {unitLabel("rounds", result.otherwise.n)}</span>
    </div>
    <div>
      <span
        class="{statValue} {result.real ? (result.diff! > 0 ? 'text-[var(--ok)]' : 'text-[var(--danger)]') : 'text-[var(--muted)]'}"
      >
        {diffText(result.diff, outcome.format)}
      </span>
      <span class={statLabel}>difference</span>
    </div>
  </div>
  <p class="border-l-4 border-[var(--accent)] pl-3 text-xs text-[var(--muted)]">
    {verdict(result)} A difference shows what goes together, not what causes it: split per country or Mode to rule out
    the obvious confounders.
  </p>

  {#if by}
    <div class="overflow-x-auto rounded-lg border border-[var(--border)]">
      <table class="w-full text-xs">
        <thead class="text-[var(--muted)]">
          <tr>
            <th class="px-2 py-1 text-left font-semibold">{{ country: "Country", mode: "Mode", map: "Map" }[by]}</th>
            <th class={th}>When</th>
            <th class={th}>Rounds</th>
            <th class={th}>Otherwise</th>
            <th class={th}>Rounds</th>
            <th class={th}>Difference</th>
          </tr>
        </thead>
        <tbody>
          {#each split as s (s.key)}
            <tr class="border-t border-[var(--border)] {s.result.real ? '' : 'text-[var(--muted)]'}">
              <td class="px-2 py-1">{splitLabel(s.key)}</td>
              <td class={td}>{value(s.result.when.value, outcome.format)}</td>
              <td class={td}>{s.result.when.n}</td>
              <td class={td}>{value(s.result.otherwise.value, outcome.format)}</td>
              <td class={td}>{s.result.otherwise.n}</td>
              <td class="{td} {s.result.real ? 'font-bold' : ''}">{diffText(s.result.diff, outcome.format)}</td>
            </tr>
          {:else}
            <tr><td class="px-2 py-2 text-[var(--muted)]" colspan="6">No group has Rounds on both sides.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="text-[11px] text-[var(--muted)]">Bold rows are clear of noise; grey rows could be chance.</p>
  {/if}

  <div class="space-y-2">
    <div class="border-l-4 border-[var(--accent)] pl-3">
      <h3 class="text-sm font-bold text-[var(--ink)]">Patterns worth a look</h3>
      <p class="text-xs text-[var(--muted)]">
        Every question above against every outcome, keeping only very strong signals (z ≥ {SCAN_MIN_Z}). With this many
        pairs some will be obvious or chance: leads to check, not findings. Click one to open it.
      </p>
    </div>
    <ul class="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
      {#each findings as f (f.condition.id + f.outcome.id)}
        <li>
          <button
            type="button"
            class="flex w-full flex-wrap items-center gap-x-2 px-2 py-1.5 text-left text-xs hover:bg-[var(--surface-hover)]"
            onclick={() => choose({ when: f.condition.id, outcome: f.outcome.id })}
          >
            <span class="text-[var(--ink)]">{f.condition.label}</span>
            <span class="text-[var(--muted)]">→ {f.outcome.label}</span>
            <span class="mono ml-auto {f.result.diff! > 0 ? 'text-[var(--ok)]' : 'text-[var(--danger)]'}">
              {value(f.result.when.value, f.outcome.format)} vs {value(f.result.otherwise.value, f.outcome.format)}
            </span>
          </button>
        </li>
      {:else}
        <li class="px-2 py-2 text-xs text-[var(--muted)]">No strong patterns in this filter.</li>
      {/each}
    </ul>
  </div>
</div>
