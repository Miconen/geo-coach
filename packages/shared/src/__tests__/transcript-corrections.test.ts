import { describe, expect, it } from "vitest";
import type { WordTiming } from "../contracts.js";
import {
  applyCorrections,
  DEFAULT_HOTWORDS,
  findRegionSuggestions,
  MAX_HOTWORDS,
  mergeHotwords,
  normalizeRuleSource,
  selectRulesForCountries,
  STARTER_TRANSCRIPT_RULES,
  toHotwordSafe,
} from "../transcript-corrections.js";

function wordsOf(text: string, probability = 0.5): WordTiming[] {
  return text.split(" ").map((word, i) => ({
    word: ` ${word}`,
    startMs: i * 300,
    endMs: i * 300 + 250,
    probability,
  }));
}

describe("applyCorrections", () => {
  it("fixes the known mishearings", () => {
    const fix = (t: string) => applyCorrections(t, STARTER_TRANSCRIPT_RULES).text;
    expect(fix("this is nymphs, so be quick")).toBe("this is NMPZ, so be quick");
    expect(fix("Nymphs again")).toBe("NMPZ again");
    expect(fix("looks like matto corozo to me")).toBe("looks like Mato Grosso to me");
    expect(fix("matto corozo dosul maybe")).toBe("Mato Grosso do Sul maybe");
    expect(fix("Mato Grosso dosul")).toBe("Mato Grosso do Sul");
  });

  it("matches whole words only and does not cross punctuation", () => {
    const rules = [{ source: "matto corozo", replacement: "Mato Grosso" }];
    expect(applyCorrections("matto, corozo", rules).text).toBe("matto, corozo");
    expect(applyCorrections("nymphsy", STARTER_TRANSCRIPT_RULES).text).toBe("nymphsy");
  });

  it("never re-matches a replacement and is stable on raw text", () => {
    const rules = [
      { source: "a", replacement: "b" },
      { source: "b", replacement: "c" },
    ];
    expect(applyCorrections("a b", rules).text).toBe("b c");
  });

  it("lets a manual edit win over a rule", () => {
    const raw = "nymphs here";
    const out = applyCorrections(raw, STARTER_TRANSCRIPT_RULES, [
      { charStart: 0, charEnd: 6, originalText: "nymphs", replacement: "actual nymphs" },
    ]);
    expect(out.text).toBe("actual nymphs here");
    expect(out.spans[0]!.origin).toBe("manual");
  });

  it("ignores an edit that no longer matches the raw text", () => {
    const out = applyCorrections("different text", [], [
      { charStart: 0, charEnd: 6, originalText: "nymphs", replacement: "NMPZ" },
    ]);
    expect(out.text).toBe("different text");
    expect(out.spans).toEqual([]);
  });

  it("records raw offsets for every change", () => {
    const out = applyCorrections("ok nymphs ok", STARTER_TRANSCRIPT_RULES);
    expect(out.spans).toEqual([
      { rawStart: 3, rawEnd: 9, original: "nymphs", replacement: "NMPZ", origin: "rule" },
    ]);
  });

  it("normalizes accents and case in rule sources", () => {
    expect(normalizeRuleSource("  Rondônia ")).toBe("rondonia");
    expect(applyCorrections("RONDONIA", [{ source: "Rondônia", replacement: "Rondônia" }]).text).toBe(
      "Rondônia",
    );
  });
});

describe("findRegionSuggestions", () => {
  const suggest = (text: string, countryCodes = ["BR"], probability = 0.5) =>
    findRegionSuggestions({ text, words: wordsOf(text, probability), countryCodes });

  it("suggests a garbled Region name from the Round's countries", () => {
    const [s] = suggest("I think matto corozo here");
    expect(s?.replacement).toBe("Mato Grosso");
    expect(s?.originalText).toBe("matto corozo");
  });

  it("prefers the full name over a shorter Region inside it", () => {
    const [s] = suggest("Mato Grosso dosul");
    expect(s?.replacement).toBe("Mato Grosso do Sul");
  });

  it("does not guess when a fragment fits several Regions", () => {
    expect(suggest("maybe dosul then")).toEqual([]);
  });

  it("leaves correctly spelled Regions alone", () => {
    expect(suggest("Mato Grosso do Sul for sure")).toEqual([]);
    expect(suggest("Minas Gerais or Goiás")).toEqual([]);
  });

  it("does not rewrite ordinary English", () => {
    expect(suggest("the parents are going to the party", ["BR"], 0.9)).toEqual([]);
    expect(suggest("I would go there right now", ["BR"], 0.4)).toEqual([]);
  });

  it("does not match Regions of unrelated countries", () => {
    expect(suggest("I think matto corozo here", ["JP"])).toEqual([]);
  });

  it("abstains when word timings do not line up with the text", () => {
    expect(
      findRegionSuggestions({
        text: "matto corozo",
        words: [{ word: "other", startMs: 0, endMs: 10, probability: 0.2 }],
        countryCodes: ["BR"],
      }),
    ).toEqual([]);
    expect(
      findRegionSuggestions({ text: "matto corozo", words: [], countryCodes: ["BR"] }),
    ).toEqual([]);
  });

  it("skips text already handled by a rule or edit", () => {
    const text = "matto corozo";
    expect(
      findRegionSuggestions({
        text,
        words: wordsOf(text),
        countryCodes: ["BR"],
        blockedRanges: [{ start: 0, end: 12 }],
      }),
    ).toEqual([]);
  });
});

describe("findRegionSuggestions on real-world shapes", () => {
  const dictionary = new Set([
    "whales", "course", "indian", "victory", "piranha", "fish", "santa", "fell", "ports", "walls",
    "walks", "waves", "marine", "atlantic", "soul",
  ]);
  const suggest = (text: string, countryCodes: string[], probability = 0.5) =>
    findRegionSuggestions({
      text,
      words: wordsOf(text, probability),
      countryCodes,
      commonWords: dictionary,
    }).map((s) => s.replacement);

  it("lets a garbled full name beat the exact shorter name inside it", () => {
    expect(suggest("Mato Grosso do soul", ["BR"])).toEqual(["Mato Grosso do Sul"]);
    expect(suggest("Mato Grosso do sool", ["BR"])).toEqual(["Mato Grosso do Sul"]);
  });

  it("does not turn a cut-off or northern name into the southern one", () => {
    expect(suggest("rio grande do north", ["BR"])).toEqual(["Rio Grande do Norte"]);
    expect(suggest("rio grande do", ["BR"])).toEqual([]);
  });

  it.each([
    ["of course", "FR"],
    ["indian", "US"],
    ["whales", "GB"],
    ["victory", "AU"],
    ["piranha fish", "BR"],
    ["we said Santa fell down", "AR"],
    ["ports", "PT"],
    ["walls", "GB"],
    ["marine", "US"],
    ["atlantic", "CO"],
  ])("leaves ordinary speech alone: %s", (text, country) => {
    expect(suggest(text, [country], 0.5)).toEqual([]);
    expect(suggest(text, [country], 0.98)).toEqual([]);
  });

  it.each([
    ["halisco", "MX", "Jalisco"],
    ["wahaka", "MX", "Oaxaca"],
    ["hoyas", "BR", "Goiás"],
    ["siara", "BR", "Ceará"],
    ["spirit of santo", "BR", "Espírito Santo"],
    ["Sao Paolo", "BR", "São Paulo"],
  ])("hears %s as a Region of %s", (text, country, region) => {
    expect(suggest(text, [country])).toEqual([region]);
  });

  it("matches the names people say for officially long Regions", () => {
    expect(suggest("Murzia", ["ES"])).toEqual(["Murcia"]);
    expect(suggest("Murcia", ["ES"])).toEqual([]);
    expect(suggest("Madrit", ["ES"])).toEqual(["Madrid"]);
  });

  it("keeps official Region names protected alongside spoken ones", () => {
    expect(suggest("Comunitat Valenciana", ["ES"])).toEqual([]);
    expect(suggest("Comunidad de Madrid", ["ES"])).toEqual([]);
    expect(suggest("Región de Murcia", ["ES"])).toEqual([]);
  });

  it("treats possessives and hyphenated ordinary words as ordinary", () => {
    const words = new Set(["whale", "tail", "sea", "side"]);
    const find = (text: string) =>
      findRegionSuggestions({
        text,
        words: wordsOf(text, 0.97),
        countryCodes: ["GB"],
        commonWords: words,
      });
    expect(find("the whale's tail")).toEqual([]);
    expect(find("the whale’s tail")).toEqual([]);
    expect(find("sea-side whale")).toEqual([]);
  });

  it("never suggests over a one-off fix, but can extend past a rule", () => {
    const text = "Mato Grosso do soul";
    const find = (ranges: { blockedRanges?: { start: number; end: number }[]; ruledRanges?: { start: number; end: number }[] }) =>
      findRegionSuggestions({ text, words: wordsOf(text), countryCodes: ["BR"], ...ranges }).map(
        (s) => s.replacement,
      );
    expect(find({ blockedRanges: [{ start: 12, end: 19 }] })).toEqual([]);
    expect(find({ ruledRanges: [{ start: 15, end: 19 }] })).toEqual(["Mato Grosso do Sul"]);
    expect(find({ ruledRanges: [{ start: 0, end: 19 }] })).toEqual([]);
  });

  it("abstains when two countries make a word ambiguous", () => {
    expect(suggest("salte", ["AR"])).toEqual(["Salta"]);
    expect(suggest("salte", ["UY"])).toEqual(["Salto"]);
    expect(suggest("salte", ["AR", "UY"])).toEqual([]);
  });
});

describe("selectRulesForCountries", () => {
  const rules = [
    { source: "salte", replacement: "Salta", countryCode: "AR" },
    { source: "salte", replacement: "Salto", countryCode: "UY" },
    { source: "goyaz", replacement: "Goiás", countryCode: "BR" },
    { source: "goyaz", replacement: "Goyaz" },
    { source: "nymphs", replacement: "NMPZ" },
  ];
  const fix = (text: string, countries: string[]) =>
    applyCorrections(text, selectRulesForCountries(rules, countries)).text;

  it("applies a country rule only in that country", () => {
    expect(fix("salte", ["AR"])).toBe("Salta");
    expect(fix("salte", ["UY"])).toBe("Salto");
    expect(fix("salte", ["JP"])).toBe("salte");
    expect(fix("salte", [])).toBe("salte");
  });

  it("leaves a phrase alone when applicable country rules disagree", () => {
    expect(fix("salte", ["AR", "UY"])).toBe("salte");
  });

  it("prefers a country rule over a global one", () => {
    expect(fix("goyaz", ["BR"])).toBe("Goiás");
    expect(fix("goyaz", ["JP"])).toBe("Goyaz");
  });

  it("keeps global rules everywhere", () => {
    expect(fix("nymphs", ["JP"])).toBe("NMPZ");
    expect(fix("nymphs", [])).toBe("NMPZ");
  });
});

describe("toHotwordSafe", () => {
  it("keeps Latin-1, strips accents otherwise, and drops what cannot be sent", () => {
    expect(toHotwordSafe("Goiás")).toBe("Goiás");
    expect(toHotwordSafe("Vũng Tàu")).toBe("Vung Tau");
    expect(toHotwordSafe("東京")).toBeNull();
    expect(toHotwordSafe("  ")).toBeNull();
  });

  it("produces only values a raw HTTP header accepts", () => {
    expect(toHotwordSafe("North\nWest")).toBe("North West");
    expect(toHotwordSafe("a\tb\r\nc")).toBe("a b c");
    expect(toHotwordSafe("bad\u0000word")).toBeNull();
    expect(toHotwordSafe("bad\u0090word")).toBeNull();
    const merged = mergeHotwords(["North\nWest", "東京"], ["x\ny"]);
    expect(() => new Headers({ "X-Hotwords": merged.join(" ") })).not.toThrow();
  });
});

describe("mergeHotwords", () => {
  it("places rule replacements between a Duo's words and the defaults", () => {
    const merged = mergeHotwords(["Plovdiv"], ["Goiás", "東京", "Vũng Tàu"]);
    expect(merged.slice(0, 4)).toEqual(["Plovdiv", "Goiás", "Vung Tau", DEFAULT_HOTWORDS[0]]);
  });

  it("puts a Duo's words first and removes duplicates", () => {
    const merged = mergeHotwords(["Plovdiv", "PLONK"]);
    expect(merged.slice(0, 2)).toEqual(["Plovdiv", "PLONK"]);
    expect(merged.filter((w) => w.toLowerCase() === "plonk")).toHaveLength(1);
  });

  it("caps the list", () => {
    const own = Array.from({ length: 100 }, (_, i) => `word${i}`);
    expect(mergeHotwords(own)).toHaveLength(MAX_HOTWORDS);
  });

  it("keeps defaults ASCII and within the cap", () => {
    expect(DEFAULT_HOTWORDS.length).toBeLessThanOrEqual(MAX_HOTWORDS);
    expect(DEFAULT_HOTWORDS.every((w) => /^[\x20-\x7e]+$/.test(w))).toBe(true);
  });
});
