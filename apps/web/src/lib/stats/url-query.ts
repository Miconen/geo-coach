import { replaceState } from "$app/navigation";

/**
 * Rewrites the address bar's query in place (#56 2b, ADR 0007). It reads the live address, not page.url: a shallow
 * replaceState leaves page.url as it was, so two controls rebuilding from it dropped each other's params.
 */
export function updateQuery(mutate: (params: URLSearchParams) => void): void {
  const params = new URLSearchParams(location.search);
  mutate(params);
  const qs = params.toString();
  replaceState(`${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`, {});
}
