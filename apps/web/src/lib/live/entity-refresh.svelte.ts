import { onMount } from "svelte";
import { getDuoStream } from "./context.js";
import { needsRefresh, type Consumer } from "./dependencies.js";
import { singleFlight } from "./single-flight.js";

/**
 * Fetch-and-overlay live refresh for an entity page (#56 X5): one JSON refresh endpoint, single-flight, the
 * server load's data as the base (a newer load replaces any overlay). A 401 or 404 runs the stream's
 * authorization probe: 401/404 there clears the Duo (layout); 200 means this entity is gone ("no longer exists",
 * with the Duo UI and stream kept). Call during component init.
 */
export function useEntityRefresh<T>(opts: { base: () => T; url: () => string; consumer: Consumer; debounceMs?: number }) {
  const stream = getDuoStream();
  let live = $state.raw<{ base: T; value: T } | null>(null);
  let missing = $state(false);

  const refresh = singleFlight(async () => {
    const base = opts.base();
    try {
      const res = await fetch(opts.url());
      if (res.status === 401 || res.status === 404) {
        if ((await stream?.probe()) === "ok" && res.status === 404 && base === opts.base()) missing = true;
        return;
      }
      if (!res.ok) return;
      const value = (await res.json()) as T;
      if (base === opts.base()) {
        live = { base, value };
        missing = false;
      }
    } catch {
      // Offline: keep showing the current data.
    }
  });

  // An optional short debounce folds a burst of events into one fetch (Stats: each refresh reparses every rawDuel).
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (!opts.debounceMs) return void refresh();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void refresh();
    }, opts.debounceMs);
  };

  onMount(() => {
    const off = stream?.subscribe((batch) => {
      if (needsRefresh(opts.consumer, batch)) schedule();
    });
    return () => {
      off?.();
      if (timer) clearTimeout(timer);
    };
  });

  return {
    get current(): T {
      const base = opts.base();
      return live && live.base === base ? live.value : base;
    },
    get missing() {
      return missing;
    },
    refresh,
  };
}
