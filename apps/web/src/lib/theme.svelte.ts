import {
  DEFAULT_THEME_ID,
  THEME_STORAGE_KEY,
  resolveThemeId,
  type ThemeId,
} from "@geo-coach/shared";

let current = $state<ThemeId>(DEFAULT_THEME_ID);
let initialized = false;

function applyToDom(id: ThemeId) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = id;
  }
}

export function getTheme(): ThemeId {
  return current;
}

export function setTheme(id: ThemeId) {
  current = id;
  applyToDom(id);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // storage unavailable (private browsing / restricted context)
  }
}

export function initTheme(): () => void {
  if (typeof window === "undefined") return () => {};
  try {
    current = resolveThemeId(
      localStorage.getItem(THEME_STORAGE_KEY) ?? document.documentElement.dataset.theme,
    );
  } catch {
    current = resolveThemeId(document.documentElement.dataset.theme);
  }
  applyToDom(current);

  if (initialized) return () => {};
  initialized = true;

  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY) {
      current = resolveThemeId(e.newValue);
      applyToDom(current);
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    initialized = false;
    window.removeEventListener("storage", onStorage);
  };
}
