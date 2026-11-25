import { LENS_COLOR, type LensKind } from "./scene.js";

// How the Outcome lens's categories look, on the map and in its legend. Every category has its own
// texture as well as its colour, so the lens doesn't rely on telling red from green: the answer is
// solid, a wrong guess is cross-hatched, a Learnings country is dotted, and a country in several
// categories is striped in their colours.

export const LENS_LABEL: Record<LensKind, string> = {
  g: "Answer",
  r: "Our wrong guess",
  y: "Named in Learnings",
  s: "Said aloud, not guessed",
};

/** Pattern tile size in image pixels (added at pixelRatio 2, so half that on screen). */
const PATTERN_PX = 40;
const MARK = "rgba(17,24,39,0.75)";

/** The fill pattern for a country in these categories (drawn with the canvas, so browser only). */
export function lensPatternImage(kinds: readonly LensKind[]): ImageData {
  const s = PATTERN_PX;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext("2d")!;
  if (kinds.length > 1) {
    // Diagonal stripes, one band per category across the tile, so the tile repeats seamlessly.
    const band = s / kinds.length;
    for (let i = -2 * s; i < 2 * s; i += band) {
      const k = Math.round(i / band);
      ctx.fillStyle = LENS_COLOR[kinds[((k % kinds.length) + kinds.length) % kinds.length]!];
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + band, 0);
      ctx.lineTo(i + band - s, s);
      ctx.lineTo(i - s, s);
      ctx.fill();
    }
    return ctx.getImageData(0, 0, s, s);
  }
  const kind = kinds[0] ?? "g";
  ctx.fillStyle = LENS_COLOR[kind];
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = MARK;
  ctx.fillStyle = MARK;
  if (kind === "r") {
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [x0, y0, x1, y1] of [
      [0, 0, s, s],
      [s, 0, 0, s],
    ]) {
      ctx.moveTo(x0!, y0!);
      ctx.lineTo(x1!, y1!);
    }
    ctx.stroke();
  } else if (kind === "y") {
    for (const [x, y] of [
      [s / 4, s / 4],
      [(3 * s) / 4, (3 * s) / 4],
    ]) {
      ctx.beginPath();
      ctx.arc(x!, y!, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return ctx.getImageData(0, 0, s, s);
}

/** The same texture as a CSS background, for the legend's swatches. */
export function lensSwatchCss(kinds: readonly LensKind[]): string {
  if (kinds.length > 1) {
    const step = 3;
    const stops = kinds.map((k, i) => `${LENS_COLOR[k]} ${i * step}px ${(i + 1) * step}px`).join(", ");
    return `repeating-linear-gradient(45deg, ${stops})`;
  }
  const kind = kinds[0] ?? "g";
  const c = LENS_COLOR[kind];
  if (kind === "r") {
    return `repeating-linear-gradient(45deg, transparent 0 3px, ${MARK} 3px 4px), repeating-linear-gradient(-45deg, transparent 0 3px, ${MARK} 3px 4px), ${c}`;
  }
  if (kind === "y") return `radial-gradient(${MARK} 1px, transparent 1.5px) 0 0 / 5px 5px, ${c}`;
  return c;
}
