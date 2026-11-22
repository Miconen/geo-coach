import {
  DEVELOPER_MODE_STORAGE_KEY,
  parseDeveloperMode,
  serializeDeveloperMode,
} from "$lib/inspect/developer-mode-storage.js";

let enabled = $state(false);
let initialized = false;

/** Whether Developer mode (the props inspector) is on in this browser. */
export function getDeveloperMode(): boolean {
  return enabled;
}

export function setDeveloperMode(value: boolean) {
  enabled = value;
  try {
    localStorage.setItem(DEVELOPER_MODE_STORAGE_KEY, serializeDeveloperMode(value));
  } catch {
    // storage unavailable (private browsing / restricted context)
  }
}

export function initDeveloperMode(): () => void {
  if (typeof window === "undefined") return () => {};
  try {
    enabled = parseDeveloperMode(localStorage.getItem(DEVELOPER_MODE_STORAGE_KEY));
  } catch {
    enabled = false;
  }

  if (initialized) return () => {};
  initialized = true;

  const onStorage = (e: StorageEvent) => {
    if (e.key === DEVELOPER_MODE_STORAGE_KEY) enabled = parseDeveloperMode(e.newValue);
  };
  window.addEventListener("storage", onStorage);
  return () => {
    initialized = false;
    window.removeEventListener("storage", onStorage);
  };
}
