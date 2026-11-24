import type { ParamMatcher } from "@sveltejs/kit";
import { isUuid } from "$lib/uuid.js";

export const match: ParamMatcher = (param) => isUuid(param);
