import { expect, test } from "@playwright/test";
import { login, seed, withSql } from "./helpers.js";

// #95: Knowledge › Clues queues Round tagging (clues runs) for every Session in one go, and says what it queued.
const s = seed();

/** The worker's lease heartbeat for no job: it keeps the worker online without claiming the jobs this queues. */
const workerAlive = (request: import("@playwright/test").APIRequestContext) =>
  request.post("/api/processor", {
    headers: { Authorization: "Bearer e2e-processor-secret" },
    data: { action: "heartbeat", jobId: "00000000-0000-7000-8000-000000000000" },
  });

const activeCluesJobs = async () =>
  (
    await withSql(
      (sql) =>
        sql<{ n: number }[]>`SELECT count(*)::int AS n FROM processing_jobs
          WHERE duo_id = ${s.duoId} AND purpose = 'clues' AND status IN ('queued', 'running')`,
    )
  )[0]!.n;

test("Tag Rounds in all Sessions queues the untagged Sessions' Rounds, then finds them queued", async ({ page }) => {
  const startedAt = new Date();
  try {
    await login(page, s.mikoId);
    expect((await workerAlive(page.request)).status()).toBe(200);

    await page.goto(`/duos/${s.duoId}/knowledge/clues`);
    const section = page.getByTestId("round-tagging");
    const start = section.getByTestId("round-tagging-start");
    await expect(start).toHaveText("Tag Rounds in all Sessions");
    await expect(start).toBeEnabled();
    await start.click();
    await expect(section.getByTestId("round-tagging-result")).toHaveText(
      /^Queued [1-9]\d* ranges? in [1-9]\d* Sessions? · \d+ ranges? already queued or running$/,
    );
    const active = await activeCluesJobs();
    expect(active).toBeGreaterThan(0);

    // Again: everything is already queued.
    await workerAlive(page.request);
    await start.click();
    await expect(section.getByTestId("round-tagging-result")).toHaveText(
      `Queued nothing new · ${active} range${active === 1 ? "" : "s"} already queued or running`,
    );
  } finally {
    await withSql((sql) => sql`DELETE FROM processing_jobs WHERE duo_id = ${s.duoId} AND created_at >= ${startedAt}`);
  }
});

test("Tag Rounds in all Sessions refuses while the worker is offline", async ({ page }) => {
  await login(page, s.mikoId);
  // No poll within PROCESSOR_ONLINE_MS (3 s): the worker is offline.
  await expect(async () => {
    expect((await page.request.post(`/api/duos/${s.duoId}/clues/rounds`)).status()).toBe(503);
  }).toPass({ timeout: 10_000 });
  const res = await page.request.post(`/api/duos/${s.duoId}/clues/rounds`);
  expect(await res.json()).toEqual({ error: "The processing worker is offline." });

  await page.goto(`/duos/${s.duoId}/knowledge/clues`);
  const start = page.getByTestId("round-tagging-start");
  await expect(start).toHaveText("Worker offline");
  await expect(start).toBeDisabled();
});
