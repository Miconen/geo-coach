<script lang="ts">
  // A Round's Damage, signed and coloured: + dealt (green), − taken (red).
  import { signed } from "./view.js";
  let { hp }: { hp: number } = $props();
</script>

<span class="tabular-nums font-semibold {hp > 0 ? 'text-[var(--ok)]' : hp < 0 ? 'text-[var(--danger)]' : 'text-[var(--muted)]'}">{signed(hp)}</span>
