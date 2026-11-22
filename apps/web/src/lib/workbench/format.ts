/** Signed `m:ss` offset of `targetIso` from `baseIso`, e.g. `+1:05`. */
export function formatRelSec(baseIso: string, targetIso: string): string {
  const diffSec = Math.round((Date.parse(targetIso) - Date.parse(baseIso)) / 1000);
  const sign = diffSec < 0 ? "-" : "+";
  const abs = Math.abs(diffSec);
  const m = Math.floor(abs / 60);
  const s = String(abs % 60).padStart(2, "0");
  return `${sign}${m}:${s}`;
}
