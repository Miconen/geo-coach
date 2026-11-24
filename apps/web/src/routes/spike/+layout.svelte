<script lang="ts">
  // Spike-only stand-in for X5's shared store: events received while a navigation is in flight are held and
  // reconciled once it commits; a reopen during one is kept as an unscoped event for the destination.
  import { onMount } from "svelte";
  import { afterNavigate, beforeNavigate } from "$app/navigation";
  import { page } from "$app/state";

  let { children } = $props();
  let held: number[] = [];
  // A navigation is in flight from beforeNavigate until it commits (afterNavigate) or fails.
  let inFlight = $state(false);
  let refreshes = $state(0);
  let lastEvent = $state<number | null>(null);
  let opens = $state(0);
  let refreshedFor = $state("");

  function refresh() {
    refreshes += 1;
    refreshedFor = page.url.pathname;
  }

  onMount(() => {
    const es = new EventSource("/spike/events");
    es.onopen = () => {
      opens += 1;
      if (inFlight) held.push(-1);
    };
    es.onmessage = (e) => {
      const { id } = JSON.parse(e.data) as { id: number };
      lastEvent = id;
      if (inFlight) held.push(id);
      else refresh();
    };
    return () => es.close();
  });

  beforeNavigate((nav) => {
    if (nav.willUnload) return;
    inFlight = true;
    nav.complete.catch(() => {
      inFlight = false;
    });
  });

  afterNavigate(() => {
    inFlight = false;
    if (held.length === 0) return;
    held = [];
    refresh();
  });
</script>

<div
  data-testid="spike-store"
  data-refreshes={refreshes}
  data-last-event={lastEvent ?? ""}
  data-opens={opens}
  data-refreshed-for={refreshedFor}
  data-in-flight={inFlight ? "1" : "0"}
>
  {@render children()}
</div>
