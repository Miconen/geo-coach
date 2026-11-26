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

A Claim rules out only the countries it names, or a scope it states ("in South America"), and never more than about 15 countries; "unique to Panama" would otherwise write some 150 *lacks* links. Landscape Clues are things you can point at (red soil, rice paddies, eucalyptus, wind turbines); general terrain and place recognition get none, since a Clue that broad lights up half the map. At first Clues link to countries only; Region links come in #92.

## Clues a Round doesn't have (#91)

A Round can also be tagged as *not having* a Clue, when the Duo says so about that Round ("that's not a Norway pole"). Questions and remarks about other countries ("does Israel do yellow outer?") are not tagged, and an unclear remark is skipped. A country where a verified Claim makes that Clue *typical* then reads as *unlikely*, not ruled out: coverage varies within a country, and the Clue may just be out of view. From strongest to weakest: ruled out, typical, unlikely, in some areas. A Clue the Duo saw beats one they didn't, but a missing Clue still beats a weak *in some areas* link.

## Region links (#92)

A Claim–Clue link can name a Region within its country, on the same typical / in some areas / lacks scale; without one it covers the whole country. A Region *typical* or *in some areas* link also counts for its country as *in some areas*, worked out when read rather than stored; a Region *lacks* adds nothing at country level, so the country-level lens is unchanged. The tagger links only Regions the Claim names, in its text or its Regions; "the north-eastern states" stays an *in some areas* link for the country instead of a guessed list of states. No country list: any country whose Claims name Regions gets them. In the lens, a country with Region links for the shown Clues is shaded Region by Region, and its other Regions stay neutral.

## Trial tagging (#94)

Grading the first 100-Claim run showed that the wording rules decide most errors, and that a wrong *lacks* costs most: it greys out a possible answer. So a tagger prompt or model change is tried before it reaches the live links. A trial tagging job tags a fixed list of Claims into a side store, with a chosen model and prompt version, and changes no live link, tagging mark or Clue; the Clues it would create are only recorded. Two jobs, live or trial, can be compared link by link. A Player promotes a trial they accept, which applies its links as a live job would: to untagged Claims and Claims an older prompt version tagged, and to the rest only when forced. Every tagging job records its model, prompt version, turns, tokens and API-equivalent cost, so prompt versions and models are compared on cost as well as on links.
