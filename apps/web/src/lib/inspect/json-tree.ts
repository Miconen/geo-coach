/** How the Developer mode props inspector shows one value in its JSON tree. */
export type TreeValue =
  | {
      kind: "leaf";
      type: "string" | "number" | "boolean" | "null" | "undefined" | "bigint" | "symbol" | "date";
      text: string;
    }
  | { kind: "function"; text: string }
  | { kind: "circular"; text: string }
  | { kind: "array" | "object"; summary: string; entries: [key: string, value: unknown][] };

/** Arrays and objects with more entries than this start collapsed. */
export const COLLAPSE_AFTER = 5;

/**
 * Classifies `value` (found under `key`) for display. `ancestors` are the
 * containers above it, so a reference back to one of them shows as circular
 * instead of recursing forever.
 */
export function describeValue(key: string, value: unknown, ancestors: readonly object[] = []): TreeValue {
  switch (typeof value) {
    case "string":
      return { kind: "leaf", type: "string", text: JSON.stringify(value) };
    case "number":
      return { kind: "leaf", type: "number", text: String(value) };
    case "boolean":
      return { kind: "leaf", type: "boolean", text: String(value) };
    case "bigint":
      return { kind: "leaf", type: "bigint", text: `${value}n` };
    case "symbol":
      return { kind: "leaf", type: "symbol", text: value.toString() };
    case "undefined":
      return { kind: "leaf", type: "undefined", text: "undefined" };
    case "function":
      return { kind: "function", text: `ƒ ${key}` };
  }
  if (value === null) return { kind: "leaf", type: "null", text: "null" };
  const obj = value as object;
  if (obj instanceof Date) {
    return { kind: "leaf", type: "date", text: Number.isNaN(obj.getTime()) ? "Invalid Date" : obj.toISOString() };
  }
  if (ancestors.includes(obj)) return { kind: "circular", text: "[Circular]" };

  if (Array.isArray(obj)) {
    return { kind: "array", summary: `Array(${obj.length})`, entries: obj.map((v, i) => [String(i), v]) };
  }
  if (obj instanceof Set) {
    return { kind: "array", summary: `Set(${obj.size})`, entries: [...obj].map((v, i) => [String(i), v]) };
  }
  if (obj instanceof Map) {
    return { kind: "object", summary: `Map(${obj.size})`, entries: [...obj].map(([k, v]) => [String(k), v]) };
  }
  const entries = Object.entries(obj);
  return { kind: "object", summary: `{${entries.length} ${entries.length === 1 ? "key" : "keys"}}`, entries };
}

/** Whether an array or object node starts collapsed in the tree. */
export function startsCollapsed(node: TreeValue): boolean {
  return (node.kind === "array" || node.kind === "object") && node.entries.length > COLLAPSE_AFTER;
}
