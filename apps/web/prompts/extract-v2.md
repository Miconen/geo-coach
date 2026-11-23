# geo-coach Processing Run Instructions — `extract` (v2)

You are extracting **Learnings** from a GeoGuessr ranked team-duels Session transcript for a Duo pushing for Champion.

## Workflow
1. Call `list_work({ purpose: "extract" })` to find unprocessed or stale Session ranges.
2. Call `start_run` on one range with your `agent` and `model` names.
3. Call `read_range` on that run to get the compact transcript, Game/Round markers, ±2 min uncitable context, current Learnings (with stars/dismissals/done marks), and existing topic tags.
4. Call `add_learnings` (in one or more batches) with the Learnings you extracted.
5. Call `finish_run` when done (0 Learnings is valid if nothing reusable was said).

## Extraction rules
- Extract only reusable knowledge the Duo actually discussed (`origin: "speech"`). Do not invent facts the Duo didn't say (those belong to a `tips` run).
- Each Learning has:
  - `kind`: `clue` | `distinguisher` | `mistake` | `strategy` | `study` | `other`
  - `text`: one clear, standalone sentence that makes sense without transcript context.
  - `detail`: optional extra context.
  - `countries`: ISO 3166-1 alpha-2 codes (e.g. `["BG"]`, `["BG", "RO"]`).
  - `regions`: optional `{ country, name }[]` where every `country` also appears in `countries`.
  - `topics`: lowercase tags; reuse existing tags shown by `read_range` where possible.
  - `utteranceRefs`: cite one or more `uN` refs from inside the run's range (never cite uncitable ±2 min context lines).
  - `roundIds`: only pass explicit Round ids for debriefs said outside that Round's time window; in-Round Rounds are derived automatically.
  - `agentNote`: optional warning if a claim the Duo made contradicts the Round's true location or well-known geography.
- **Every Learning must pay off in a future Round.** Write it as a rule the Duo can apply next time ("Treeless Finnmark tundra looks like Scottish moorland"), never as a recap of what happened ("A Finnmark Round was read as Scotland"). Round-specific context goes in `detail`.
- Skip anything that only explains one Round: "it looked like the other game", lucky guesses, score talk, or a misread the Duo never reasoned about. 0 Learnings beats filler.
- **Guesses aren't facts.** When the Duo hedges ("they might have truck as well", "maybe, I don't know"), don't state it as a clue. Only claims the Round's true location confirms, or that you're confident are true, become the Learning; leave the rest out or flag them in `agentNote`. Don't list a country in `countries` just because it was speculated about.
- A `mistake` must name the trap so it can be avoided: which look fooled them and what it really was.
- Assume the Game is NMPZ (no move, pan or zoom) unless the transcript says otherwise: a clue only counts if it's visible from one fixed view.
- Check `mistake` Learnings carefully against the Round marker's true country/region and the Players' guesses.
- Respect existing reactions when reprocessing: keep starred Learnings unless superseded by better transcript text, and avoid re-extracting dismissed Learnings.
