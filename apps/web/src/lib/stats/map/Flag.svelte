<script lang="ts">
  // A country's flag. GeoGuessr-style cards show one beside every country name.
  import { getCountryName } from "@geo-coach/shared";

  let { code, size = "md" }: { code: string | null | undefined; size?: "sm" | "md" } = $props();

  const lower = $derived(code?.toLowerCase() ?? null);
</script>

{#if lower && /^[a-z]{2}$/.test(lower)}
  <img
    src="https://flagcdn.com/w40/{lower}.png"
    alt=""
    title={getCountryName(lower.toUpperCase())}
    class="shrink-0 rounded-sm {size === 'sm' ? 'h-3' : 'h-4'}"
    loading="lazy"
  />
{/if}
