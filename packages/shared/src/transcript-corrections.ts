import type { WordTiming } from "./contracts.js";
import { regionsOf } from "./regions.js";

export interface CorrectionRule {
  source: string;
  replacement: string;
  /** ISO 3166-1 alpha-2. Absent means the rule applies everywhere. */
  countryCode?: string | null;
}

export interface CorrectionEdit {
  charStart: number;
  charEnd: number;
  originalText: string;
  replacement: string;
}

export interface CorrectionSpan {
  rawStart: number;
  rawEnd: number;
  original: string;
  replacement: string;
  origin: "rule" | "manual";
}

export interface CorrectedText {
  text: string;
  spans: CorrectionSpan[];
  /** Every raw range a rule or edit ruled on, including rules that changed nothing. */
  matched: Array<{ start: number; end: number }>;
}

export interface RegionSuggestion {
  charStart: number;
  charEnd: number;
  originalText: string;
  replacement: string;
  regionCode: string;
  score: number;
}

/** Spoken forms Whisper should be primed with. ASCII, most useful first. */
export const DEFAULT_HOTWORDS: readonly string[] = [
  "nymps",
  "NM",
  "Duels",
  "Plonkit",
  "plonk",
  "insta",
  "insta-send",
  "pano",
  "shitcam",
  "low-cam",
  "skull-cam",
  "trekker",
  "snorkel",
  "Gen 2",
  "Gen 3",
  "Gen 4",
  "bollard",
  "chevrons",
  "Cyrillic",
  "Hangul",
  "Devanagari",
  "cerrado",
  "fynbos",
  "taiga",
  "Sahel",
  "laterite",
  "oblast",
  "voivodeship",
  "kabupaten",
  "Mato Grosso",
  "Mato Grosso do Sul",
  "Minas Gerais",
  "Goias",
  "Parana",
  "Rio Grande do Sul",
  "Kyrgyzstan",
  "Eswatini",
  "Lesotho",
  "Svalbard",
  "Sulawesi",
  "Kalimantan",
];

/** Known mishearings every Duo starts with. A Duo can disable any of them. */
export const STARTER_TRANSCRIPT_RULES: readonly CorrectionRule[] = [
  { source: "nymphs", replacement: "NMPZ" },
  { source: "nymps", replacement: "NMPZ" },
  { source: "matto corozo", replacement: "Mato Grosso" },
  { source: "matto corozo dosul", replacement: "Mato Grosso do Sul" },
  { source: "mato grosso dosul", replacement: "Mato Grosso do Sul" },
];

export const MAX_HOTWORDS = 60;
const MAX_RULE_HOTWORDS = 20;

/**
 * A form safe for the X-Hotwords header on any Companion version: Latin-1 as is, otherwise
 * with accents removed, or null when it still cannot be sent.
 */
export function toHotwordSafe(word: string): string | null {
  const trimmed = word.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const isSendable = (value: string) =>
    [...value].every((ch) => {
      const code = ch.codePointAt(0)!;
      return (code >= 0x20 && code < 0x7f) || (code >= 0xa0 && code <= 0xff);
    });
  if (isSendable(trimmed)) return trimmed;
  const stripped = trimmed.normalize("NFD").replace(/\p{M}/gu, "");
  return isSendable(stripped) ? stripped : null;
}

/** A Duo's own hotwords, then what its rules correct to, then defaults; deduplicated and capped. */
export function mergeHotwords(
  own: readonly string[],
  ruleReplacements: readonly string[] = [],
  max: number = MAX_HOTWORDS,
): string[] {
  const safe = (words: readonly string[]) =>
    words.map(toHotwordSafe).filter((w): w is string => w !== null);
  const fromRules = safe(ruleReplacements).slice(0, MAX_RULE_HOTWORDS);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const word of [...safe(own), ...fromRules, ...DEFAULT_HOTWORDS]) {
    const key = foldText(word);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(word);
    if (merged.length >= max) break;
  }
  return merged;
}

interface Token {
  norm: string;
  start: number;
  end: number;
}

const TOKEN_RE = /[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu;

function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/’/g, "'")
    .toLowerCase();
}

function tokenize(text: string): Token[] {
  return [...text.matchAll(TOKEN_RE)].map((m) => ({
    norm: foldText(m[0]),
    start: m.index,
    end: m.index + m[0].length,
  }));
}

/** Canonical whole-word form of a rule source, or "" when it has no words. */
export function normalizeRuleSource(source: string): string {
  return tokenize(source)
    .map((t) => t.norm)
    .join(" ");
}

function onlyWhitespaceBetween(text: string, a: Token, b: Token): boolean {
  return text.slice(a.end, b.start).trim() === "";
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * The rules that apply in a Round with these countries. A country rule beats a global rule for
 * the same phrase; when applicable country rules disagree, the phrase is left alone.
 */
export function selectRulesForCountries(
  rules: readonly CorrectionRule[],
  countryCodes: readonly string[],
): CorrectionRule[] {
  const countries = new Set(countryCodes.map((c) => c.toUpperCase()));
  const bySource = new Map<string, CorrectionRule[]>();
  for (const rule of rules) {
    const source = normalizeRuleSource(rule.source);
    if (!source) continue;
    const list = bySource.get(source) ?? [];
    list.push(rule);
    bySource.set(source, list);
  }
  const selected: CorrectionRule[] = [];
  for (const list of bySource.values()) {
    const scoped = list.filter(
      (r) => r.countryCode && countries.has(r.countryCode.toUpperCase()),
    );
    if (scoped.length > 0) {
      if (new Set(scoped.map((r) => r.replacement)).size === 1) selected.push(scoped[0]!);
      continue;
    }
    const global = list.find((r) => !r.countryCode);
    if (global) selected.push(global);
  }
  return selected;
}

export interface CompiledCorrectionRules {
  byFirstToken: Map<string, Array<{ tokens: string[]; replacement: string }>>;
}

/** Prepares rules for repeated use. Longer phrases are tried first. */
export function compileCorrectionRules(rules: readonly CorrectionRule[]): CompiledCorrectionRules {
  const byFirstToken: CompiledCorrectionRules["byFirstToken"] = new Map();
  for (const rule of rules) {
    const tokens = normalizeRuleSource(rule.source).split(" ").filter(Boolean);
    if (tokens.length === 0) continue;
    const list = byFirstToken.get(tokens[0]!) ?? [];
    list.push({ tokens, replacement: rule.replacement });
    byFirstToken.set(tokens[0]!, list);
  }
  for (const list of byFirstToken.values()) {
    list.sort((a, b) => b.tokens.length - a.tokens.length);
  }
  return { byFirstToken };
}

/**
 * Applies manual edits, then the longest whole-word rule at each position, to raw text.
 * Always starts from raw text, so it is idempotent and replacements are never re-matched.
 * An edit whose stored text no longer matches the raw text is ignored.
 */
export function applyCorrections(
  raw: string,
  rules: readonly CorrectionRule[] | CompiledCorrectionRules,
  edits: readonly CorrectionEdit[] = [],
): CorrectedText {
  const spans: CorrectionSpan[] = [];
  for (const e of edits) {
    if (e.charStart < 0 || e.charEnd <= e.charStart) continue;
    if (raw.slice(e.charStart, e.charEnd) !== e.originalText) continue;
    if (spans.some((s) => overlaps(s.rawStart, s.rawEnd, e.charStart, e.charEnd))) continue;
    spans.push({
      rawStart: e.charStart,
      rawEnd: e.charEnd,
      original: e.originalText,
      replacement: e.replacement,
      origin: "manual",
    });
  }

  const { byFirstToken } = "byFirstToken" in rules ? rules : compileCorrectionRules(rules);
  const manual = [...spans];
  const matched = manual.map((s) => ({ start: s.rawStart, end: s.rawEnd }));
  const tokens = tokenize(raw);
  for (let i = 0; i < tokens.length; ) {
    const match = (byFirstToken.get(tokens[i]!.norm) ?? []).find((rule) => {
      const last = tokens[i + rule.tokens.length - 1];
      if (!last) return false;
      for (let k = 0; k < rule.tokens.length; k++) {
        if (tokens[i + k]!.norm !== rule.tokens[k]) return false;
        if (k > 0 && !onlyWhitespaceBetween(raw, tokens[i + k - 1]!, tokens[i + k]!)) return false;
      }
      return !manual.some((s) => overlaps(s.rawStart, s.rawEnd, tokens[i]!.start, last.end));
    });
    if (!match) {
      i += 1;
      continue;
    }
    const rawStart = tokens[i]!.start;
    const rawEnd = tokens[i + match.tokens.length - 1]!.end;
    const original = raw.slice(rawStart, rawEnd);
    matched.push({ start: rawStart, end: rawEnd });
    if (original !== match.replacement) {
      spans.push({ rawStart, rawEnd, original, replacement: match.replacement, origin: "rule" });
    }
    i += match.tokens.length;
  }

  spans.sort((a, b) => a.rawStart - b.rawStart);
  let text = "";
  let cursor = 0;
  for (const s of spans) {
    text += raw.slice(cursor, s.rawStart) + s.replacement;
    cursor = s.rawEnd;
  }
  return { text: text + raw.slice(cursor), spans, matched };
}

function foldSounds(value: string): string {
  return value
    .replace(/[cqg]/g, "k")
    .replace(/z/g, "s")
    .replace(/v/g, "b")
    .replace(/w/g, "u")
    .replace(/y/g, "i")
    .replace(/h/g, "")
    .replace(/e(?=[aou])/g, "i")
    .replace(/a[ou]/g, "o")
    .replace(/o[ou]/g, "u")
    .replace(/(.)\1+/g, "$1");
}

function foldOnsets(value: string): string {
  return foldText(value)
    .replace(/[^a-z]/g, "")
    .replace(/^e(?=s[^aeiou])/, "")
    .replace(/^oa/, "ua")
    .replace(/ph/g, "f")
    .replace(/nh/g, "n")
    .replace(/lh/g, "l")
    .replace(/qu/g, "k")
    .replace(/c(?=[eiy])/g, "s");
}

/** Folds spellings that sound alike when Portuguese is heard through English. */
export function phoneticKey(value: string): string {
  return foldSounds(
    foldOnsets(value)
      .replace(/[sc]h/g, "x")
      .replace(/g(?=[eiy])/g, "j"),
  );
}

/** The same fold for Spanish sounds, where j, soft g and x are close to an English h. */
export function spanishPhoneticKey(value: string): string {
  return foldSounds(
    foldOnsets(value)
      .replace(/[sc]h/g, "\u0000")
      .replace(/^g(?=[ou])/, "")
      .replace(/g(?=[eiy])/g, "h")
      .replace(/[jx]/g, "h")
      .replace(/\u0000/g, "x"),
  );
}

function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return 1 - previous[b.length]! / longest;
}

/** Words that never count as a mishearing on their own. Callers can add a full dictionary. */
const BASE_COMMON_WORDS = new Set(
  `a about after again all also am an and any are around as at back be because been before being
  but by can could did do does doing done down each even every few first for from get go going good
  got had has have he her here him his how i if in into is it its just know like look looks made
  make many maybe me might more most much must my near need never new no north not now of off on
  once one only or other our out over place right road said same say see she should so some south
  still such sure take than that the their them then there these they thing think this those three
  through to too two under up us very want was way we well went were what when where which while who
  why will with would yeah yes you your parent parents party paris piano later people country
  guess guessed sign signs`
    .split(/\s+/)
    .filter(Boolean),
);

/** Words too grammatical to start or end a misheard place name. */
const FUNCTION_WORDS = new Set(
  `a about an and are as at be but by can could did do does for from had has have he her here him
  his how i if in into is it its just like me my no not now of on or our she so than that the their
  them then there these they this those to too up us was we were what when where which who why will
  with would yeah yes you your`
    .split(/\s+/),
);

/** Joining words inside Region names. A span ending in one is a cut-off name. */
const NAME_CONNECTORS = new Set(["de", "do", "da", "del", "dos", "das", "la", "el", "of"]);

/** Everyday names for Regions whose official name people do not say. */
const REGION_SPOKEN_NAMES: Readonly<Record<string, string>> = {
  "CL-AI": "Aysén",
  "CL-RM": "Santiago",
  "ES-MC": "Murcia",
  "ES-MD": "Madrid",
  "ES-VC": "Valencia",
};

const MIN_MATCH_LENGTH = 5;
const MAX_WINDOW_TOKENS = 4;
const MIN_SCORE = 0.78;
const MIN_LEAD = 0.08;
const MIN_SCORE_OVER_EXACT_PREFIX = 0.85;
const CONFIDENT_WORD_PROBABILITY = 0.85;

interface RegionCandidate {
  code: string;
  name: string;
  folded: string;
  compact: string;
  phonetic: string;
  spanish: string;
  tokens: Set<string>;
}

function compactOf(words: readonly string[]): string {
  return words.join("").replace(/[^a-z0-9]/g, "");
}

function makeCandidate(code: string, name: string): RegionCandidate {
  const words = tokenize(name).map((t) => t.norm);
  return {
    code,
    name,
    folded: words.join(" "),
    compact: compactOf(words),
    phonetic: phoneticKey(name),
    spanish: spanishPhoneticKey(name),
    tokens: new Set(words),
  };
}

const candidatesByCountry = new Map<string, readonly RegionCandidate[]>();

function countryCandidates(countryCode: string): readonly RegionCandidate[] {
  const key = countryCode.toUpperCase();
  const cached = candidatesByCountry.get(key);
  if (cached) return cached;
  const list: RegionCandidate[] = [];
  for (const region of regionsOf(key)) {
    list.push(makeCandidate(region.code, region.name));
    const spoken = REGION_SPOKEN_NAMES[region.code];
    if (spoken) list.push(makeCandidate(region.code, spoken));
  }
  const usable = list.filter((c) => c.compact.length >= MIN_MATCH_LENGTH);
  candidatesByCountry.set(key, usable);
  return usable;
}

function regionCandidates(countryCodes: readonly string[]): RegionCandidate[] {
  const byName = new Map<string, RegionCandidate>();
  for (const countryCode of new Set(countryCodes)) {
    for (const candidate of countryCandidates(countryCode)) {
      if (!byName.has(candidate.compact)) byName.set(candidate.compact, candidate);
    }
  }
  return [...byName.values()];
}

function scoreCandidate(
  compact: string,
  phonetic: string,
  spanish: string,
  c: RegionCandidate,
): number {
  const spelling = similarity(compact, c.compact);
  const portuguese = c.phonetic[0] === phonetic[0] ? similarity(phonetic, c.phonetic) : -1;
  const spanishSound = c.spanish[0] === spanish[0] ? similarity(spanish, c.spanish) : -1;
  const sound = Math.max(portuguese, spanishSound);
  return sound < 0 ? 0 : 0.3 * spelling + 0.7 * sound;
}

/** Whisper word probability for each text token, or null when words do not line up with text. */
function tokenProbabilities(
  text: string,
  tokens: readonly Token[],
  words: readonly WordTiming[],
): number[] | null {
  if (words.length === 0) return null;
  const located: Array<{ start: number; end: number; probability: number }> = [];
  let cursor = 0;
  for (const w of words) {
    const word = w.word.trim();
    if (!word) continue;
    const start = text.indexOf(word, cursor);
    if (start < 0) return null;
    cursor = start + word.length;
    located.push({ start, end: cursor, probability: w.probability });
  }
  const result: number[] = [];
  for (const token of tokens) {
    const covering = located.filter((w) => overlaps(w.start, w.end, token.start, token.end));
    if (covering.length === 0) return null;
    result.push(Math.min(...covering.map((w) => w.probability)));
  }
  return result;
}

/**
 * Finds likely misheard Region names among the given countries. Results are suggestions only:
 * a Round's location makes a name plausible, it is not evidence of what a Player said.
 * A span made entirely of ordinary words is never suggested.
 */
export function findRegionSuggestions(input: {
  text: string;
  words: readonly WordTiming[];
  countryCodes: readonly string[];
  /** Text with a one-off fix: no suggestion may touch it. */
  blockedRanges?: ReadonlyArray<{ start: number; end: number }>;
  /** Text a rule already ruled on: a suggestion may extend past it but not sit inside it. */
  ruledRanges?: ReadonlyArray<{ start: number; end: number }>;
  commonWords?: ReadonlySet<string>;
}): RegionSuggestion[] {
  const candidates = regionCandidates(input.countryCodes);
  if (candidates.length === 0) return [];
  const tokens = tokenize(input.text);
  const probabilities = tokenProbabilities(input.text, tokens, input.words);
  if (!probabilities) return [];
  const isPlainCommon = (word: string) =>
    BASE_COMMON_WORDS.has(word) || (input.commonWords?.has(word) ?? false);
  const isCommon = (word: string) =>
    isPlainCommon(word) ||
    word
      .replace(/'s$/, "")
      .split(/['-]/)
      .every((part) => part.length > 0 && isPlainCommon(part));

  type Window = RegionSuggestion & { canonical: boolean; tokenCount: number; matchedName: string };
  const windows: Window[] = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let n = 1; n <= MAX_WINDOW_TOKENS && i + n <= tokens.length; n++) {
      if (n > 1 && !onlyWhitespaceBetween(input.text, tokens[i + n - 2]!, tokens[i + n - 1]!)) break;
      const span = tokens.slice(i, i + n);
      const start = span[0]!.start;
      const end = span[n - 1]!.end;
      if (input.blockedRanges?.some((r) => overlaps(r.start, r.end, start, end))) continue;
      if (input.ruledRanges?.some((r) => r.start <= start && end <= r.end)) continue;

      const folded = span.map((t) => t.norm).join(" ");
      const canonical = candidates.find((c) => c.folded === folded);
      if (canonical) {
        windows.push({
          charStart: start,
          charEnd: end,
          originalText: input.text.slice(start, end),
          replacement: canonical.name,
          regionCode: canonical.code,
          score: 1,
          canonical: true,
          tokenCount: n,
          matchedName: canonical.folded,
        });
        continue;
      }

      const compact = compactOf(span.map((t) => t.norm));
      if (compact.length < MIN_MATCH_LENGTH) continue;
      const first = span[0]!.norm;
      const last = span[n - 1]!.norm;
      if (NAME_CONNECTORS.has(last)) continue;
      if (span.every((t) => isCommon(t.norm))) continue;

      const minProbability = Math.min(...probabilities.slice(i, i + n));
      if (n === 1 && compact.length < 6 && minProbability >= CONFIDENT_WORD_PROBABILITY) continue;

      const phonetic = phoneticKey(compact);
      const spanish = spanishPhoneticKey(compact);
      const scored = candidates
        .filter((c) => {
          if (Math.abs(c.compact.length - compact.length) > Math.max(3, c.compact.length * 0.4)) {
            return false;
          }
          if (FUNCTION_WORDS.has(first) && !c.tokens.has(first)) return false;
          return !FUNCTION_WORDS.has(last) || c.tokens.has(last);
        })
        .map((c) => ({ candidate: c, score: scoreCandidate(compact, phonetic, spanish, c) }))
        .sort((a, b) => b.score - a.score);

      const best = scored[0];
      if (!best || best.score < MIN_SCORE) continue;
      const rival = scored.find((s) => s.candidate.code !== best.candidate.code);
      if (rival && best.score - rival.score < MIN_LEAD) continue;
      windows.push({
        charStart: start,
        charEnd: end,
        originalText: input.text.slice(start, end),
        replacement: best.candidate.name,
        regionCode: best.candidate.code,
        score: Math.round(best.score * 1000) / 1000,
        canonical: false,
        tokenCount: n,
        matchedName: best.candidate.folded,
      });
    }
  }

  // A correct short name must not hide a garbled longer one that starts with it.
  const contenders = windows.filter(
    (w) =>
      !w.canonical ||
      !windows.some(
        (o) =>
          !o.canonical &&
          o.score >= MIN_SCORE_OVER_EXACT_PREFIX &&
          o.tokenCount > w.tokenCount &&
          o.charStart <= w.charStart &&
          o.charEnd >= w.charEnd &&
          o.matchedName.startsWith(`${w.matchedName} `),
      ),
  );
  contenders.sort(
    (a, b) => b.score - a.score || b.tokenCount - a.tokenCount || a.charStart - b.charStart,
  );
  const chosen: Window[] = [];
  for (const w of contenders) {
    if (chosen.some((c) => overlaps(c.charStart, c.charEnd, w.charStart, w.charEnd))) continue;
    chosen.push(w);
  }
  return chosen
    .filter((w) => !w.canonical)
    .sort((a, b) => a.charStart - b.charStart)
    .map(({ canonical: _c, tokenCount: _t, matchedName: _m, ...suggestion }) => suggestion);
}
