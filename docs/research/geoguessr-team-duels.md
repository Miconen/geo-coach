# GeoGuessr ranked team duel data access

Research for ticket #2. Researched 2026-11-21.

**Question:** How can geo-coach get the Duo's ranked team duel data (Games, each Round's location, both teams' guesses and scores, Round start and end times precise enough to line up with Utterances, and rating history)? How does access authenticate, what are the rate-limit and terms risks, how stable is it, and does a userscript make a workable fallback?

## Short answer

- **There is no official public API.** Everything below is GeoGuessr's own internal web API, which the site's frontend calls. Community wrappers call it "not formally documented, or intended to be used by third parties" and say it "might break at any given time" ([py-geoguessr README][pyg]).
- **One authenticated GET per Game returns almost everything:** `GET https://game-server.geoguessr.com/api/duels/{gameId}`. Team duels use this same endpoint, with `options.isTeamDuels = true`. The response has every Round's location, `startTime`, `endTime` and `timerStartTime`, every player's guesses with a `created` timestamp, each team's per-Round score and health, and each player's rating change.
- **The API does provide Round timings.** They are absolute server timestamps in ISO 8601 UTC, so a Companion with an NTP-synced clock can line Utterances up with them directly. A userscript is not needed to get timings.
- **Game discovery:** page through `GET https://www.geoguessr.com/api/v4/feed/private` (the activity feed) and collect `gameId`s whose `gameMode` is `TeamDuels`.
- **Rating history:** I found no endpoint that returns history. Build it from each Game's `progressChange.rankedTeamDuelsProgress.ratingBefore/ratingAfter`. This fits "store raw, derive the rest".
- **Auth:** the `_ncfa` session cookie. It is a full-account credential, so keep it out of the repo.
- **Risk:** the ToS bans "automatic programs or scripts", and GeoGuessr's fair-play policy bans "scripts, or third-party software during a game" in competitive play. Fetching your own finished Games after the fact, at low volume, is the least risky option. A userscript that runs during ranked games carries real competitive-ban risk.

## 1. Endpoints

All of these were confirmed live on 2026-11-21 with unauthenticated probes (see §5). The response shapes come from community source code, not from my own authenticated calls.

### 1.1 Game detail: `GET https://game-server.geoguessr.com/api/duels/{gameId}`

- Needs auth. Without it, the server returns `401 {"message":"You need to be logged in as a guest to do this."}` (probed).
- py-geoguessr models the whole response as a typed pydantic model ([duels.py][pyg-duels], commit `4464b87`, 2026-03-10). The fields that matter to geo-coach:

| Path | Meaning / type | geo-coach use |
|---|---|---|
| `gameId` | lobby token | Game ID |
| `status` | `'Created'` \| `'Finished'` | only ingest Finished Games |
| `options.isTeamDuels`, `options.isRated` | bool | pick out ranked team duels |
| `options.competitiveGameMode` | e.g. moving / no move / NMPZ | Game metadata |
| `options.roundTime`, `options.maxRoundTime`, `options.roundCountdownDelay` (usually 4 s), `options.extraWaitTimeBetweenRounds` | durations | read timings correctly |
| `options.map.{name,slug}` | map | Game metadata |
| `rounds[].roundNumber` | starts at 1 | Round ID |
| `rounds[].panorama.{lat,lng,countryCode,panoId,heading,pitch,zoom}` | the actual location | Round location |
| `rounds[].startTime`, `rounds[].endTime`, `rounds[].timerStartTime` | datetime \| null | **Round window** |
| `rounds[].multiplier`, `damageMultiplier`, `isHealingRound` | | Round context |
| `teams[].{id,name,health}` | two teams | Duo vs opponents |
| `teams[].players[].playerId` | user id | which player |
| `teams[].players[].guesses[].{roundNumber,lat,lng,distance,score,created,isTeamsBestGuessOnRound}` | per-player guess; `created` is a datetime | **each player's guess and when they made it** |
| `teams[].roundResults[].{roundNumber,score,healthBefore,healthAfter,bestGuess}` | team result per Round | Round outcome |
| `teams[].players[].progressChange.rankedTeamDuelsProgress.{ratingBefore,ratingAfter,winStreak,...}` | rating change | **rating history** ([models.py][pyg-models]) |
| `result.{isDraw,winningTeamId,winnerStyle}` | | Game outcome |

Independent corroboration:

- The Greasy Fork userscript "Geoguessr duel guess times & team duels player list" reads `game.rounds[i].startTime/endTime`, `teams[].players[].guesses[i].created`, `teams[].roundResults[i].bestGuess.created`, `options.isTeamDuels`, `options.isRated`, and `progressChange.rankedTeamDuelsProgress` from this same endpoint, using `fetch(url, {credentials: "include"})` ([script 452742][gt]).
- GGDuelsFetcher computes guess time as `new Date(guess.created) - new Date(rounds[rn].startTime)` ([main.js][ggd], commit `f9d0fb7`). That confirms both fields are absolute, comparable timestamps.

**Timing semantics. Inferred, not verified:** `startTime` is when the Round becomes playable, `endTime` is when it closes, and `timerStartTime` is when the countdown clock starts (in duels this is normally triggered by the first guess). Any of them can be `null`. Confirm this against a real Game the Duo played before relying on it.

### 1.2 Game discovery: `GET https://www.geoguessr.com/api/v4/feed/private`

- Needs auth (probed `401`). Query params: `count` (py-geoguessr uses 50) and `paginationToken` ([activities.py][pyg-act]).
- The response is `{entries: [{type, time, user, payload}], paginationToken}`. `payload` is a **JSON string**. Type `7` (MultipleActivities) wraps an array of sub-activities. Competitive games are type `6` (`PlayedCompetitiveGame`), with payload `{gameId, gameMode, competitiveGameMode?}`, where `gameMode` can be `TeamDuels` ([types.py][pyg-types]).
- **Unverified:** whether ranked team duels arrive as type 6 or as type `13` (`PlayedPublicTeamDuel`). Filter on `gameMode == "TeamDuels"` and accept either type.
- GGDuelsFetcher pages this feed and waits 500 ms between pages ([main.js][ggd]).

### 1.3 Rating

- `GET https://www.geoguessr.com/api/v4/ranked-system/progress/{userId}` is **public** (probed: `200`, no auth). It returns the current solo `rating`, `gameModeRatings`, `divisionName`, `winStreak`, `latestGames` and similar fields ([Elo tracker script][elo]). I did not see team ratings in this response.
- `GET https://www.geoguessr.com/api/v4/ranked-team-duels/me/teams` answers `401` without auth, while unknown paths under the same prefix answer `404`. That suggests the route exists. **Its response shape is unverified.**
- I found **no rating-history endpoint**. Build history from `rankedTeamDuelsProgress` on each Game (§1.1).

### 1.4 Replays (optional, finer-grained)

- `GET https://game-server.geoguessr.com/api/replays/{playerId}/{gameId}/{roundNumber}` needs auth. According to a py-geoguessr source comment, it returns a per-player event stream with epoch-ms `time` values and event types such as `PanoPosition`, `PanoPov`, `PanoZoom`, `MapZoom`, `MapPosition`, `PinPosition`, `Guess`, `Focus`, `Timer`, `KeyPress` and `MapDisplay` ([common.py][pyg-common]). **Unverified and undocumented.** It could later link Utterances to in-Round actions (for example "he dropped a pin in Bulgaria at t+12 s"), but nothing in the core needs it.

## 2. Auth

- The `_ncfa` cookie from a logged-in browser session. py-geoguessr sends it as a cookie `_ncfa=<value>` ([api.py][pyg-api]). Browser scripts get the same effect with `credentials: "include"`.
- It gives full access to the account ([py-geoguessr README][pyg]). Store it outside the repo, for example in an env var or the OS keychain, and never log it. A secondary source says it lasts about a year ([efisha][efisha]). **Unverified.**
- Signing in with username and password (`/api/v3/accounts/signin`) is in py-geoguessr's `maybe_borked.py`. Don't rely on it.

## 3. Rate limits, terms and stability

- **Rate limits:** none published. Probed responses carry no rate-limit headers. They are served through Cloudflare (`server: cloudflare`), which can challenge or block automated traffic. Community fetchers pace themselves at 150 to 500 ms between requests ([main.js][ggd]). geo-coach's volume is tiny: one feed page plus about one detail call per Game.
- **Terms of Service** (geoguessr.com/terms, last updated 2026-01-10, read through a summarising fetch): §7 prohibits using "automatic programs or scripts, including but not limited to web spiders, crawlers, robots, ... bots", and prohibits giving "access to your user account to anyone else" ([terms][tos]). Pulling your own data with your own cookie is technically within the automated-access clause. Enforcement against low-volume personal use isn't documented anywhere I found. Each player should use only their own cookie.
- **Fair play:** GeoGuessr's support article bans "Google Maps, search engines, AI tools, scripts, or third-party software during a game" and "tools or extensions that provide an unfair advantage". Penalties run from leaderboard removal up to account suspension and competitive bans ([fair-play FAQ][fp]).
- **Stability:** the endpoint and field names have stayed stable for years. The guess-times userscript dates from 2022, GGDuelsFetcher was updated in 2025, and py-geoguessr's model was updated in 2026-03. All the probed routes were still live on 2026-11-21. It is still an internal API, so validate the schema on ingest and store the raw JSON.
- **Mode status:** the official changelog shows team duels in active development as recently as 2026-11-06 ("Turbo mode is now available for Team Duels") ([changelog][canny]). One search-engine summary claimed ranked team duels was "discontinued in August 2026". I could not find any primary source for that, and the changelog contradicts it. **Treat it as unverified, and ask the Duo to confirm.**

## 4. Is a userscript a workable fallback?

It is technically workable, but probably unnecessary and riskier than the API.

- **What it can see:** the page's own same-origin requests. A script can call `/api/duels/{id}` with `credentials: "include"`, as the spec-mode and guess-times scripts do ([spec mode][spec], [guess times][gt]). It can also see `window.__NEXT_DATA__` and the DOM (route `/team-duels/{id}`, `div[data-qa=guess-map]`). It could wrap `window.fetch` and `WebSocket` to capture live events with local timestamps.
- **What exists off the shelf:** miraclewhips' GeoGuessr Event Framework emits `game_start`, `round_start`, `round_end` and `game_end`. However, it only hooks `/api/v3/games` and `/api/v3/challenges` (single-player and challenges) and assumes 5 Rounds. **It does not support duels** ([source][gef], commit `22cea8b`).
- **Live duel updates** almost certainly arrive over a WebSocket to the game server. **Unverified:** none of the scripts I read hook it. They use DOM polling plus REST.
- **Why not to use it:** running a script in the GeoGuessr tab during ranked games matches the fair-play ban on "scripts ... during a game", even if the script is read-only. The API already gives absolute Round times after the Game, so the userscript adds little. The one thing it would add is local-clock timestamps that avoid clock skew.
- **Clock alignment without a userscript:** every API response carries `x-servertime` and `x-servertime-reception` headers in ISO 8601 UTC with 100 ns precision (probed). A Companion can measure its clock offset from those headers, or rely on NTP. Either way it is well within the accuracy speech alignment needs.

## 5. Probes run (2026-11-21, unauthenticated, from Finland)

| Request | Result |
|---|---|
| `GET game-server.geoguessr.com/api/duels/<zero uuid>` | `401 {"message":"You need to be logged in as a guest to do this."}` |
| `GET www.geoguessr.com/api/v4/feed/private` | `401` |
| `GET www.geoguessr.com/api/v4/ranked-system/progress/{id}` | `200` JSON (`rating`, `divisionName`, `latestGames`, ...) |
| `GET www.geoguessr.com/api/v4/ranked-team-duels/me/teams` | `401` (vs `404` for unknown paths) |
| Response headers | `server: cloudflare`, `x-servertime: 2026-11-21T13:09:41.1254799Z` |

I made no authenticated calls, so every field-level claim rests on the community code cited.

## 6. Suggested approach for geo-coach

1. After each Session, page `feed/private` until reaching a known `gameId`, keeping entries with `gameMode == "TeamDuels"`.
2. For each new Game, `GET /api/duels/{gameId}`, store the raw JSON unchanged, and derive Games, Rounds, guesses and ratings from it.
3. Use `rounds[].startTime/endTime` and `guesses[].created` (UTC) to place Utterances. Keep Companion clocks NTP-synced, and optionally record the `x-servertime` offset.
4. Supply `_ncfa` through local config or an env var, one per player or one per Duo. Never commit it.
5. Skip the userscript unless the API timings turn out to be unreliable in practice.

## Open items to verify with a real Game

- The exact meaning of `startTime`, `timerStartTime` and `endTime`, and whether they include the 4 s countdown.
- Which feed activity type ranked team duels use (6 or 13).
- The response shape of `ranked-team-duels/*`, and whether a team-rating history exists.
- Whether ranked team duels is still offered (contradicting claim in §3).

[pyg]: https://github.com/miss-inputs/py-geoguessr
[pyg-duels]: https://github.com/miss-inputs/py-geoguessr/blob/4464b8782a381f3166da7c5c5e99985e8e534960/pygeoguessr/apis/multiplayer/duels.py
[pyg-models]: https://github.com/miss-inputs/py-geoguessr/blob/4464b8782a381f3166da7c5c5e99985e8e534960/pygeoguessr/models.py
[pyg-act]: https://github.com/miss-inputs/py-geoguessr/blob/4464b8782a381f3166da7c5c5e99985e8e534960/pygeoguessr/apis/activities.py
[pyg-types]: https://github.com/miss-inputs/py-geoguessr/blob/4464b8782a381f3166da7c5c5e99985e8e534960/pygeoguessr/types.py
[pyg-common]: https://github.com/miss-inputs/py-geoguessr/blob/4464b8782a381f3166da7c5c5e99985e8e534960/pygeoguessr/apis/multiplayer/common.py
[pyg-api]: https://github.com/miss-inputs/py-geoguessr/blob/4464b8782a381f3166da7c5c5e99985e8e534960/pygeoguessr/api.py
[ggd]: https://github.com/sp4ghet/GGDuelsFetcher/blob/f9d0fb7dad3aa3b482305781ed79dead477a382e/main.js
[gt]: https://greasyfork.org/en/scripts/452742-geoguessr-duel-guess-times-team-duels-player-list/code
[spec]: https://greasyfork.org/scripts/478254-geoguessr-team-duels-spec-mode/code
[elo]: https://greasyfork.org/scripts/503100-elo-tracker/code
[gef]: https://github.com/miraclewhips/geoguessr-event-framework/tree/22cea8ba0b4cc1f7d21ed9b2ef7f7275e7f5f67d
[efisha]: https://efisha.com/2022/04/18/geoguessr-api-endpoints/
[tos]: https://www.geoguessr.com/terms
[fp]: https://geoguessr.freshdesk.com/support/solutions/articles/206000056747-can-i-use-google-or-other-help-to-improve-my-performance-in-the-game-
[canny]: https://geoguessr.canny.io/changelog
