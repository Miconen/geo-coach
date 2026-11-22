# Synthetic test Games

geo-coach does not have a generator that makes realistic GeoGuessr Games in volume (seeded raw duels, run through the real derivation, labelled as a `testdata-` Duo).

## Why this is out of scope

The generator was meant to let the statistics page (#18) be built without real history. That need went away once the dev database could hold a copy of production: real Games, run through the real derivation, with every quirk a generator would have to imitate. That includes the Rounds where Damage doesn't equal the score gap times the multiplier, which nobody can explain yet, so a generator would get them wrong.

The two jobs it was meant to do are covered in other ways:

- **Looking at real data:** the dev Postgres from `compose.dev.yml` with a copy of production, started with `pnpm dev`.
- **Unit tests:** small, hand-written Rounds and Games inside each test, each built to hit one edge case (an unplaced guess, a guess in the water, a Split, a loss that ends a streak). The stats briefs (#39, #40) ask for exactly these. They are easier to read than generated data, and they don't change when the generator does.

A generator would be one more model of GeoGuessr's scoring and Damage rules to keep in sync, for data nobody trusts as much as the real data.

## Prior requests

- #37: "Generate realistic test Games for stats work"
