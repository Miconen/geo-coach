<script lang="ts">
  import { onMount } from "svelte";
  import "../app.css";
  import { initTheme } from "$lib/theme.svelte.js";
  import { initDeveloperMode } from "$lib/developer-mode.svelte.js";

  let { children } = $props();

  onMount(() => {
    const stopTheme = initTheme();
    const stopDeveloperMode = initDeveloperMode();
    return () => {
      stopTheme();
      stopDeveloperMode();
    };
  });
</script>

{@render children()}
