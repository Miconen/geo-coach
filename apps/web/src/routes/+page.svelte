<script lang="ts">
  let { data } = $props();
</script>

<svelte:head>
  <title>geo-coach</title>
</svelte:head>

<main class="mx-auto max-w-xl px-4 py-16">
  <h1 class="text-xl font-bold">Welcome, {data.player.displayName}</h1>
  <p class="mt-2 text-sm text-[var(--muted)]">
    Your account isn't attached to a Duo yet. Seed a Duo with <code>pnpm db:seed</code>.
  </p>
  <a href="/settings" class="mt-4 inline-block text-sm text-[var(--accent)] underline">Settings</a>
</main>
