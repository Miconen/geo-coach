# geo-coach Processing Run Instructions — `clues` (v1)

You are linking each **Round** of a GeoGuessr ranked team-duels Session to the **Clues** the Duo said while guessing it: the things they saw and named or described ("yellow centre line", "white pickup", "s with a hat on that sign"). The Clue lens on the Round then shows which countries those Clues point to or rule out, from the Duo's Claims.

## Workflow
1. Call `list_work({ purpose: "clues" })` to find unprocessed or stale Session ranges.
2. Call `start_run` on one range with `purpose: "clues"`, your `agent`, and `model`.
3. Call `list_clues`. **Reuse a listed Clue whenever one fits**; create one only when nothing listed fits.
4. Call `read_range` on that run. It lists the range's Rounds, each with only the `uN` Utterances spoken **while it was being guessed**: talk after guessing ends reacts to the reveal and never counts.
5. Call `add_round_clues` (in one or more batches) with one item per Round: `{ roundId, clues: [{ clueId | family + name, utteranceRefs, note? }] }`. A Round where no Clue was said gets `clues: []`.
6. Call `finish_run` when done. The Round Clues take effect only then, and replace every earlier `clues` run's Clues for the Rounds this run covers.

## Rules
- A Clue is something the Players **saw in the Round** and named or described. Cite the Utterances that say it.
- Describing counts: "the lines in the middle are yellow" is Yellow/orange centre line; "the car is a white truck" is Pickup truck and White car.
- A **guess is not a Clue**: naming a country ("feels like Peru"), a language ("looks Czech"), or a region is a guess. Tag the visible thing behind it when they say it ("there's an ł, Poland" is Ł (l with a stroke)).
- Don't tag what they only wish they had seen or say is missing, unless the absence is itself a vocabulary Clue they point out ("no front plate").
- Questions count when they describe what's on screen ("is that a red-top bollard?" is Red-top bollard); idle questions with no visible thing don't.
- Transcripts are noisy. Read spoken letters and Clue words generously, but leave out what you can't tie to a Clue.
- One item per Round; listing a Round twice in one run keeps only the last item.

## Spoken letters
Players name letters by their shape. Map them to the Script and language Clues:

| Said aloud | Clue |
| --- | --- |
| "s with a hat", "s with a triangle", "s with a v", "s with a check", "háček s" | Š (s with a hat) |
| "o with a slash", "o with a line through it", "crossed o", "slashed o" | Ø (o with a slash) |
| "a with a ring", "a with a circle", "a with a dot on top", "a with a halo" | Å (a with a ring) |
| "l with a stroke", "l with a slash", "crossed l", "l with a line" | Ł (l with a stroke) |
| "sharp s", "eszett", "the B-looking s", "double s letter" | ß (sharp s) |
| "backwards letters", "Russian letters", "Cyrillic" | Cyrillic script |
| "Greek letters", "sigma", "lambda", "pi" (on a sign) | Greek script |
| "squiggly writing", "Arabic writing" | Arabic script |
| "Thai writing", "loopy letters" | Thai script |

A letter they name that isn't listed (for example "c with a tail") is a new value in Script and language, named with the letter and how it's said: "Ç (c with a tail)".

{{include clue-vocabulary-v1.md}}
