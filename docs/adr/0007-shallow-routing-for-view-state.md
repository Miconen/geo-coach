# View state uses SvelteKit shallow routing, with the URL as the cold-load fallback

The UI rework (#56) needs Back to restore Stats filters, a focused Round and drill-downs, and needs deep links that survive reload and login. We use SvelteKit's shallow routing (`pushState` / `replaceState` from `$app/navigation`) with a typed `App.PageState`: filters `replaceState`, focusing a Round or drilling into a country `pushState`, and map focus gets its own URL keys. Every page reads `page.state` first and falls back to the URL's query parameters, so a cold load, a reload or a shared link rebuilds the same view.

Decided by the 0-spike on @sveltejs/kit 2.70.4 against spike-only routes (`src/routes/spike`, served only with `E2E_SPIKE=1`; `apps/web/e2e/spike.spec.ts`). Go. The spike proved:

- A shallow Back or Forward restores `page.state` without rerunning loaders or `beforeNavigate`.
- Back from another route reruns the server load, so a revoked membership applies on Back.
- Filter, then focus, then another route, then Back, then reload keeps the address bar. The router stores the old `page.url` under its own history key, so `page.url.href` can differ from the shallow URL; build the next shallow URL from `location.href`, not `page.url`.
- A same-route query change reruns a server load only when it read that key (`url.searchParams.get`), so `?learning=` or `?country=` never reruns a load that reads only `?duo=`. Review needs no membership recheck for those.
- An SSE event, or a stream reopen, received while a navigation is held after the destination's load is kept and reconciled once after the navigation commits, for a same-route id change and a cross-route one, with no replayed event. The store marks a navigation in flight from `beforeNavigate` to `afterNavigate` (or the navigation's `complete` rejecting). `beforeNavigate` fires a tick after the click, because the router resolves the route first; an event in that window refreshes the departing page, which is harmless because the destination's load starts later and sees the write.

In code (#73), `$lib/url-state.ts` is the only writer: `updateQuery` replaces (filters, tabs, drawers) and `pushQuery` pushes (focus). Both store the new query string as `page.state.query`, and pages read view params through `viewParams()` (that state first, else `page.url`), never `page.url` alone.

## Considered Options

- **`goto` with `replaceState: true, keepFocus, noScroll` for filters and a push for focus and drill-down** (the no-go fallback): reruns every load on each filter change. Stats keeps it in reserve if typed state ever loses the canonical URL on cross-route Back or reload.
- **Scoped `invalidate`**: Firefox shows a cancelled-request screen when a refresh is cancelled mid-navigation; live refresh uses fetch-and-overlay instead (X5).
- **A client cache of loads**: out of scope (follow-up Q).
