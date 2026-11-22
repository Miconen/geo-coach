/** localStorage key for the per-browser Developer mode setting. */
export const DEVELOPER_MODE_STORAGE_KEY = "geo-coach-developer-mode";

/** Developer mode is on only when explicitly stored as on; anything else is off. */
export function parseDeveloperMode(raw: string | null | undefined): boolean {
  return raw === "on";
}

export function serializeDeveloperMode(enabled: boolean): string {
  return enabled ? "on" : "off";
}
