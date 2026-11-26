import { describe, expect, it } from "vitest";
import { ALL_COUNTRIES } from "@geo-coach/shared";
import { countriesNamed, foldText, namesCountry } from "../country-mentions.js";

describe("countriesNamed", () => {
  it("finds every country by its own name", () => {
    for (const c of ALL_COUNTRIES) expect(countriesNamed(`maybe ${c.name}?`), c.name).toContain(c.code);
  });

  it("folds case and accents", () => {
    expect(countriesNamed("DENMARK")).toEqual(["DK"]);
    expect(countriesNamed("Côte d'Ivoire")).toEqual(["CI"]);
    expect(countriesNamed("Curaçao")).toEqual(["CW"]);
    expect(foldText("Côte d'Ivoire!")).toBe("cote d ivoire");
  });

  it.each([
    ["Czech Republic for sure", "CZ"],
    ["looks like Holland", "NL"],
    ["is this the USA", "US"],
    ["UK, they drive on the left", "GB"],
    ["could be England", "GB"],
    ["Burma", "MM"],
    ["Swaziland", "SZ"],
    ["Ivory Coast", "CI"],
    ["DRC", "CD"],
  ])("aliases: %s", (text, code) => {
    expect(countriesNamed(text)).toContain(code);
  });

  it.each([
    ["vaguely danish so maybe just germany", ["DK", "DE"]],
    ["feels Czech", ["CZ"]],
    ["that's an Ecuadorian plate", ["EC"]],
    ["Swiss flag", ["CH"]],
    ["Dutch bollards", ["NL"]],
    ["the Danes", ["DK"]],
  ])("demonyms: %s", (text, codes) => {
    for (const c of codes) expect(countriesNamed(text)).toContain(c);
  });

  it("matches whole words only", () => {
    expect(countriesNamed("omanipulation")).toEqual([]);
    expect(countriesNamed("germanic languages")).toEqual([]);
    expect(countriesNamed("the chadwick road")).toEqual([]);
    expect(countriesNamed("Indiana")).toEqual([]);
    expect(namesCountry("Denmarkish", "DK")).toBe(false);
  });

  it("prefers the longest term: a longer name never reads as the shorter country inside it", () => {
    expect(countriesNamed("Nigeria")).toEqual(["NG"]);
    expect(countriesNamed("Niger")).toEqual(["NE"]);
    expect(countriesNamed("Papua New Guinea")).toEqual(["PG"]);
    expect(countriesNamed("Guinea-Bissau")).toEqual(["GW"]);
    expect(countriesNamed("South Sudan")).toEqual(["SS"]);
    expect(countriesNamed("Dominican Republic")).toEqual(["DO"]);
    expect(countriesNamed("North Korea")).toEqual(["KP"]);
    expect(countriesNamed("South America")).toEqual([]);
    expect(countriesNamed("American Samoa")).toEqual(["AS"]);
  });

  it("lists countries in order of first mention, once each", () => {
    expect(countriesNamed("Germany? No, Austria. Definitely Germany")).toEqual(["DE", "AT"]);
  });

  it("names both countries for a shared term", () => {
    expect(countriesNamed("Congo")).toEqual(["CD", "CG"]);
  });

  it("ignores common words that share a spelling with an alias", () => {
    expect(countriesNamed("look at the poles and the car")).toEqual([]);
  });
});
