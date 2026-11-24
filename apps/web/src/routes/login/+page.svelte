<script lang="ts">
  import ThemeSwitcher from "$lib/components/ThemeSwitcher.svelte";
  let { data } = $props();
</script>

<main class="min-h-screen flex items-center justify-center p-6">
  <div
    class="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6"
    style="box-shadow: var(--shadow-card)"
  >
    <div class="flex items-start justify-between gap-3">
      <h1 class="text-xl font-semibold text-[var(--ink)]">geo-coach</h1>
      <ThemeSwitcher />
    </div>
    <p class="mt-1 text-sm text-[var(--muted)]">
      GeoGuessr ranked team-duels coaching workbench. Sign in with a Discord account belonging to a configured Duo.
    </p>

    <div class="mt-5">
      <a
        href={data.next === "/" ? "/auth/discord" : `/auth/discord?next=${encodeURIComponent(data.next)}`}
        class="inline-flex w-full items-center justify-center rounded-lg bg-[#5865F2] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-95"
      >
        Sign in with Discord
      </a>
      {#if !data.discordConfigured}
        <p class="mt-2 text-xs text-[var(--warn)]">
          Discord OAuth env vars are not set on this instance.
        </p>
      {/if}
    </div>

    {#if data.devEnabled}
      <div class="mt-6 border-t border-[var(--border)] pt-4">
        <div class="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Development Login (NODE_ENV=development only)
        </div>
        {#if data.seededPlayers.length === 0}
          <p class="mt-2 text-xs text-[var(--muted)]">
            No seeded Players found. Run <code>pnpm db:seed</code> first.
          </p>
        {:else}
          <div class="mt-2 grid gap-2">
            {#each data.seededPlayers as p}
              <form method="POST" action="/auth/dev">
                <input type="hidden" name="next" value={data.next} />
                <input type="hidden" name="playerId" value={p.id} />
                <button
                  type="submit"
                  class="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-3 py-2 text-left text-sm font-medium hover:bg-[var(--accent-soft)]"
                >
                  Continue as {p.displayName}
                  {#if p.geoguessrName}
                    <span class="text-xs text-[var(--muted)]">({p.geoguessrName})</span>
                  {/if}
                </button>
              </form>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</main>
