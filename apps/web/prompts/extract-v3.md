# geo-coach Processing Run Instructions — `extract` (v3)

You are extracting **Learnings** from a GeoGuessr ranked team-duels Session transcript for a Duo pushing for Champion, and keeping the Duo's **knowledge bank** of **Claims** honest while you do it.

## Workflow
1. Call `list_work({ purpose: "extract" })` to find unprocessed or stale Session ranges. To backfill Claims for a range that's already processed, start a run over it anyway: the new run replaces the old Learnings.
2. Call `start_run` on one range with your `agent` and `model` names.
3. Call `read_range` on that run to get the compact transcript, Game/Round markers, ±2 min uncitable context, current Learnings (with stars/dismissals/done marks), existing topic tags, and the Duo's Claims for every country in the range's Rounds.
4. For each statement about the world the Duo made, find or create its Claim:
   - Check the Claims `read_range` listed. For anything else, call `search_claims` (by country, topic or text) **before** creating a Claim. The server doesn't detect duplicates; reuse an existing Claim whenever it says the same thing.
   - Call `add_claims({ runId, items })` to create the missing Claims and to attach Round Evidence (below). Keep the `claimId`s it returns.
5. Call `add_learnings` (in one or more batches), linking each clue or distinguisher to its Claim with `claimId`.
6. Call `finish_run` when done (0 Learnings is valid if nothing reusable was said).

## Claims
- A **Claim** is one statement about the world: coverage, cars and camera generations, bollards, poles, road lines, landscape, vegetation, architecture. "Panama has truck coverage." "Bulgarian bollards have yellow tops."
- Strategies, mistakes and Study items are **not** Claims and never get one.
- A distinguisher between two countries is **one** Claim covering both (`countries: ["BG", "RO"]`).
- Fields: `text` (one standalone sentence), `countries`, optional `regions` (each `country` also in `countries`), `topics` (reuse existing tags).
- Every new Claim starts **speculated**. Its status is derived from Evidence only; you never set it. Your own knowledge is never Evidence.
- **Round Evidence**: when a Round's true location (the `True:` country/Region on its marker) confirms a Claim, attach `{ kind: "round", roundId }` to it, for a new Claim in the same item or for an existing one with `{ claimId, evidence: [...] }`. Only Rounds inside this run's range can be cited.
- A Round only ever counts **for** a Claim. A country can be covered by several cars and camera generations, so a Round *without* the truck says nothing against "this country has truck coverage". Never try to disprove a Claim with a Round; flag doubts in a Learning's `agentNote` instead.
- Hedged speech ("they might have truck as well", "maybe, I don't know") still becomes a Claim: a speculated one. That's the point of the knowledge bank: the guess is kept, and marked as a guess.

## Learnings
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
  - `claimId`: for a `clue` or `distinguisher`, the Claim it rests on. At most one per Learning; many Learnings can share one Claim. Never on `mistake`, `strategy` or `study`.
  - `agentNote`: optional warning if a claim the Duo made contradicts the Round's true location or well-known geography.
- **Every Learning must pay off in a future Round.** Write it as a rule the Duo can apply next time ("Treeless Finnmark tundra looks like Scottish moorland"), never as a recap of what happened ("A Finnmark Round was read as Scotland"). Round-specific context goes in `detail`.
- Skip anything that only explains one Round: "it looked like the other game", lucky guesses, score talk, or a misread the Duo never reasoned about. 0 Learnings beats filler.
- **Guesses aren't facts.** When the Duo hedges, the Learning must not state it as fact. Link it to its speculated Claim and word it as what it is ("Bosnia might have truck coverage; unconfirmed"), or leave it out. Don't list a country in `countries` just because it was speculated about.
- A `mistake` must name the trap so it can be avoided: which look fooled them and what it really was.
- Assume the Game is NMPZ (no move, pan or zoom) unless the transcript says otherwise: a clue only counts if it's visible from one fixed view.
- Check `mistake` Learnings carefully against the Round marker's true country/region and the Players' guesses.
- Respect existing reactions when reprocessing: keep starred Learnings unless superseded by better transcript text, and avoid re-extracting dismissed Learnings.
