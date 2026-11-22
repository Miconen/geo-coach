# Guess countries and Regions come from an offline Natural Earth geocoder

GeoGuessr's duel payload gives the actual location's country but no Region, and nothing about where a guess landed. We derive both from coordinates with an offline geocoder over Natural Earth 10m boundaries (admin-0 map units for countries, admin-1 for Regions), committed to the repo as simplified TopoJSON with a script to regenerate it. Derivation therefore stays repeatable: `db:rebuild-derived` gives the same answer every time, with no outside service.

## Considered Options

- **Nominatim** (as the daily-challenge recap does): no data to ship, but its usage policy allows 1 request per second (a backfill takes over an hour), every rebuild depends on an outside service, and its names and levels drift.
- **GADM**: finer and more consistent, but its licence forbids redistribution, so it can't be committed to a public repo.
- **geoBoundaries**: consistent Region levels, but about 360 MB, share-alike licences for several countries, and no separate Puerto Rico or Hong Kong.

## Consequences

- Natural Earth's admin-1 is uneven, so some countries are grouped coarser by rule (France, Italy, the Philippines and Spain to their regions, the UK to its 4 nations). Regions are stored as codes, and names come from a lookup table.
- The actual location's country stays GeoGuessr's own code. The geocoder is checked against it and should agree on at least 99% of real Rounds.
