import { describe, expect, it } from "vitest";
import {
  answerStreetViewUrl,
  decodePanoId,
  googleMapsPointUrl,
  panoFieldOfView,
  panoStreetViewUrl,
  panoViewsByRound,
  type RawDuelPayload,
} from "../index.js";

// "tcJQ" hex-encoded, as GeoGuessr stores Google's pano ids.
const HEX_PANO = "74634A51";

describe("decodePanoId", () => {
  it("decodes GeoGuessr's hex encoding to Google's pano id", () => {
    expect(decodePanoId(HEX_PANO)).toBe("tcJQ");
  });

  it("keeps an id that isn't hex-encoded as it is", () => {
    expect(decodePanoId("AF1QipN-abc_xyz")).toBe("AF1QipN-abc_xyz");
    expect(decodePanoId("abc")).toBe("abc"); // odd length
    // Even-length hex whose bytes aren't pano id characters.
    expect(decodePanoId("0001")).toBe("0001");
  });
});

describe("panoFieldOfView", () => {
  it("is 90° at zoom 0 and halves per zoom step", () => {
    expect(panoFieldOfView(0)).toBe(90);
    expect(panoFieldOfView(1)).toBe(45);
    expect(panoFieldOfView(2)).toBe(22.5);
  });

  it("is clamped to 10–100°", () => {
    expect(panoFieldOfView(-1)).toBe(100);
    expect(panoFieldOfView(5)).toBe(10);
  });
});

describe("answerStreetViewUrl", () => {
  it("opens the Round's own pano with GeoGuessr's starting camera", () => {
    const url = new URL(
      answerStreetViewUrl({
        lat: 42.69,
        lng: 25.32,
        panoId: HEX_PANO,
        panoView: { heading: 123.5, pitch: -4, zoom: 1 },
      })!,
    );
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/@");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("map_action")).toBe("pano");
    expect(url.searchParams.get("pano")).toBe("tcJQ");
    expect(url.searchParams.get("viewpoint")).toBe("42.69,25.32");
    expect(url.searchParams.get("heading")).toBe("123.5");
    expect(url.searchParams.get("pitch")).toBe("-4");
    expect(url.searchParams.get("fov")).toBe("45");
  });

  it("falls back to the nearest pano at the point without a pano id or camera", () => {
    const url = new URL(answerStreetViewUrl({ lat: 1, lng: 2, panoId: null, panoView: null })!);
    expect(url.searchParams.get("pano")).toBeNull();
    expect(url.searchParams.get("viewpoint")).toBe("1,2");
    expect(url.searchParams.get("heading")).toBeNull();
  });

  it("is null for a Round without a location", () => {
    expect(answerStreetViewUrl({ lat: null, lng: null, panoId: HEX_PANO, panoView: null })).toBeNull();
  });
});

describe("panoStreetViewUrl and googleMapsPointUrl", () => {
  it("open a found pano, and the plain map at a point", () => {
    const pano = new URL(panoStreetViewUrl({ panoId: "tcJQ", lat: 1.5, lng: -2 }));
    expect(pano.searchParams.get("pano")).toBe("tcJQ");
    expect(pano.searchParams.get("viewpoint")).toBe("1.5,-2");
    const map = new URL(googleMapsPointUrl(1.5, -2));
    expect(map.origin + map.pathname).toBe("https://www.google.com/maps/search/");
    expect(map.searchParams.get("query")).toBe("1.5,-2");
  });
});

describe("panoViewsByRound", () => {
  it("reads each Round's starting camera from the raw duel", () => {
    const views = panoViewsByRound({
      rounds: [
        { roundNumber: 1, panorama: { panoId: "a", heading: 10, pitch: 2, zoom: 0.5 } },
        { roundNumber: 2, panorama: { panoId: "b", heading: 270 } },
        { roundNumber: 3, panorama: { panoId: "c" } },
        { roundNumber: 4 },
      ],
    });
    expect(views.get(1)).toEqual({ heading: 10, pitch: 2, zoom: 0.5 });
    // A missing pitch or zoom is GeoGuessr's default: level, unzoomed.
    expect(views.get(2)).toEqual({ heading: 270, pitch: 0, zoom: 0 });
    // No camera at all: Street View picks its own.
    expect(views.has(3)).toBe(false);
    expect(views.has(4)).toBe(false);
  });

  it("is empty for a duel without Rounds", () => {
    expect(panoViewsByRound({}).size).toBe(0);
  });

  it("is empty when a stored payload has non-array rounds", () => {
    for (const rounds of [{ 1: { roundNumber: 1 } }, "rounds", 3, null]) {
      expect(panoViewsByRound({ rounds } as unknown as RawDuelPayload).size).toBe(0);
    }
    expect(panoViewsByRound(null as unknown as RawDuelPayload).size).toBe(0);
  });
});
