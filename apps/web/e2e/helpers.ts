import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface Seed {
  duoId: string;
  otherDuoId: string;
  mikoId: string;
  soraId: string;
  outsiderId: string;
  sessionId: string;
  recordingId: string;
  runId: string;
  session2Id: string;
  run2Id: string;
  otherRunId: string;
  learningIds: string[];
  games: { id: string; geoguessrGameId: string; rounds: { id: string; roundNumber: number }[] }[];
}

export function seed(): Seed {
  return JSON.parse(readFileSync(path.resolve(__dirname, ".seed.json"), "utf8")) as Seed;
}

/** Signs in through the development login (NODE_ENV=development on the e2e server). */
export async function login(page: Page, playerId: string) {
  const res = await page.request.post("/auth/dev", { form: { playerId }, maxRedirects: 0 });
  if (res.status() !== 302) throw new Error(`dev login failed: ${res.status()}`);
}
