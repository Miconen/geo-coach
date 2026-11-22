# Statistics are computed in the browser from compact Round rows

The statistics page loads one compact row per Game and per Round of the Duo once, and every panel is computed in the browser by pure TypeScript functions in the shared package, after one page-wide filter narrows the Rounds. We chose this over SQL aggregates because a Duo has only thousands of Rounds, the map view's area selection needs the guess points in the browser anyway, filters then respond instantly, and measures like shrunk averages and Duo-versus-Opponent gaps are simpler and unit-testable as plain functions.

## Considered Options

- **SQL aggregates per panel**: scales to any history, but every filter change and drawn area is a server round trip, and the statistics logic splits between SQL and TypeScript.
- **Stored aggregate tables**: fast reads, but they go stale whenever Games are re-derived, against "store raw, derive the rest".

## Consequences

- The payload grows with history (roughly 1–2 MB per year in compact form). If it grows too large, the same shared functions can run on the server instead.
- Fields the filter needs (Map, Mode, the Opponents' rating) must be derived Game columns so the loader stays a plain query.
