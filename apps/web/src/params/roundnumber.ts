import type { ParamMatcher } from "@sveltejs/kit";

/** A positive Round number that fits int4 (X7: Round 0 and negatives never get a page). */
export const match: ParamMatcher = (param) => /^[1-9][0-9]{0,9}$/.test(param) && Number(param) <= 2147483647;
