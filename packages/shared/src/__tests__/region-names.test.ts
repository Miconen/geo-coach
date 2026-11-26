import { describe, expect, it } from "vitest";
import { namedRegionsIn, resolveRegionName } from "../region-names.js";

const code = (country: string, name: string) => resolveRegionName(country, name)?.code ?? null;

describe("resolving a Claim's Region name to a geocoder Region (#92)", () => {
  it("matches the geocoder's name ignoring case, accents and punctuation", () => {
    expect(code("US", "Hawaii")).toBe("US-HI");
    expect(code("US", "hawaii")).toBe("US-HI");
    expect(code("CA", "Quebec")).toBe("CA-QC");
    expect(code("ES", "Cataluna")).toBe("ES-CT");
    expect(code("TR", "Şanlıurfa")).toBe("TR-63");
    expect(code("UA", "Lviv Oblast")).toBe("UA-46");
  });

  it("takes a geocoder code as it is, in its own country only", () => {
    expect(code("US", "US-HI")).toBe("US-HI");
    expect(code("US", "us-hi")).toBe("US-HI");
    expect(code("CA", "US-HI")).toBeNull();
  });

  it("drops a generic word (Oblast, Krai, Province, City, …) when that leaves one match", () => {
    expect(code("RU", "Amur Oblast")).toBe("RU-AMU");
    expect(code("RU", "Kamchatka Krai")).toBe("RU-KAM");
    expect(code("RW", "Southern Province")).toBe("RW-05");
    expect(code("TW", "Taipei")).toBe("TW-TPE");
    expect(code("TW", "New Taipei")).toBe("TW-TPQ");
    // Chiayi is both a county and a city: the exact name wins.
    expect(code("TW", "Chiayi")).toBe("TW-CYQ");
    expect(code("PH", "Bicol Region")).toBe("PH-05");
    expect(code("RU", "Sakha Republic")).toBe("RU-SA");
    // A city is not its state.
    expect(code("US", "New York City")).toBeNull();
  });

  it("ignores spaces when nothing else matches", () => {
    expect(code("TH", "Chonburi")).toBe("TH-20");
    expect(code("VN", "Hanoi")).toBe("VN-HN");
  });

  it("knows common other names of a Region", () => {
    expect(code("GR", "Crete")).toBe("GR-M");
    expect(code("RU", "Moscow")).toBe("RU-MOS");
    expect(code("FI", "Lappi")).toBe("FI-10");
    expect(code("ES", "Comunidad Valenciana")).toBe("ES-VC");
  });

  it("resolves nothing for a scope or a place that isn't one Region", () => {
    expect(code("US", "north-eastern states")).toBeNull();
    expect(code("US", "New England")).toBeNull();
    expect(code("JP", "Kanto")).toBeNull();
    expect(code("SE", "Öland")).toBeNull();
    expect(code("XX", "Hawaii")).toBeNull();
  });
});

describe("the Regions a Claim names (#92)", () => {
  it("finds Regions named in the text or listed in the Claim's Regions", () => {
    expect(namedRegionsIn({ text: "Hawaii has no front plates.", countries: ["US"], regions: [] })).toEqual(["US-HI"]);
    expect(namedRegionsIn({ text: "No front plates here.", countries: ["US"], regions: [{ country: "US", name: "Hawaii" }] })).toEqual(["US-HI"]);
    expect(
      namedRegionsIn({ text: "Yellow plates in Quebec and Ontario, white in Alberta.", countries: ["CA"], regions: [] }).sort(),
    ).toEqual(["CA-AB", "CA-ON", "CA-QC"]);
  });

  it("never turns a vague scope into Regions", () => {
    expect(namedRegionsIn({ text: "The north-eastern states have front plates.", countries: ["US"], regions: [] })).toEqual([]);
    expect(namedRegionsIn({ text: "In the south, poles are concrete.", countries: ["BR"], regions: [] })).toEqual([]);
  });

  it("matches a Region's name as whole words only", () => {
    // "Para" is a Brazilian state; "parallel" must not name it.
    expect(namedRegionsIn({ text: "Lines run parallel to the road.", countries: ["BR"], regions: [] })).toEqual([]);
  });
});
