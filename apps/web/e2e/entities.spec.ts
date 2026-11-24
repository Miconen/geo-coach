import { expect, test, type Page } from "@playwright/test";
import { login, seed, withSql } from "./helpers.js";

// #56 2a(ii): Game, Round and Session pages, their links from existing surfaces, live refresh and Recall.
const s = seed();
const duo = `/duos/${s.duoId}`;
const game1 = s.games[0]!;
const game2 = s.games[1]!;
const SHIPPED = ["game", "round", "session"] as const;

/** Every chip whose target has shipped links, except X7's non-positive Rounds (plain "Round <n>"). */
async function expectNoDeadChips(page: Page) {
  for (const kind of SHIPPED) {
    const plain = page.locator(`[data-entity-text="${kind}"]`);
    const n = await plain.count();
    for (let i = 0; i < n; i++) {
      const text = (await plain.nth(i).innerText()).trim();
      expect(kind === "round" && /^Round (0|-\d+)\b/.test(text), `${kind} chip "${text}" should link`).toBe(true);
    }
  }
}

async function onlyOneH1(page: Page, name: RegExp | string) {
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText(name);
}

test.describe("entity pages", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, s.mikoId);
  });

  test("traversal from Recent Games: Game, Round, back to Game, Session, run", async ({ page }) => {
    await page.goto(`${duo}/review`);
    await expectNoDeadChips(page);
    await page.getByTestId("recent-game").first().getByRole("link").click();
    await expect(page).toHaveURL(/\/games\/[0-9a-f-]{36}$/);
    await onlyOneH1(page, /^vs /);
    await expect(page.getByTestId("breadcrumb")).toContainText("Games");
    await expectNoDeadChips(page);
    await page.getByTestId("round-strip").getByRole("link").first().click();
    await expect(page).toHaveURL(/\/rounds\/\d+$/);
    await onlyOneH1(page, /· Round \d+$/);
    await expect(page.getByTestId("breadcrumb")).toContainText("vs ");
    await page.getByTestId("back-link").click();
    await expect(page).toHaveURL(/\/games\/[0-9a-f-]{36}$/);
    await page.getByTestId("game-sessions").getByRole("link").first().click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${s.sessionId}$`));
    await onlyOneH1(page, /^Session /);
    await expect(page.locator(`#run-${s.runId}`)).toBeVisible();
    await expectNoDeadChips(page);
    // Reciprocal: the Session lists the Game that listed it.
    await expect(page.getByTestId("session-games").getByRole("link", { name: /vs / }).first()).toBeVisible();
  });

  test("traversal from the Session Game control and the Learning inspector", async ({ page }) => {
    // From 4 the Session Game control lives on the Session page (Review's Session pane is retired).
    await page.goto(`${duo}/review`);
    await page.waitForLoadState("networkidle");
    await page.locator(`[data-testid="session-link"][data-session-id="${s.sessionId}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${s.sessionId}$`));
    await page.getByTestId("session-games").getByRole("link", { name: /vs / }).first().click();
    await expect(page).toHaveURL(/\/games\/[0-9a-f-]{36}$/);

    await page.goto(`${duo}/review?learning=${s.learningIds[0]}`);
    await expect(page.getByTestId("from-session").getByRole("link")).toHaveCount(1);
    await page.getByTestId("from-game").getByRole("link", { name: /^Round/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/games/${game1.id}/rounds/\\d+$`));
    await page.goBack();
    await page.getByTestId("from-session").getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${s.sessionId}$`));
  });

  test("two clicks from any Duo page reach a Game, a Round and a Session", async ({ page }) => {
    for (const start of [`${duo}/review`, `${duo}/stats`, `${duo}/sessions/${s.session2Id}`]) {
      await page.goto(start);
      await page.getByTestId("section-games").click();
      await page.getByTestId("games-index-row").first().getByRole("link", { name: /^vs / }).click();
      await expect(page).toHaveURL(/\/games\/[0-9a-f-]{36}$/);
      await page.goto(start);
      await page.getByTestId("section-games").click();
      await page.getByTestId("round-strip").first().getByRole("link").first().click();
      await expect(page).toHaveURL(/\/rounds\/\d+$/);
      await page.goto(start);
      await page.getByTestId("section-sessions").click();
      await page.getByTestId("sessions-index-row").first().getByRole("link", { name: /^Session / }).click();
      await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/);
    }
  });

  test("a stored Round 0 renders as plain text everywhere and /rounds/0 is 404", async ({ page }) => {
    const zero = game2.rounds.find((r) => r.roundNumber === 0);
    expect(zero).toBeTruthy();
    await page.goto(`${duo}/games/${game2.id}`);
    await expect(page.getByTestId("round-strip").locator('[data-entity-text="round"]', { hasText: "Round 0" })).toHaveCount(1);
    await expect(page.getByTestId("round-strip").getByRole("link", { name: /^Round 0/ })).toHaveCount(0);
    await page.goto(`${duo}/games`);
    await expect(page.locator('[data-entity-text="round"]', { hasText: "Round 0" })).toHaveCount(1);
    expect((await page.goto(`${duo}/games/${game2.id}/rounds/0`))!.status()).toBe(404);
    expect((await page.goto(`${duo}/games/${game2.id}/rounds/-1`))!.status()).toBe(404);
    expect((await page.goto(`${duo}/games/${game2.id}/rounds/99999999999`))!.status()).toBe(404);
  });

  test("Game provenance: run-wide and Game-scoped counts, and the owning Session's anchor link", async ({ page }) => {
    await page.goto(`${duo}/games/${game1.id}`);
    await page.getByTestId("game-runs").locator("summary").click();
    const row = page.locator(`[data-testid="game-run"][data-run-id="${s.runId}"]`);
    await expect(row.getByTestId("run-wide-counts")).toContainText("Learnings: 2 current of 2 surviving");
    // Both seeded Learnings sit on Game 1 (one explicit, one derived): the second Game scopes none of them.
    await expect(row.getByTestId("game-scoped-counts")).toContainText("Learnings: 2 current of 2 surviving");
    await row.getByRole("link", { name: /^run / }).click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${s.sessionId}\\?run=${s.runId}#run-${s.runId}$`));
    await expect(page.locator(`#run-${s.runId}`)).toHaveAttribute("data-selected", "1");
  });

  test("three runs with a zero-output superseder count right on the Session page, cold and after an event", async ({ page }) => {
    const ids = await withSql(async (sql) => {
      const [r] = await sql<{ range_start: Date; range_end: Date }[]>`SELECT range_start, range_end FROM processing_runs WHERE id = ${s.runId}`;
      const zero = crypto.randomUUID();
      const open = crypto.randomUUID();
      await sql`INSERT INTO processing_runs (id, duo_id, session_id, started_by_player_id, purpose, agent, model, prompt_version, range_start, range_end, status, started_at, finished_at)
        VALUES (${zero}, ${s.duoId}, ${s.sessionId}, ${s.mikoId}, 'extract', 'claude', 'e2e-zero', 'e2e', ${r!.range_start}, ${r!.range_end}, 'finished', now(), now() + interval '1 second'),
               (${open}, ${s.duoId}, ${s.sessionId}, ${s.mikoId}, 'extract', 'claude', 'e2e-open', 'e2e', ${r!.range_start}, ${r!.range_end}, 'open', now(), null)`;
      return { zero, open };
    });
    try {
      await page.goto(`${duo}/sessions/${s.sessionId}`);
      const first = page.locator(`#run-${s.runId}`);
      await expect(first.getByTestId("run-counts")).toContainText("Learnings: 0 current of 2 surviving");
      await expect(first.getByTestId("run-superseded")).toContainText("2 outputs displaced, no replacement output");
      await expect(page.locator(`#run-${ids.open}`).getByTestId("run-counts")).toContainText("Learnings: 0 draft");
      await expect(page.locator(`#run-${ids.zero}`).getByTestId("run-counts")).toContainText("Learnings: 0 current of 0 surviving");
      // An event (a reaction) refreshes the page; counts stay right.
      await page.waitForLoadState("networkidle");
      const refresh = page.waitForRequest((r) => r.url().includes(`/sessions/${s.sessionId}/refresh`));
      await page.request.post(`/api/learnings/${s.learningIds[0]}/reactions`, { data: { reaction: "star" } });
      await refresh;
      await expect(first.getByTestId("run-counts")).toContainText("Learnings: 0 current of 2 surviving");
      await page.request.post(`/api/learnings/${s.learningIds[0]}/reactions`, { data: { reaction: "star" } });
    } finally {
      await withSql((sql) => sql`DELETE FROM processing_runs WHERE id IN (${ids.zero}, ${ids.open})`);
    }
  });

  test("an entity refresh 404 with the stream healthy says the Session no longer exists", async ({ page }) => {
    const id = crypto.randomUUID();
    await withSql((sql) => sql`INSERT INTO sessions (id, duo_id) VALUES (${id}, ${s.duoId})`);
    await page.goto(`${duo}/sessions/${id}`);
    await expect(page.getByRole("navigation", { name: "Duo" })).toHaveAttribute("data-stream", "open");
    await withSql((sql) => sql`DELETE FROM sessions WHERE id = ${id}`);
    await page.request.post(`/api/learnings/${s.learningIds[1]}/reactions`, { data: { reaction: "star" } });
    await expect(page.getByTestId("entity-missing")).toContainText("That Session no longer exists.");
    await expect(page.getByTestId("breadcrumb")).toBeVisible();
    await page.request.post(`/api/learnings/${s.learningIds[1]}/reactions`, { data: { reaction: "star" } });
  });

  test("a refresh carrying a foreign ?run= keeps the timeline and drops the pin", async ({ page }) => {
    const res = await page.request.get(`/api/duos/${s.duoId}/sessions/${s.sessionId}/refresh?run=${s.otherRunId}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { runs: { rows: { runId: string }[]; pinnedRun: unknown } };
    expect(body.runs.pinnedRun).toBeNull();
    expect(body.runs.rows.map((r) => r.runId)).toContain(s.runId);
    await page.goto(`${duo}/sessions/${s.sessionId}?run=${s.otherRunId}`);
    await expect(page.getByText("That run no longer exists.")).toBeVisible();
    await expect(page.locator(`#run-${s.runId}`)).toBeVisible();
    expect((await page.request.get(`/api/duos/${s.duoId}/sessions/nope/refresh`)).status()).toBe(400);
    expect((await page.request.get(`/api/duos/${s.duoId}/games/${s.otherRunId}/refresh`)).status()).toBe(404);
  });

  test("a reaction from a second tab refreshes an open Game page", async ({ page, context }) => {
    await page.goto(`${duo}/games/${game1.id}`);
    await expect(page.getByRole("navigation", { name: "Duo" })).toHaveAttribute("data-stream", "open");
    await page.waitForLoadState("networkidle");
    const refresh = page.waitForRequest((r) => r.url().includes(`/games/${game1.id}/refresh`));
    const other = await context.newPage();
    await other.request.post(`/api/learnings/${s.learningIds[0]}/reactions`, { data: { reaction: "done" } });
    await refresh;
    await other.request.post(`/api/learnings/${s.learningIds[0]}/reactions`, { data: { reaction: "done" } });
  });

  test("a Game upload reaches an open Session page", async ({ page }) => {
    await page.goto(`${duo}/sessions/${s.sessionId}`);
    await expect(page.getByRole("navigation", { name: "Duo" })).toHaveAttribute("data-stream", "open");
    await page.waitForLoadState("networkidle");
    const token = ((await (await page.request.post("/api/tokens", { data: { scope: "companion", label: "e2e" } })).json()) as { rawToken: string }).rawToken;
    const [game] = await withSql((sql) => sql<{ raw_duel: unknown; fetched_at: Date }[]>`SELECT raw_duel, fetched_at FROM games WHERE id = ${game1.id}`);
    const refresh = page.waitForRequest((r) => r.url().includes(`/sessions/${s.sessionId}/refresh`));
    const res = await page.request.post("/api/companion/geoguessr/games", {
      headers: { Authorization: `Bearer ${token}` },
      data: { duoId: s.duoId, geoguessrGameId: game1.geoguessrGameId, fetchedAt: new Date().toISOString(), rawDuel: game!.raw_duel },
    });
    expect(res.status()).toBeLessThan(300);
    await refresh;
  });

  test("a former member's delete-speech on their own Recording is refused and deletes nothing", async ({ page }) => {
    const count = () => withSql(async (sql) => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM utterances WHERE recording_id = ${s.recordingId}`)[0]!.n);
    const before = await count();
    await withSql((sql) => sql`DELETE FROM duo_memberships WHERE duo_id = ${s.duoId} AND player_id = ${s.mikoId}`);
    try {
      const res = await page.request.post(`/api/recordings/${s.recordingId}/delete-speech`, {
        data: { duoId: s.duoId, startUtc: "2026-01-01T00:00:00.000Z", endUtc: "2030-01-01T00:00:00.000Z" },
      });
      expect(res.status()).toBeGreaterThanOrEqual(400);
      expect(await count()).toBe(before);
    } finally {
      await withSql((sql) => sql`INSERT INTO duo_memberships (duo_id, player_id) VALUES (${s.duoId}, ${s.mikoId}) ON CONFLICT DO NOTHING`);
    }
  });

  test("keyboard walkthrough: Round to Game to Session to runs, with reciprocal links", async ({ page }) => {
    const round = game1.rounds.find((r) => r.roundNumber === 1)!;
    await page.goto(`${duo}/games/${game1.id}/rounds/${round.roundNumber}`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("back-link").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/games/${game1.id}$`));
    await page.getByTestId("game-sessions").getByRole("link").first().focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/sessions/${s.sessionId}$`));
    await page.getByTestId("session-games").getByRole("link").first().focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/games\/[0-9a-f-]{36}$/);
    await page.goBack();
    await page.locator(`#run-${s.runId}`).getByRole("link", { name: /^run / }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`\\?run=${s.runId}#run-${s.runId}$`));
  });

  test("narrow viewport: every destination fits without horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const round = game1.rounds.find((r) => r.roundNumber === 1)!;
    for (const [name, url] of [
      ["Review", `${duo}/review`],
      ["Games", `${duo}/games`],
      ["Game", `${duo}/games/${game1.id}`],
      ["Round", `${duo}/games/${game1.id}/rounds/${round.roundNumber}`],
      ["Sessions", `${duo}/sessions`],
      ["Session", `${duo}/sessions/${s.sessionId}`],
    ] as const) {
      await page.goto(url);
      await expect(page.locator("h1"), name).toHaveCount(1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${name} scrolls sideways`).toBeLessThanOrEqual(1);
    }
  });
});

test("Back-with-Recall: cold Round links and Back never reveal", async ({ page }) => {
  await login(page, s.mikoId);
  await page.goto("/settings");
  await page.evaluate((k) => localStorage.setItem(k, "1"), `recall:v1:${s.mikoId}:${s.duoId}`);
  const round = game1.rounds.find((r) => r.roundNumber === 1)!;
  await page.goto(`${duo}/games/${game1.id}/rounds/${round.roundNumber}?location=1#location`);
  await expect(page.getByTestId("round-location").locator(".recall-mask-content")).toBeHidden();
  const speech = page.getByTestId("round-speech");
  await speech.locator("summary").click();
  await expect(speech.getByText("You go Spain", { exact: false }).filter({ visible: true })).toHaveCount(0);
  await speech.getByTestId("round-reveal").click();
  await expect(speech.getByText("You go Spain", { exact: false }).filter({ visible: true }).first()).toBeVisible();
  await page.getByTestId("back-link").click();
  await expect(page).toHaveURL(new RegExp(`/games/${game1.id}$`));
  await page.goBack();
  await page.getByTestId("round-speech").locator("summary").click();
  await expect(page.getByTestId("round-speech").getByText("You go Spain", { exact: false }).filter({ visible: true })).toHaveCount(0);
  await expect(page.locator('[data-answer="learning-text"]').filter({ visible: true }).first()).toHaveText(/Hidden/);
});

test.describe("entity pages, live", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, s.mikoId);
  });
  const round1 = () => game1.rounds.find((r) => r.roundNumber === 1)!;
  const streamOpen = async (page: Page) => {
    await expect(page.getByRole("navigation", { name: "Duo" })).toHaveAttribute("data-stream", "open");
    await page.waitForLoadState("networkidle");
  };

  test("a stale recording heartbeat after the committed stop does not mark the Session recording", async ({ page }) => {
    await page.goto(`${duo}/sessions/${s.sessionId}`);
    await streamOpen(page);
    const token = ((await (await page.request.post("/api/tokens", { data: { scope: "companion", label: "e2e-hb" } })).json()) as { rawToken: string }).rawToken;
    const hb = await page.request.post("/api/companion/heartbeat", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        duoId: s.duoId,
        recordingId: s.recordingId,
        recording: true,
        uploadOk: true,
        pendingChunks: 0,
        transcriptionLagSec: 0,
        companionVersion: "0.1.0",
        geoguessrAuthOk: true,
      },
    });
    expect(hb.status()).toBe(200);
    await page.waitForTimeout(300);
    await expect(page.getByTestId("session-games").getByText("recording", { exact: true })).toHaveCount(0);
  });

  test("an offset that moves speech out of an open Round refreshes it", async ({ page }) => {
    await page.goto(`${duo}/games/${game1.id}/rounds/${round1().roundNumber}`);
    await streamOpen(page);
    const speech = page.getByTestId("round-speech");
    await speech.locator("summary").click();
    await expect(speech.getByTestId("round-utterances")).toContainText("You go Spain");
    try {
      await page.request.post(`/api/recordings/${s.recordingId}/offset-override`, { data: { manualOffsetOverrideMs: 3_600_000 } });
      await expect(speech.getByTestId("round-utterances")).not.toContainText("You go Spain");
    } finally {
      await page.request.post(`/api/recordings/${s.recordingId}/offset-override`, { data: { manualOffsetOverrideMs: null } });
    }
    await expect(speech.getByTestId("round-utterances")).toContainText("You go Spain");
  });

  test("a correction refreshes an open Round", async ({ page }) => {
    await page.goto(`${duo}/games/${game1.id}/rounds/${round1().roundNumber}`);
    await streamOpen(page);
    const speech = page.getByTestId("round-speech");
    await speech.locator("summary").click();
    const [u] = await withSql((sql) => sql<{ id: string }[]>`SELECT id FROM utterances WHERE recording_id = ${s.recordingId} AND text = 'Okay, Portugal it is'`);
    const res = await page.request.post(`/api/duos/${s.duoId}/corrections`, {
      data: { action: "fixUtterance", utteranceId: u!.id, find: "it is", replacement: "it was", scope: "once" },
    });
    expect(res.status()).toBeLessThan(300);
    await expect(speech.getByTestId("round-utterances")).toContainText("Okay, Portugal it was");
  });

  test("a Manual Learning cited to another Session's Round relates the Sessions by citation", async ({ page }) => {
    const [u] = await withSql((sql) => sql<{ id: string }[]>`SELECT u.id FROM utterances u JOIN recordings r ON r.id = u.recording_id WHERE r.session_id = ${s.session2Id} LIMIT 1`);
    await page.goto(`${duo}/games/${game1.id}`);
    await streamOpen(page);
    const res = await page.request.post("/api/learnings", {
      data: { duoId: s.duoId, kind: "clue", text: "Cross-Session note", detail: null, countries: [], regions: [], topics: [], utteranceIds: [u!.id], roundIds: [round1().id] },
    });
    expect(res.status()).toBeLessThan(300);
    const { id } = (await res.json()) as { id: string };
    try {
      await expect(page.getByTestId("game-sessions")).toContainText("Related by citation");
      await page.goto(`${duo}/sessions/${s.session2Id}`);
      await expect(page.getByTestId("session-games")).toContainText("Related by citation");
    } finally {
      await withSql((sql) => sql`DELETE FROM learnings WHERE id = ${id}`);
    }
  });

  test("a claim event updates run counts and resets a loaded older page", async ({ page }) => {
    const extra = await withSql(async (sql) => {
      const ids: string[] = [];
      for (let i = 0; i < 55; i++) {
        const id = crypto.randomUUID();
        ids.push(id);
        await sql`INSERT INTO processing_runs (id, duo_id, session_id, started_by_player_id, purpose, agent, model, prompt_version, range_start, range_end, status, started_at, finished_at)
          VALUES (${id}, ${s.duoId}, ${s.session2Id}, ${s.soraId}, 'calls', 'claude', 'e2e-bulk', 'e2e', now(), now(), 'finished', now() - interval '1 day', now() - interval '1 day' + ${i} * interval '1 second')`;
      }
      return { ids, claimId: crypto.randomUUID() };
    });
    try {
      await page.goto(`${duo}/sessions/${s.session2Id}`);
      await streamOpen(page);
      const rows = page.getByTestId("run-row");
      await page.getByRole("button", { name: /^Show \d+ older$/ }).click();
      await expect(rows).toHaveCount(50);
      await page.getByTestId("load-more-runs").click();
      await expect(rows).toHaveCount(56);
      const run2 = page.locator(`#run-${s.run2Id}`);
      await expect(run2.getByTestId("run-counts")).toContainText("Claims created: 0");
      // Written silently (as an MCP write would be), then announced by a claim event.
      await withSql((sql) => sql`INSERT INTO claims (id, duo_id, run_id, text) VALUES (${extra.claimId}, ${s.duoId}, ${s.run2Id}, 'Bollards are yellow')`);
      // A claim event (no run or Session id): the page refreshes counts and drops the older page.
      await page.request.post(`/api/claims/${extra.claimId}/evidence`, { data: { direction: "for" } });
      await expect(rows).toHaveCount(50);
      await page.getByTestId("load-more-runs").click();
      await expect(run2.getByTestId("run-counts")).toContainText("Claims created: 1");
    } finally {
      await withSql((sql) => sql`DELETE FROM claims WHERE id = ${extra.claimId}`);
      await withSql((sql) => sql`DELETE FROM processing_runs WHERE id = ANY(${extra.ids})`);
    }
  });
});
