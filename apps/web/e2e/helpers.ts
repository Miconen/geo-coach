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
  sourceId: string;
  sourceImageId: string;
  claimIds: { bollards: string; roundZero: string; white: string };
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

/** Runs SQL against the e2e database (for state changes no page can make, e.g. a membership removed mid-session). */
export async function withSql<T>(fn: (sql: import("postgres").Sql) => Promise<T>): Promise<T> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.E2E_DATABASE_URL ?? "postgres://geocoach:geocoach@localhost:5432/geocoach_e2e", { max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}
