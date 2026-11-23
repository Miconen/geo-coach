# Agents can edit and delete Claims, but not Evidence a Player or Round gave

Ingestion made mistakes that `add_claims` could not undo: stray Claims with garbage text, and wording that overclaimed ("only" where the Source says "mostly"). Without a way to fix them, a wrong Claim stayed in the knowledge bank forever, since a Claim is only ever appended to. So agents get `edit_claims` (reword, or change countries, regions, topics) and `delete_claims`, both batched like `add_claims`.

Evidence is never edited. A Claim whose Evidence came from a Player's ✓/✗ or from a Round can't be recreated by an agent, and that Evidence vouched for the wording it saw. So rewording or deleting such a Claim needs an explicit `force`. A Claim backed only by Documentation can be changed or removed freely, because re-ingesting the Source recreates the Evidence. Deleting a Claim removes its Evidence and image links; Learnings that cited it keep their text and only lose the link (ADR 0005 still holds: status is derived, so nothing else needs fixing up).

## Considered Options

- **No delete, only Evidence `against`**: a mistaken or garbled Claim would show as disproved or disputed forever instead of disappearing.
- **Edit that also clears the Evidence**: would silently throw away a Player's confirmation to fix a typo.
- **Always allow, no `force`**: an agent re-running over a Source could erase what the Duo themselves confirmed.
