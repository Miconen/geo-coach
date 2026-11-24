# #56 step 4: legacy Review parity checklist

Step 4 retires the legacy Review modes (Knowledge, Session, Game) and `GET /api/duos/[duoId]/workbench`. Every old mode and inline feature maps to the step that replaced it or to an approved removal (the 3b parity decisions). Review is now the Learnings page: queues, filters, search, the Continent → Country list, country dossiers, the inspector and the Claim drawer.

## Modes

| Legacy feature | Now | Step |
| --- | --- | --- |
| Learnings mode | Review itself | unchanged |
| Knowledge mode: Claims by country with Evidence | /knowledge | 3a |
| Knowledge mode: ✓/✗ voting (`ClaimCard onSetEvidence`) | /knowledge cards and every Claim drawer | 3a, 3b |
| Knowledge mode: search, status and topic filters | /knowledge (masked Claims match no search) | 3a |
| Knowledge mode: Sources list (title, version, sections, images) | /knowledge, compact at the top; each Source links its page | 3a |
| Knowledge mode: Claim → Learning links | /knowledge links `/review?learning=`; the Review inspector and drawer pin through `onSelectLearning` without revealing | 3a, 3b |
| Knowledge Bank status counts in the left rail | one link to /knowledge with the Claim count | 4 |
| Session mode: Session list in the left rail | links to each Session page (and the Sessions index) | 2a(ii), 4 |
| Session mode: run history and `?run=` pin | Session page `?run=<id>#run-<id>` | 0b, 2a(ii) |
| Session mode: transcript timeline (Games, Rounds, speech, Learning pills, between-Game talk) | Session page timeline | 2a(ii) |
| Session mode: timeline search | Session page timeline search | 2a(ii) |
| Session mode: deleted-speech gaps | Session page timeline | 2a(ii) |
| Session mode: speech edit and delete | Session page timeline (`UtteranceText`, Delete speech) | 2a(ii) |
| Session mode: Process / Fix work ranges and worker status | Session page | 2a(i), 2a(ii) |
| Session mode: Session-wide Recall reveal | Session page timeline | 2a(ii) |
| Session mode: Game control (Game chip beside each Game) | Session page Games chips | 2a(ii), 4 |
| Session mode: "That Session no longer exists" | Session page `entity-missing` | 2a(ii) |
| Session mode: j/k Round navigation | approved removal (j/k still steps through Learnings) | 4 |
| Game mode (a Game without a Session) | Game page | 2a(ii) |

## Inline features

| Legacy feature | Now | Step |
| --- | --- | --- |
| Inspector Round cards and Cited Speech "Open in Session timeline" | open the Round page (its speech), else the Session page | 4 |
| Inspector "Full Game" tab | unchanged | — |
| Recent Games strip | Game chips to Game pages | 2a(ii) |
| Confusion Pairs and the pair filter | approved removal from Review (Stats keeps its own) | 3b |
| Uncited-speech search (Duo-wide) | approved removal (global search is Out); per Session it is the Session page's timeline search | 3b |
| Atlas rail ("Region → Country") | Continent → Country list setting `?country=` | 3b |
| Dossier "Evidence →" | `/knowledge?country=XX` | 3a |
| Pending ranges banner (jumped to the Session pane) | links to the first pending Session page | 4 |
| `?claim=` | the canonical Claim drawer route, one Claim fetched on demand | 3a, 3b |

## Callers and forwards

- `/api/duos/[duoId]/workbench` had one caller, Review's live refresh, which moved to `GET /api/duos/[duoId]/review` in 3b. The route is deleted; it now answers 404.
- X2 forwards: `/?run=` resolves its Duo, `/duos/[id]?run=` (Home) and `/duos/[id]/review?run=` redirect to the Session page; Home forwards `?learning=` and `?country=` to Review.
