/**
 * Recall (#56 X4): a client-side self-quiz, not a security boundary (answers are in the SSR HTML). One preference
 * per Player and Duo in localStorage, mirrored on <html data-recall> so CSS masks answers before hydration
 * (app.html applies it before first paint; the Duo layout keeps it in sync on Duo switches).
 */
export const recall = $state({ on: false });

export function recallKey(playerId: string, duoId: string): string {
  return `recall:v1:${playerId}:${duoId.toLowerCase()}`;
}

function setAttribute(value: "on" | "off" | null) {
  if (typeof document === "undefined") return;
  if (value === null) document.documentElement.removeAttribute("data-recall");
  else document.documentElement.setAttribute("data-recall", value);
}

/** Reads the stored preference for this Player and Duo (a storage error means off). */
export function readRecall(playerId: string, duoId: string): boolean {
  try {
    return localStorage.getItem(recallKey(playerId, duoId)) === "1";
  } catch {
    return false;
  }
}

/** Applies the stored preference: called synchronously by the Duo layout whenever the Duo or Player changes. */
export function syncRecall(playerId: string, duoId: string): void {
  recall.on = readRecall(playerId, duoId);
  setAttribute(recall.on ? "on" : "off");
}

/** Turns Recall on or off for this Player and Duo; other open tabs apply it on their next load. */
export function setRecall(playerId: string, duoId: string, on: boolean): void {
  try {
    localStorage.setItem(recallKey(playerId, duoId), on ? "1" : "0");
  } catch {
    // Storage unavailable: the preference lasts for this page only.
  }
  recall.on = on;
  setAttribute(on ? "on" : "off");
}

/** Leaving the Duo pages: nothing is masked elsewhere. */
export function clearRecallAttribute(): void {
  recall.on = false;
  setAttribute(null);
}
