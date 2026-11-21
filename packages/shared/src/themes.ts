export type ThemeId =
  | "stillwater"
  | "deep-water"
  | "warm-atlas"
  | "pine-dusk"
  | "stillwater-light"
  | "classic-light";

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  appearance: "dark" | "light";
  description: string;
  swatches: {
    bg: string;
    surface: string;
    accent: string;
    ink: string;
  };
}

export const THEME_STORAGE_KEY = "geo-coach-theme";
export const DEFAULT_THEME_ID: ThemeId = "stillwater";

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: "stillwater",
    name: "Stillwater",
    appearance: "dark",
    description: "Warm parchment text on deep charcoal with still teal accents.",
    swatches: {
      bg: "#151819",
      surface: "#1c2021",
      accent: "#5aa8b4",
      ink: "#ebdbb2",
    },
  },
  {
    id: "deep-water",
    name: "Deep Water",
    appearance: "dark",
    description: "Deeper midnight slate with higher contrast and luminous sea-teal.",
    swatches: {
      bg: "#0d1114",
      surface: "#141a1f",
      accent: "#62b8c9",
      ink: "#e6e2d6",
    },
  },
  {
    id: "warm-atlas",
    name: "Warm Atlas",
    appearance: "dark",
    description: "Sepia charcoal and warm cream parchment with compass amber accents.",
    swatches: {
      bg: "#181513",
      surface: "#211d1a",
      accent: "#d4a259",
      ink: "#f0e2c4",
    },
  },
  {
    id: "pine-dusk",
    name: "Pine Dusk",
    appearance: "dark",
    description: "Deep spruce twilight with parchment ink and seafoam sage accents.",
    swatches: {
      bg: "#111817",
      surface: "#182220",
      accent: "#6ec2a4",
      ink: "#e6dfd0",
    },
  },
  {
    id: "stillwater-light",
    name: "Stillwater Light",
    appearance: "light",
    description: "Warm parchment paper with muted espresso ink and deep teal.",
    swatches: {
      bg: "#f4efe6",
      surface: "#fbf8f2",
      accent: "#3d7a88",
      ink: "#3c3836",
    },
  },
  {
    id: "classic-light",
    name: "Classic Light",
    appearance: "light",
    description: "Crisp cool slate surfaces with classic geo-coach teal.",
    swatches: {
      bg: "#eef1f4",
      surface: "#ffffff",
      accent: "#0f766e",
      ink: "#0f172a",
    },
  },
] as const;

const THEME_ID_SET = new Set<string>(THEMES.map((t) => t.id));

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return typeof value === "string" && THEME_ID_SET.has(value);
}

export function resolveThemeId(value: string | null | undefined): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME_ID;
}
