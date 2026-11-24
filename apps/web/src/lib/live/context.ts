import { getContext, setContext } from "svelte";
import type { DuoStream } from "./duo-stream.js";

const KEY = Symbol("duo-stream");

export function setDuoStream(stream: DuoStream): void {
  setContext(KEY, stream);
}

/** The Duo layout's stream (null outside a Duo route). */
export function getDuoStream(): DuoStream | null {
  return getContext<DuoStream | undefined>(KEY) ?? null;
}
