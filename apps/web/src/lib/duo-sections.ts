// The Duo top nav (#75): its sections in order, and which one a route belongs to, so a child page (a Game's Round,
// a Session, a Source) highlights its list's section.

import { links } from "./links.js";

export const DUO_SECTIONS = [
  { key: "home", label: "Home", href: (duoId: string) => links.duo(duoId) },
  { key: "sessions", label: "Sessions", href: (duoId: string) => links.sessions(duoId) },
  { key: "games", label: "Games", href: (duoId: string) => links.games(duoId) },
  { key: "review", label: "Review", href: (duoId: string) => links.review(duoId) },
  { key: "knowledge", label: "Knowledge", href: (duoId: string) => links.knowledge(duoId) },
  { key: "stats", label: "Stats", href: (duoId: string) => links.stats(duoId) },
] as const;

export type DuoSection = (typeof DUO_SECTIONS)[number];
export type DuoSectionKey = DuoSection["key"];

const DUO_ROUTE = "/duos/[duoId=uuid]";

/** The section a SvelteKit route id belongs to: Home only on the Duo's own page, otherwise its first path segment. */
export function duoSection(routeId: string | null | undefined): DuoSection | null {
  if (!routeId?.startsWith(DUO_ROUTE)) return null;
  const rest = routeId.slice(DUO_ROUTE.length);
  if (rest === "") return DUO_SECTIONS[0];
  if (!rest.startsWith("/")) return null;
  const segment = rest.split("/")[1];
  return DUO_SECTIONS.find((s) => s.key !== "home" && s.key === segment) ?? null;
}
