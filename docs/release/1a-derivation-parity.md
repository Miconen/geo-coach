# 1a-derivation: Review and Stats parity changes

Review (workbench) changes after #56 1a-derivation, each pinned by a fixture in
`apps/web/src/lib/server/workbench/__tests__/derivation.test.ts`, `run-timeline.test.ts` or
`packages/shared/src/__tests__/game-bounds.test.ts`:

| Change | Before | After |
|---|---|---|
| Debrief fallback | nearest Round of any Game ending within 2 min | final Round of a Game in the speech's own Session, within 2 min, before that Session's next Game; never in a missing-start successor's gap |
| Citations of replaced Transcript versions | dropped from the inspector | shown as historical speech (rules applied, one-off fixes skipped), outside the timeline |
| Range status | first matching range in list order | stale if any stale range overlaps, else unprocessed, else processed |
| Manual Learning Session | first cited Utterance's Session, else the first Round's first Session | every Session implied by cited speech and cited Rounds (0..N); uncited: none |
| Call-label winner per Round | unordered | latest finished run, then higher run id |
| Game to Session | Session span overlaps stored Game start/end | a Session Recording overlaps the Game's relationship bounds (0..N) |
| Point rule | as before | unchanged; coincident points never match; inverted intervals overlap nothing |
| Session rating delta | summed into every overlapping Session | one Session per Game (ADR 0008) |
| Relationship bounds | stored start/end incl. 15 s tail (1970 end for a trailing Round without times) | valid Rounds' own ends, no tail; a missing first start relates by Round links only |

Stats changes: `StatsGame.sessionId` became `sessionIds[]` plus `ratingSessionId`.

| Panel | Before | After |
|---|---|---|
| Session filter | Game matched its first overlapping Session only | Game matches any Session it was played in |
| Overview Session bands | a spanning Game drew in one band | drawn once in each Session's band |
| Effects "Played in a recorded Session" | first-match Session | any related Session |

Point cases (Stats and workbench share `gameOverlaps`): strictly inside matches, at the inclusive start matches, at the exclusive end does not, coincident points do not.
