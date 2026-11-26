// Formatting for the Games list (#81): group headers and compact rows.

/** "+12", "−8", "0"; "–" when there's no rating change. */
export const signed = (n: number | null) =>
  n === null ? "–" : n > 0 ? `+${n.toLocaleString("en-US")}` : n < 0 ? `−${(-n).toLocaleString("en-US")}` : "0";

const yearIfOther = (d: Date, now: Date) => (d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" as const });

/** "Mon 23 Nov", with the year only when it isn't this year ("Sat 22 Nov 2025"). */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...yearIfOther(d, now) }).replace(",", "");
}

/** A Session's header: "Mon 23 Nov · 20:31". */
export function sessionLabel(iso: string, now = new Date()): string {
  const time = new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${dayLabel(iso, now)} · ${time}`;
}

export const resultLetter = (won: boolean | null) => (won ? "W" : won === false ? "L" : "–");
export const resultTone = (won: boolean | null) =>
  won ? "text-[var(--ok)]" : won === false ? "text-[var(--danger)]" : "text-[var(--muted)]";
export const ratingTone = (n: number | null) =>
  n === null || n === 0 ? "text-[var(--muted)]" : n > 0 ? "text-[var(--ok)]" : "text-[var(--danger)]";
