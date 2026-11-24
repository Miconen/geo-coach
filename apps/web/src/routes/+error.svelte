<script lang="ts">
  import { page } from "$app/state";
</script>

<svelte:head>
  <title>{page.status} · geo-coach</title>
</svelte:head>

<main class="mx-auto max-w-xl space-y-3 px-4 py-16 text-center">
  <p class="mono text-sm text-[var(--muted)]">{page.status}</p>
  <h1 class="text-xl font-bold">
    {#if page.status === 404}
      Not found
    {:else if page.status === 503}
      Temporarily unavailable
    {:else}
      Something went wrong
    {/if}
  </h1>
  {#if page.error?.message && page.error.message !== "Not Found"}
    <p class="text-sm text-[var(--muted)]">{page.error.message}</p>
  {/if}
  <a href="/" class="inline-block rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-sm">Go home</a>
</main>
