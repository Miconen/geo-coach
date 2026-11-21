<script lang="ts">
  import { THEMES, resolveThemeId } from "@geo-coach/shared";
  import { getTheme, setTheme } from "$lib/theme.svelte.js";

  const darkThemes = THEMES.filter((t) => t.appearance === "dark");
  const lightThemes = THEMES.filter((t) => t.appearance === "light");
  const active = $derived(THEMES.find((t) => t.id === getTheme()) ?? THEMES[0]!);
</script>

<label
  class="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-2 py-1 text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface-hover)]"
  title="Color theme"
>
  <span
    class="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--border-strong)]"
    style="background: {active.swatches.accent}"
    aria-hidden="true"
  ></span>
  <select
    aria-label="Color theme"
    value={getTheme()}
    onchange={(e) => setTheme(resolveThemeId(e.currentTarget.value))}
    class="cursor-pointer bg-transparent pr-1 text-xs font-medium text-[var(--ink)] focus:outline-none"
  >
    <optgroup label="Dark themes">
      {#each darkThemes as t}
        <option value={t.id}>{t.name}</option>
      {/each}
    </optgroup>
    <optgroup label="Light themes">
      {#each lightThemes as t}
        <option value={t.id}>{t.name}</option>
      {/each}
    </optgroup>
  </select>
</label>
