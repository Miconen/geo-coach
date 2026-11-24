import { error } from "@sveltejs/kit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Non-throwing UUID syntax check (page loads, optional query params). */
export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Throws a 400 before any resource query when `value` is not a UUID (API sub-resource ids). */
export function assertUuid(value: string | null | undefined, name = "id"): string {
  if (!isUuid(value)) error(400, `Invalid ${name}`);
  return value.toLowerCase();
}
