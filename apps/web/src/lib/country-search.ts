// Duo Home's "What do we know about…" search (#84).

/** Countries the search offers for a query: name prefix or ISO code, case-folded, most played first. */
export function matchCountries<T extends { code: string; name: string }>(dossiers: readonly T[], query: string, limit = 6): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return dossiers.filter((d) => d.name.toLowerCase().startsWith(q) || d.code.toLowerCase() === q).slice(0, limit);
}
