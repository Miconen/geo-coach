# Staleness and Learning replacement are derived, not marked

Transcripts get redone, partner uploads arrive late, clock offsets get corrected, and any part of a Session can be reprocessed by a different agent. So we never set a "needs processing" flag and never delete replaced Learnings. Instead, each finished Processing run saves its inputs (the Transcript version and chunk count it read per Recording). A range is **stale** when its current inputs differ from those, and **unprocessed** when no finished run covers it. A Learning is **current** unless a later finished run's range overlaps its source span. Links from Utterances to Games, Rounds and Sessions are likewise computed from UTC time ranges, not stored.

## Considered Options

- **Flags and deletes** (mark ranges dirty on re-upload, delete old Learnings on reprocess): simpler queries, but every write path must remember to set the flag. A missed case silently loses work, and earlier agents' output is gone.
- **Stored link tables** for Utterance→Round: fast reads, but they go stale whenever a late Game or offset correction arrives, and need rebuild logic.

## Consequences

- "What's current" and "what needs processing" are queries over indexed time ranges, so they must stay cheap. Revisit with materialised views if they don't.
- Replaced Learnings, and the dismiss/star reactions on them, remain as history.
