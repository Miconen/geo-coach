import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { PORT } from "../playwright.config.js";

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

/**
 * Runs SQL against the e2e database (for state changes no page can make, e.g. a membership removed mid-session),
 * then drops the server's cached derivations: a straight database write emits no changed event.
 */
export async function withSql<T>(fn: (sql: import("postgres").Sql) => Promise<T>): Promise<T> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.E2E_DATABASE_URL ?? "postgres://geocoach:geocoach@localhost:5432/geocoach_e2e", { max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
    const res = await fetch(`http://localhost:${PORT}/spike/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear-workbench" }),
    });
    if (!res.ok) throw new Error(`clear-workbench: ${res.status}`);
  }
}

/**
 * Opens a debrief page's details drawer: the Session page's "Session details" (#79: its Games, processing ranges,
 * run history and full Transcript), or the Game and Round pages' details (#82: what those pages held before).
 * Retries until the page has hydrated and the drawer shows.
 */
export async function openDetails(page: Page) {
  const drawer = page.getByTestId("drawer-details");
  await expect(async () => {
    if (!(await drawer.isVisible())) await page.getByTestId("chip-details").click();
    await expect(drawer).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/** Follows a debrief page's back link: screen-reader only until focused, so by keyboard (#79, #82). */
export async function followBackLink(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.getByTestId("back-link").focus();
  await page.keyboard.press("Enter");
}
