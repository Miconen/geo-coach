# Clues are structured links on Claims, not topics

The Clue lens (#77) has to rule countries in or out for what the Duo saw in a Round. A Claim's countries and free-form topics can't say that: "Panama has truck coverage" and "Botswana has only Gen 3 coverage" both just tag a country, and the same Clue gets different topic spellings. So a Clue is its own record, and a Claim links a Clue to each of its countries as *typical* (you'd expect to see it there), *in some areas* (it exists there, but only in places), or *lacks*. Agents create and reuse Clues, Players can rename and merge them, and a Processing run purpose tags Clues onto Claims, including a backfill of the existing ones. A country is ruled out only by a verified Claim that it lacks the Clue. Following ADR 0005, a Round still never counts against a Claim.

Each Clue belongs to a family (Road lines, Poles, Google car, Camera, Plates, …) and names one visible value within it: "Yellow centre line" and "Yellow outer lines" are two Clues, and so are smallcam and low-cam. A loose Clue ("yellow lines", "striped poles") paints the wrong countries. Colours in a Clue name groups you can tell apart in a Round whatever the lighting, so close shades share one: yellow and orange are one colour ("Yellow/orange centre line" covers Norway's orange-tinted lines; "Yellow/orange-striped poles" covers Korea's and Taiwan's). The finer shade stays in the Claim's text, where it can still tell two countries apart.

## Considered Options

- **Reuse topics**: no backfill needed, but they are unstructured tags with no polarity, so nothing could ever be ruled out.
- **A stance per country on each Claim without a shared Clue**: gives polarity, but there's no way to gather every Claim about the same Clue.
- **Shade "ruled in" only**: avoids the schema change, but loses the lens's main point ("you said Botswana, but the Clues ruled it out").
- **Plain *has* instead of typical / in some areas** (the first prototype, #85): a regional mention ("striped poles in Vorarlberg") painted the whole country as solidly as "all Kazakh coverage is a white truck", and broad Clues like wooden poles lit 24 countries, the wrong guess among them. A cap on how many countries a Clue may rule in was tried and was arbitrary.
- **Treat a family's values as exclusive** ("has white centre lines, so lacks yellow"): rejected. Countries mix values, so it would invent ruled-outs.

## Consequences

A Round's Clues come only from what the Duo said while guessing, tagged by an agent; there is no manual tagging. A Clue nobody said aloud never reaches the lens.

Tagging reads each Claim and tags its Clues; it never searches Claims by a Clue's wording. The #85 prototype searched by keyword and missed most of South America's centre lines, which Claims call "double yellow", "inner lines" or "middle lines can be all-yellow". The tagger reads how common a Clue is off the Claim's wording ("all", "most" → typical; a region, "sometimes" → in some areas; "never", "extremely uncommon" → lacks), and may link countries a Claim doesn't list when its wording rules them out ("only Peru, Brazil and Argentina in South America have smallcam"). A speculated Claim never says more than *in some areas*.

The lens is only as good as the Claims: a country no Claim covers stays neutral, even when it's the answer.

## Vocabulary (#90)

Tagging starts from a seed vocabulary: 17 families and about 100 Clues, kept in a versioned prompt beside the other agent prompts. Once Clues exist, the Duo's own Clues win and the tagger lists them before creating one. The tagger may add a Clue inside a family, never a new family, and each run reports the Clues it created so a Player can rename or merge them. A tagger left free to name Clues splits one Clue across spellings ("double yellow", "inner lines") and lumps different ones together ("striped poles"), and the lens then paints the wrong countries.

A Claim rules out only the countries it names, or a scope it states ("in South America"), and never more than about 15 countries; "unique to Panama" would otherwise write some 150 *lacks* links. Landscape Clues are things you can point at (red soil, rice paddies, eucalyptus, wind turbines); general terrain and place recognition get none, since a Clue that broad lights up half the map. Clues link to countries only; Clues linked to Regions (US, Canada and Brazil first) are a follow-up.
