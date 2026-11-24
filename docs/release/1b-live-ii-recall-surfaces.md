# Recall surfaces (#56 1b-live(ii))

Recall is a client-side self-quiz, not a security boundary: answers are in the SSR HTML and `__data.json`. One preference per Player and Duo lives in `localStorage` under `recall:v1:<playerId>:<duoId>`. `app.html` applies it to `<html data-recall>` before first paint, and the Duo layout re-applies it synchronously on every Duo switch. All masking goes through `Masked.svelte`. Its content is always rendered, and CSS hides it while `data-recall` is `on` or `pending`, until that item is revealed. Pins (`?learning=`, `?run=`) and back-navigation never reveal anything.

| Surface (Review) | Hidden before reveal | Reveal | Hydrated / first-paint test (`e2e/recall.spec.ts`) |
| --- | --- | --- | --- |
| Learning row | takeaway text, topics, Session and Game chips | the row's Reveal button, or Space on the selected row with nothing focused; the select control only selects | "Enter and Space on a masked row's select control…"; first paint: "a cold tab with Recall on…" |
| Learning inspector | text, detail, agent note, Claim, supersession links, source Games, Round cards' speech (shown without speech), cited speech | Reveal Takeaway, or Space | covered by the row tests (same item reveal) |
| `?country=` dossier: country headers and badges | nothing: the country is the prompt | n/a | "a cold ?country= link is masked when hydrated…" |
| `?country=` dossier: compact Claim cards | the whole Claim | that Claim's Reveal | same test (no Claims seeded: covered by the static check) |
| ClaimCard sibling Learnings | each linked Learning's text | revealing that Learning | static check |
| Zero-Learning Round bridge | the Round's speech (the card shows without speech) | that Round's reveal | static check |
| Cold legacy `?run=` Session timeline | Games (Rounds and speech), Learning pills (each its own item), between-Game speech | one reveal per Session; Learning pills still need their own | "a cold legacy ?run= with Recall on…" |
| Transcript search | unrevealed Learnings match only on countries and regions; speech matches only in revealed Sessions | n/a | search hit counts follow the same rule |


From 3a (`e2e/knowledge.spec.ts`):

| Surface | Hidden before reveal | Reveal | Test |
| --- | --- | --- | --- |
| /knowledge Claim cards | the whole Claim (text, places, topics, Evidence, images); a masked Claim matches no search | that Claim's Reveal | "/knowledge masks Claims…" |
| Claim drawer (`?claim=`, /knowledge and Review) | everything but the status and a reveal control | Reveal this Claim (its linked Learnings keep their own reveals) | "a cold ?claim= under Recall…" |
| Evidence chip to a Round | the Round page's answers, as on any Round page | the Round page's reveals | "an Evidence chip to a Round…" |
| Home | nothing: no Learning or Claim text | n/a | "bare Home with Recall on…" |
| Source excerpts, Stats Round cards | nothing: reference text and the results view (X4 exceptions) | n/a | n/a |

Preference scope tests: "two Players of one Duo in the same tab…", "the first paint after a client-side Duo switch…", "hydrated, Recall stays on across reloads…".
