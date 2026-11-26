import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { InstructionPurpose, ProcessingRunPurpose } from "@geo-coach/shared";
import type { ClueVocabulary } from "../services/clues.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolvePromptsDir(): string {
  const candidates = [
    process.env.PROMPTS_DIR,
    path.resolve(process.cwd(), "apps/web/prompts"),
    path.resolve(process.cwd(), "prompts"),
    path.resolve(__dirname, "../../../../prompts"),
  ].filter((p): p is string => Boolean(p));

  for (const dir of candidates) {
    if (existsSync(path.join(dir, "extract-v3.md"))) {
      return dir;
    }
  }
  return candidates[0] ?? path.resolve(process.cwd(), "prompts");
}

const CURRENT_VERSIONS: Record<InstructionPurpose, { version: string; file: string }> = {
  extract: { version: "extract-v3", file: "extract-v3.md" },
  tips: { version: "tips-v3", file: "tips-v3.md" },
  calls: { version: "calls-v1", file: "calls-v1.md" },
  clues: { version: "clues-v2", file: "clues-v2.md" },
  ingest: { version: "ingest-v2", file: "ingest-v2.md" },
  // Each Claim records this version when tagged; a newer one puts every Claim tagged by an older one back in the
  // tagging queue (#89). The prompt pins its vocabulary file, so a new vocabulary needs a new version here too.
  "clue-tag": { version: "clue-tag-v3", file: "clue-tag-v3.md" },
};

/** Every Claim tagger prompt version, oldest first: a trial job (#94) may run any of them. */
export const CLUE_TAG_PROMPT_VERSIONS = ["clue-tag-v1", "clue-tag-v2", "clue-tag-v3"] as const;

export function isClueTagPromptVersion(version: string): boolean {
  return (CLUE_TAG_PROMPT_VERSIONS as readonly string[]).includes(version);
}

export { comparePromptVersions } from "../services/clues.js";

export function getCurrentPromptVersion(purpose: ProcessingRunPurpose | "clue-tag"): string {
  return CURRENT_VERSIONS[purpose].version;
}

function promptEntry(purpose: InstructionPurpose, version?: string | null): { version: string; file: string } {
  if (!version || version === CURRENT_VERSIONS[purpose].version) return CURRENT_VERSIONS[purpose];
  if (purpose !== "clue-tag" || !isClueTagPromptVersion(version)) {
    throw new Error(`Unknown ${purpose} prompt version: ${version}`);
  }
  return { version, file: `${version}.md` };
}

/** `{{include file.md}}` on a line of its own pulls in another prompt file, such as the Clue vocabulary. */
const INCLUDE = /^\{\{include ([\w.-]+\.md)\}\}$/m;

/** A purpose's current instructions, or, for `clue-tag`, an earlier version a trial job runs (#94). */
export async function loadPromptInstructions(
  purpose: InstructionPurpose,
  version?: string | null,
): Promise<{ promptVersion: string; instructions: string }> {
  const entry = promptEntry(purpose, version);
  const dir = resolvePromptsDir();
  let instructions = await readFile(path.join(dir, entry.file), "utf8");
  for (let m = INCLUDE.exec(instructions); m; m = INCLUDE.exec(instructions)) {
    const included = await readFile(path.join(dir, m[1]!), "utf8");
    instructions = instructions.replace(m[0], included.trim());
  }
  return { promptVersion: entry.version, instructions };
}

/**
 * The Clue vocabulary (#90) as a list: each `N. **Family:** value · value` line of the vocabulary file. A family
 * whose values are left to the tagger reads `N. **Family:** _(…)_`.
 */
export function parseClueVocabulary(markdown: string, version: string): ClueVocabulary {
  const families: Array<{ family: string; seeds: string[] }> = [];
  for (const line of markdown.split("\n")) {
    const m = /^\d+\.\s+\*\*(.+?):\*\*\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const rest = m[2]!.trim();
    const seeds = rest.startsWith("_(") ? [] : rest.split(" · ").map((v) => v.trim()).filter(Boolean);
    families.push({ family: m[1]!.trim(), seeds });
  }
  return { version, families };
}

/**
 * The vocabulary a Claim tagger prompt includes (the current one unless a trial names another): its families bound
 * which Clues an agent may create.
 */
export async function loadClueVocabulary(version?: string | null): Promise<ClueVocabulary> {
  const dir = resolvePromptsDir();
  const entry = promptEntry("clue-tag", version);
  const prompt = await readFile(path.join(dir, entry.file), "utf8");
  const file = INCLUDE.exec(prompt)?.[1];
  if (!file) throw new Error(`${entry.file} includes no Clue vocabulary`);
  return parseClueVocabulary(await readFile(path.join(dir, file), "utf8"), file.replace(/\.md$/, ""));
}
