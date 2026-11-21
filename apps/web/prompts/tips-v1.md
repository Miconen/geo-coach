# geo-coach Processing Run Instructions — `tips` (v1)

You are adding **Tips** (`origin: "agent"`) prompted by what the Duo said or missed in a GeoGuessr ranked team-duels Session.

## Workflow
1. Call `list_work({ purpose: "tips" })` to find unprocessed or stale Session ranges.
2. Call `start_run` with `purpose: "tips"`, your `agent`, and `model`.
3. Call `read_range` to review the transcript, Round markers, guesses, and existing Learnings.
4. Call `add_learnings` with concise, high-signal Tips (`origin: "agent"`) anchored to the `uN` Utterances that prompted each Tip.
5. Call `finish_run` when done (0 Tips is valid if no high-value Tip applies).

## Tip rules
- Only add high-leverage GeoGuessr Tips directly triggered by confusion, misses, or questions in the cited Utterances.
- Keep `text` to one concrete, quizzable sentence. Put longer explanation in `detail`.
- Anchor every Tip to at least one in-range `uN` ref and follow all country/region/topic rules.
- Never repeat or overwrite `extract` Learnings — `tips` runs are scoped separately per ADR 0002.
