# geo-coach Processing Run Instructions — `calls` (v1)

You are labelling **Calls** in a GeoGuessr ranked team-duels Session. The Duo places two guesses per Round and only the best one scores. A Round is a **Split** when the Duo's guesses land in different countries, and a **Spread** when they land in one country but different Regions. A **Call** is a Split or Spread the Duo agreed on aloud while guessing ("you go Spain, I'll go Portugal", "I'll take the north, you go south"), as opposed to one where the two Players simply disagreed or guessed without coordinating.

## Workflow
1. Call `list_work({ purpose: "calls" })` to find unlabelled or stale Session ranges.
2. Call `start_run` on one range with `purpose: "calls"`, your `agent`, and `model`.
3. Call `read_range` on that run. It lists only the range's Split and Spread Rounds, each with both teams' guessed countries and Regions and the `uN` Utterances spoken during that Round's guessing phase.
4. Call `add_call_labels` (in one or more batches) with one label per Round you can judge.
5. Call `finish_run` when done. Labels take effect only then, and replace every earlier `calls` label for the Rounds this run covers.

## Labelling rules
- Each label has:
  - `roundId`: a Round listed by `read_range` for this run.
  - `called`: `true` when the Players explicitly agreed to cover different countries or Regions (assigning options to each other, or one proposing and the other accepting). `false` when they disagreed, each guessed their own read, or never coordinated.
  - `utteranceRefs`: the `uN` refs listed under that Round that the label rests on. Required when `called` is `true`; for `false`, cite the disagreement if there is one, or pass `[]` when nobody spoke.
  - `note`: optional, one short sentence on why (e.g. "Miko proposed Spain/Portugal, Sami agreed").
- Judge from what was said while guessing only. Talk after the Round (results, debriefs) doesn't make a Call.
- Label every listed Round you can. If the transcript is too garbled to tell, leave the Round out: unlabelled is shown as unknown, while `false` claims the Duo did not coordinate.
- Labelling a Round twice in one run keeps only the last label.
