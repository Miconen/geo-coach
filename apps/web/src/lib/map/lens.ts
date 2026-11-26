import { LENS_COLOR, LENS_OUTLINE_COLOR } from "./scene.js";

// How the Outcome lens reads in its legend (#86): two plain fills and one outline, no textures.

export interface LensLegendEntry {
  label: string;
  /** The swatch's fill, or none for the outline. */
  fill: string | null;
  outline: string | null;
}

export const LENS_LEGEND: readonly LensLegendEntry[] = [
  { label: "Answer", fill: LENS_COLOR.g, outline: null },
  { label: "Our wrong guess", fill: LENS_COLOR.r, outline: null },
  { label: "Said while guessing, not guessed", fill: null, outline: LENS_OUTLINE_COLOR },
];
