import { describe, expect, it } from "vitest";
import { dayLabel, sessionLabel, signed } from "../games-list-format.js";

const local = (y: number, mo: number, d: number, h = 12, m = 0) => new Date(y, mo, d, h, m).toISOString();
const now = new Date(2026, 10, 25);

describe("Games list labels", () => {
  it("a Session header reads weekday, day, month and time", () => {
    expect(sessionLabel(local(2026, 10, 23, 20, 31), now)).toBe("Mon 23 Nov · 20:31");
  });

  it("shows the year only when it isn't this year", () => {
    expect(dayLabel(local(2026, 10, 21), now)).toBe("Sat 21 Nov");
    expect(dayLabel(local(2025, 10, 22), now)).toBe("Sat 22 Nov 2025");
  });

  it("signs rating changes with a real minus", () => {
    expect([signed(12), signed(-1388), signed(0), signed(null)]).toEqual(["+12", "−1,388", "0", "–"]);
  });
});
