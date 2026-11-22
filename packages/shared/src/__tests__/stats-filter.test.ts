import { describe, expect, it } from "vitest";
import {
  EMPTY_STATS_FILTER,
  parseStatsFilter,
  serializeStatsFilter,
  type StatsFilter,
} from "../index.js";

describe("StatsFilter URL round-trip", () => {
  it("restores every filter field from its URL form", () => {
    const filter: StatsFilter = {
      from: "2026-09-01",
      to: "2026-11-21",
      sessionIds: ["ses_a", "ses_b"],
      mapNames: ["A Pro World", "A Community World"],
      modes: ["nm", "nmpz"],
      opponentRatingMin: 1100,
      opponentRatingMax: 1400,
      countryCodes: ["BG", "RO"],
    };

    expect(parseStatsFilter(serializeStatsFilter(filter))).toEqual(filter);
  });

  it("serializes the empty filter to no params and parses no params to the empty filter", () => {
    expect(serializeStatsFilter(EMPTY_STATS_FILTER).toString()).toBe("");
    expect(parseStatsFilter(new URLSearchParams())).toEqual(EMPTY_STATS_FILTER);
  });

  it("drops values it can't understand and leaves other params alone", () => {
    const params = new URLSearchParams(
      "duo=d1&from=yesterday&to=2026-11-21&mode=nm&mode=walking&oppMin=abc&oppMax=1500&country=bg&country=bulgaria",
    );

    expect(parseStatsFilter(params)).toEqual({
      ...EMPTY_STATS_FILTER,
      to: "2026-11-21",
      modes: ["nm"],
      opponentRatingMax: 1500,
      countryCodes: ["BG"],
    });
  });
});
