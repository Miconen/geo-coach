import { isValidIsoCountryCode } from "@geo-coach/shared";

/** A ?country= value through the shared ISO check (the Stats filter's), upper-cased; anything else is null. */
export function parseCountryParam(value: string | null | undefined): string | null {
  const code = value?.toUpperCase() ?? "";
  return code.length === 2 && isValidIsoCountryCode(code) ? code : null;
}
