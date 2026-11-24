# A Game's rating change counts toward one Session

A Game relates to every Session it was played in (#56 1a-derivation): its relationship bounds, from the first Round's start to the latest own end of Rounds with a start (no 15 s results tail), overlap one of the Session's Recordings. Two Sessions can share a Game, for example when one Player's Recording ended and another's began mid-Game. Summing the Game's rating change into each of them would double-count it, so the delta goes to exactly one: the Session whose Recordings overlap the Game's relationship bounds the longest. Ties go to the Session that ended latest, then the lower Session id. A Game no Session overlaps by time (no Recording, or a Game whose first Round has no start time) counts toward no Session.

Only the rating delta is single-Session. The Game still appears in every related Session's Game list, mic coverage and Stats Session filter, and the Session list says so where it shows the delta.

## Considered Options

- **Count the delta in every overlapping Session**: what happened before, with Session bounds instead of Recordings; per-Session deltas no longer add up to the Duo's rating change.
- **The Session the Game started in**: a Game that started at the very end of one Recording but was played almost entirely in the next would credit the wrong Session.
- **Split the delta by overlap share**: fractional rating points mean nothing to a Player reading the Session list.
