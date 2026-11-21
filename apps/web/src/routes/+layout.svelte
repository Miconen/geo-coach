<script lang="ts">
  import { onMount } from "svelte";
  import "../app.css";
  import { initTheme } from "$lib/theme.svelte.js";

  let { children } = $props();

  onMount(() => initTheme());
</script>

{@render children()}
