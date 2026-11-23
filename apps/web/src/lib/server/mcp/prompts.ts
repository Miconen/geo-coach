import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProcessingRunPurpose } from "@geo-coach/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolvePromptsDir(): string {
  const candidates = [
    process.env.PROMPTS_DIR,
    path.resolve(process.cwd(), "apps/web/prompts"),
    path.resolve(process.cwd(), "prompts"),
    path.resolve(__dirname, "../../../../prompts"),
  ].filter((p): p is string => Boolean(p));

  for (const dir of candidates) {
    if (existsSync(path.join(dir, "extract-v2.md"))) {
      return dir;
    }
  }
  return candidates[0] ?? path.resolve(process.cwd(), "prompts");
}

const CURRENT_VERSIONS: Record<ProcessingRunPurpose, { version: string; file: string }> = {
  extract: { version: "extract-v2", file: "extract-v2.md" },
  tips: { version: "tips-v2", file: "tips-v2.md" },
  calls: { version: "calls-v1", file: "calls-v1.md" },
};

export function getCurrentPromptVersion(purpose: ProcessingRunPurpose): string {
  return CURRENT_VERSIONS[purpose].version;
}

export async function loadPromptInstructions(
  purpose: ProcessingRunPurpose,
): Promise<{ promptVersion: string; instructions: string }> {
  const entry = CURRENT_VERSIONS[purpose];
  const filePath = path.join(resolvePromptsDir(), entry.file);
  const instructions = await readFile(filePath, "utf8");
  return { promptVersion: entry.version, instructions };
}
