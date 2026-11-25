// Pure URL helpers behind url-state.ts (#73), kept free of $app imports so they can be unit tested.

/**
 * The next shallow URL: the live path and query with `mutate` applied. `hash` replaces the anchor (null drops it,
 * a value without "#" gains one); undefined keeps the current one.
 */
export function nextViewHref(
  current: { pathname: string; search: string; hash: string },
  mutate: (params: URLSearchParams) => void,
  hash?: string | null,
): string {
  const params = new URLSearchParams(current.search);
  mutate(params);
  const qs = params.toString();
  const anchor = hash === undefined ? current.hash : hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "";
  return `${current.pathname}${qs ? `?${qs}` : ""}${anchor}`;
}

/** Sets `key` to `value`, or deletes it for null, undefined, "" or false; true writes "1". */
export function setParam(params: URLSearchParams, key: string, value: string | boolean | null | undefined): void {
  if (value === null || value === undefined || value === "" || value === false) params.delete(key);
  else params.set(key, value === true ? "1" : value);
}

/** Replaces every `key` with `values`, in order (none deletes it). */
export function setListParam(params: URLSearchParams, key: string, values: readonly string[]): void {
  params.delete(key);
  for (const v of values) params.append(key, v);
}

/** `key`'s value when it passes `valid`, else null: a malformed param is ignored, never an error. */
export function readParam(params: URLSearchParams, key: string, valid: (v: string) => boolean): string | null {
  const v = params.get(key);
  return v !== null && valid(v) ? v : null;
}

/** One of `options`, else null. */
export function readEnumParam<T extends string>(params: URLSearchParams, key: string, options: readonly T[]): T | null {
  const v = params.get(key);
  return v !== null && (options as readonly string[]).includes(v) ? (v as T) : null;
}

/** Every distinct `key` value that passes `valid`, in order. */
export function readListParam(params: URLSearchParams, key: string, valid: (v: string) => boolean): string[] {
  return [...new Set(params.getAll(key).filter(valid))];
}
