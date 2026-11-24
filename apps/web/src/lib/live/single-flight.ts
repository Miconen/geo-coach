/**
 * Coalesces calls to an async refresh: while one runs, further calls mark it to run once more when it ends, so a
 * burst of events costs at most two fetches and an older response never lands after a newer one. The task returns
 * true to ask for another pass itself (e.g. its response was for a selection already left).
 */
export function singleFlight(task: () => Promise<boolean | void>): () => Promise<void> {
  let running = false;
  let again = false;
  return async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        if (await task()) again = true;
      } while (again);
    } finally {
      running = false;
    }
  };
}
