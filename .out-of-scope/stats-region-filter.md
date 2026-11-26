# Stats Region filter

geo-coach does not filter Stats by Region (for example "only Texas and California"), even though Region data exists (`/api/stats/regions`).

## Why this is out of scope

The question it answers, "which Regions of the big countries do we keep missing?", hasn't come up in play. Stats' country filter covers progress tracking for studying. If Region-level misses start to matter, they belong in Duo Home's country dossier (#84), the lookup use case's home, rather than in another Stats filter.

## Prior requests

- #76: "/places, Sources index and Stats Region filter: what are they for?" (moved from #65)
