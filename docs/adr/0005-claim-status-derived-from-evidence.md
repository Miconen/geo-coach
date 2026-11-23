# Claim status is derived from Evidence, and Rounds only confirm

Agents were writing the Duo's guesses ("Bosnia might have truck coverage") into Learnings as if they were facts, and no Source covers every country. So the knowledge bank keeps speculated Claims next to verified ones, and a Claim's status (speculated, verified, disproved, disputed) is never stored: it is computed from its Evidence, in the same spirit as ADR 0001. A Round only ever counts *for* a Claim. A country can be covered by several vehicles and camera generations, so a Round without a truck says nothing against "this country has truck coverage". Only Player or Documentation Evidence can count against a Claim.

## Considered Options

- **A stored status field** that agents or Players set: simpler to query, but it can disagree with the Evidence and gets lost when Evidence is added later.
- **Rounds as counter-Evidence**: would let a single Round "disprove" true coverage facts.
- **The model's own knowledge as Evidence**: is exactly what produced the unverifiable Learnings. A Tip resting only on it creates a speculated Claim instead.
