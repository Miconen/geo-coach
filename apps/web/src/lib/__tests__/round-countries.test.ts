import { describe, expect, it } from "vitest";
import { guessedCountryLabel, isWrongCountry } from "../round-countries.js";

const guess = (countryCode: string | null, pinned = true) => ({
  countryCode,
  lat: pinned ? 44.4 : null,
  lng: pinned ? 26.1 : null,
});

describe("Round card country helpers", () => {
  it("labels a guess by its country, water, or ? without a pin", () => {
    expect(guessedCountryLabel(guess("RO"))).toBe("RO");
    expect(guessedCountryLabel(guess(null))).toBe("water");
    expect(guessedCountryLabel(guess(null, false))).toBe("?");
  });

  it("flags a best guess in another country or in the water as a wrong country", () => {
    expect(isWrongCountry("BG", guess("RO"))).toBe(true);
    expect(isWrongCountry("BG", guess(null))).toBe(true);
    expect(isWrongCountry("BG", guess("BG"))).toBe(false);
  });

  it("does not judge a guess without a pin, or a Round without a country", () => {
    expect(isWrongCountry("BG", guess(null, false))).toBe(false);
    expect(isWrongCountry("BG", null)).toBe(false);
    expect(isWrongCountry(null, guess("RO"))).toBe(false);
  });
});
