# Learning replacement is scoped by Processing run purpose

ADR 0001 has a later finished run replace every Learning whose source span its range overlaps. Since agents can now add Tips (Learnings from their own knowledge, such as a future Plonkit-backed skill), a Tips pass over a range would wipe the Learnings extracted from speech there, and the reverse. So each Processing run has a **purpose** (`extract` or `tips`), and both replacement and staleness are derived per purpose: a run only replaces Learnings from earlier runs with the same purpose, and an open run blocks only overlapping open runs with the same purpose.

## Considered Options

- **One shared replacement rule** (as in 0001): simpler, but Tips and extraction can never be rerun on their own.
- **Tips outside runs** (written like manual Learnings, never replaced): loses reprocessing and the link to which agent wrote them.

## Consequences

- "Current", "unprocessed" and "stale" queries all gain a purpose filter, and a range can be up to date for `extract` but unprocessed for `tips`.
- A third purpose, `calls` (#41), labels each Split or Spread Round as a Call or not, with the Utterances it rests on. Its output is per-Round labels, not Learnings, but replacement and staleness follow the same per-purpose rule, so Calls can be relabelled or backfilled without redoing extraction.
- A fourth purpose, `clues` (#89), links each Round to the Clues the Duo said while guessing. Tagging Claims with Clues is not a run: a Claim has no Session, so each Claim records the prompt version that tagged it, and untagged, edited or out-of-date Claims form a queue the worker works through.
