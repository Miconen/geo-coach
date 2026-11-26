# Clues are structured has/lacks links on Claims, not topics

The Clue lens (#77) has to rule countries in or out for what the Duo saw in a Round. A Claim's countries and free-form topics can't say that: "Panama has truck coverage" and "Botswana has only Gen 3 coverage" both just tag a country, and the same Clue gets different topic spellings. So a Clue is its own record, and a Claim links a Clue to each of its countries as *has* or *lacks*. Agents create and reuse Clues, Players can rename and merge them, and a Processing run purpose tags Clues onto Claims, including a backfill of the existing ones. A country is ruled out only by a verified Claim that it lacks the Clue. Following ADR 0005, a Round still never counts against a Claim.

## Considered Options

- **Reuse topics**: no backfill needed, but they are unstructured tags with no polarity, so nothing could ever be ruled out.
- **A stance per country on each Claim without a shared Clue**: gives polarity, but there's no way to gather every Claim about the same Clue.
- **Shade "ruled in" only**: avoids the schema change, but loses the lens's main point ("you said Botswana, but the Clues ruled it out").

## Consequences

A Round's Clues come only from what the Duo said while guessing, tagged by an agent; there is no manual tagging. A Clue nobody said aloud never reaches the lens.
