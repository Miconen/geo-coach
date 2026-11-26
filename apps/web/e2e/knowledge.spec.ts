import { expect, test, type Page } from "@playwright/test";
import { login, openDetails, seed } from "./helpers.js";

// #56 3a: /knowledge, Claim drawers, Source excerpts, Evidence links, Home and the ?r=2 image namespace.
const s = seed();
const knowledge = `/duos/${s.duoId}/knowledge`;
const [game1, game2] = s.games;
const recallKey = (playerId: string) => `recall:v1:${playerId}:${s.duoId}`;
const claimCard = (page: Page, id: string) => page.locator(`[data-testid="knowledge-claim"][data-claim-id="${id}"]`);

async function openLive(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByRole("navigation", { name: "Duo" })).toHaveAttribute("data-stream", "open");
  await page.waitForLoadState("networkidle");
}

async function recallOn(page: Page, playerId = s.mikoId) {
  await page.goto(knowledge);
  await page.evaluate(([k]) => localStorage.setItem(k!, "1"), [recallKey(playerId)]);
}

const blockScripts = (page: Page) =>
  page.route("**/*", (route) => (route.request().resourceType() === "script" ? route.abort() : route.continue()));

test.beforeEach(async ({ page }) => {
  await login(page, s.mikoId);
});

test("/knowledge lists Sources and Claims, filters by ?country=, and refreshes after an MCP Claim edit", async ({ page }) => {
  await page.goto(`${knowledge}?country=pt`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("source-row")).toContainText("Spain guide");
  await expect(page.getByTestId("source-row")).toContainText("v1 of 1");
  await expect(page.getByTestId("country-filter")).toHaveText("PT ✕");
  await expect(page.getByTestId("claim-count")).toHaveText("1 Claim");
  await page.getByTestId("country-filter").click();
  await expect(page.getByTestId("claim-count")).toHaveText("3 Claims");
  await expect(page).toHaveURL(new RegExp(`${knowledge}$`));

  await openLive(page, knowledge);
  const token = (await (await page.request.post("/api/tokens", { data: { scope: "mcp", label: "e2e knowledge" } })).json()) as { rawToken: string };
  const edited = "Portuguese poles are white and round.";
  const res = await page.request.post("/mcp", {
    headers: { Authorization: `Bearer ${token.rawToken}`, Accept: "application/json, text/event-stream" },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "edit_claims", arguments: { duo: s.duoId, items: [{ claimId: s.claimIds.white, text: edited }] } },
    },
  });
  expect(res.status()).toBe(200);
  // The MCP write emits a claim event; the page refetches without a reload.
  await expect(claimCard(page, s.claimIds.white)).toContainText(edited);
});

test("Claim Evidence links its Round and Source section; a stored Round 0 stays plain text", async ({ page }) => {
  await page.goto(knowledge);
  const bollards = claimCard(page, s.claimIds.bollards);
  const roundChip = bollards.locator('[data-entity-chip="round"]');
  await expect(roundChip).toHaveAttribute("href", `/duos/${s.duoId}/games/${game1!.id}/rounds/2`);
  await roundChip.click();
  await expect(page).toHaveURL(new RegExp(`/games/${game1!.id}/rounds/2$`));
  // The Round page lists its citing Claims in a tab beside the transcript (#82).
  await expect(async () => {
    await page.getByTestId("round-tab-claims").click();
    await expect(page.getByTestId("round-claims")).toContainText("Citing Claims (1)", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.goBack();

  const sourceChip = claimCard(page, s.claimIds.bollards).locator('[data-entity-chip="source"]');
  await expect(sourceChip).toHaveAttribute("href", `/duos/${s.duoId}/knowledge/sources/${s.sourceId}?v=1&section=bollards#bollards`);
  await sourceChip.click();
  const excerpt = page.getByTestId("source-excerpt");
  await expect(excerpt).toContainText("Spanish bollards have a red band.");
  await expect(excerpt.locator("pre")).toHaveText("red band");
  const img = page.getByTestId("excerpt-image");
  await expect(img).toHaveAttribute("src", `/api/sources/images/${s.sourceImageId}?r=2`);
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.getByTestId("source-sections").getByRole("link", { name: "Poles" }).click();
  await expect(page.getByTestId("source-excerpt")).toContainText("Wooden poles.");

  // Round 0 Evidence: plain "Round 0", never a link (X7).
  await page.goto(knowledge);
  const zero = claimCard(page, s.claimIds.roundZero);
  await expect(zero.locator('[data-entity-text="round"]')).toContainText("Round 0");
  await expect(zero.locator('[data-entity-chip="round"]')).toHaveCount(0);
  // Linked Learnings pin on Review.
  await claimCard(page, s.claimIds.bollards).getByTestId("claim-learning-link").click();
  await expect(page).toHaveURL(new RegExp(`/review\\?learning=${s.learningIds[1]}$`));
  await expect(page.getByTestId("active-learning")).toContainText("Toledo region has dry hills.");
  void game2;
});

test("the Source route checks ?v= and ?section=, members only, and keeps the query through sign-in", async ({ page }) => {
  const src = `/duos/${s.duoId}/knowledge/sources/${s.sourceId}`;
  for (const v of ["0", "-1", "abc", "99", "2147483648"]) expect((await page.goto(`${src}?v=${v}`))!.status(), v).toBe(404);
  expect((await page.goto(`${src}?section=nope`))!.status()).toBe(200);
  await expect(page.getByTestId("section-missing")).toBeVisible();
  await expect(page.getByTestId("source-sections")).toContainText("Bollards");
  await page.request.post("/auth/logout");
  await page.goto(`${src}?v=1&section=poles`);
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(decodeURIComponent(new URL(page.url()).searchParams.get("next")!)).toBe(
    `/duos/${s.duoId}/knowledge/sources/${s.sourceId}?v=1&section=poles`,
  );
  await login(page, s.outsiderId);
  expect((await page.goto(src))!.status()).toBe(404);
});

test("the Claim drawer opens from ?claim= on /knowledge and Review, and says when a Claim is gone", async ({ page }) => {
  await page.goto(knowledge);
  await claimCard(page, s.claimIds.bollards).getByTestId("open-claim").click();
  await expect(page).toHaveURL(new RegExp(`\\?claim=${s.claimIds.bollards}$`));
  const drawer = page.getByTestId("claim-drawer");
  await expect(drawer).toContainText("Spanish bollards have a red band.");
  await drawer.getByTestId("claim-drawer-close").click();
  await expect(drawer).toHaveCount(0);

  await page.goto(`/duos/${s.duoId}/review?claim=${crypto.randomUUID()}`);
  await expect(page.getByTestId("claim-missing")).toHaveText("That Claim no longer exists.");
  // Review's Learning row carries a sibling Claim trigger.
  await page.goto(`/duos/${s.duoId}/review`);
  const row = page.locator(`[data-learning-row="${s.learningIds[1]}"]`);
  await row.getByTestId("learning-claim").click();
  await expect(page).toHaveURL(new RegExp(`/review\\?claim=${s.claimIds.bollards}$`));
  await expect(page.getByTestId("claim-drawer")).toContainText("Spanish bollards have a red band.");
});

test("with Recall on, /knowledge masks Claims, a masked Claim matches no search, and a cold ?claim= shows status and a reveal only", async ({ page }) => {
  await recallOn(page);
  await page.goto(knowledge);
  await expect(page.locator("html")).toHaveAttribute("data-recall", "on");
  await expect(page.getByText("Spanish bollards have a red band.").first()).toBeHidden();
  await page.getByTestId("claim-search").fill("white");
  await expect(page.getByTestId("claim-count")).toHaveText("0 Claims");
  await expect(page.getByTestId("knowledge-claim")).toHaveCount(0);
  await page.getByTestId("claim-search").fill("");
  await claimCard(page, s.claimIds.white).getByTestId("claim-reveal").click();
  await page.getByTestId("claim-search").fill("white");
  await expect(page.getByTestId("claim-count")).toHaveText("1 Claim");

  // Cold ?claim=: first paint (no scripts), then hydrated.
  const url = `${knowledge}?claim=${s.claimIds.bollards}`;
  for (const cold of [true, false]) {
    if (cold) await blockScripts(page);
    await page.goto(url);
    const drawer = page.getByTestId("claim-drawer");
    await expect(drawer.getByTestId("claim-drawer-status")).toBeVisible();
    await expect(drawer.getByTestId("claim-drawer-reveal")).toBeVisible();
    await expect(drawer.getByText("Spanish bollards have a red band.")).toBeHidden();
    await expect(drawer.locator('[data-entity-chip="round"]')).toBeHidden();
    if (cold) await page.unrouteAll();
  }
  await page.waitForLoadState("networkidle");
  const drawer = page.getByTestId("claim-drawer");
  await drawer.getByTestId("claim-drawer-reveal").click();
  await expect(drawer.getByText("Spanish bollards have a red band.")).toBeVisible();
  // Its linked Learning keeps its own reveal.
  await expect(drawer.getByTestId("claim-learning-link")).toBeVisible();
  await expect(drawer.getByText("Toledo region has dry hills.")).toBeHidden();
});

test("with Recall on, an Evidence chip to a Round masks its answers when hydrated and at first paint", async ({ page }) => {
  await recallOn(page);
  await page.goto(`${knowledge}?claim=${s.claimIds.bollards}`);
  await page.waitForLoadState("networkidle");
  const drawer = page.getByTestId("claim-drawer");
  await drawer.getByTestId("claim-drawer-reveal").click();
  await drawer.locator('[data-entity-chip="round"]').click();
  await expect(page).toHaveURL(new RegExp(`/rounds/2$`));
  await expect(page.getByTestId("debrief-reveal")).toBeVisible();
  await openDetails(page);
  await page.getByTestId("round-speech").locator("summary").click();
  await expect(page.getByTestId("round-reveal")).toBeVisible();
  await expect(page.getByTestId("round-utterances")).toBeHidden();
  const url = page.url();
  await blockScripts(page);
  await page.goto(url);
  await expect(page.locator("html")).toHaveAttribute("data-recall", "on");
  await expect(page.getByTestId("round-utterances")).toBeHidden();
});

test("Home routes X2 params, and the breadcrumb links it", async ({ page }) => {
  const home = `/duos/${s.duoId}`;
  await page.goto(`/duos/${s.duoId}/review`);
  await page.getByTestId("crumb-duo").click();
  await expect(page).toHaveURL(new RegExp(`${home}$`));
  await expect(page.getByTestId("home-latest-session")).toBeVisible();

  await page.goto(`${home}?run=${s.runId}`);
  await expect(page).toHaveURL(new RegExp(`/sessions/${s.sessionId}\\?run=${s.runId}#run-${s.runId}$`));
  await page.goto(`${home}?country=es`);
  await expect(page).toHaveURL(new RegExp(`/review\\?country=ES$`));
  await page.goto(`${home}?learning=${s.learningIds[0]}`);
  await expect(page).toHaveURL(new RegExp(`/review\\?learning=${s.learningIds[0]}$`));
  for (const q of [`run=${crypto.randomUUID()}`, `run=${s.otherRunId}`, `learning=${crypto.randomUUID()}`]) {
    expect((await page.goto(`${home}?${q}`))!.status()).toBe(200);
    await expect(page.getByTestId("home-missing")).toContainText("no longer exists");
  }
  for (const q of ["run=nope", "learning=nope", "country=zz"]) {
    expect((await page.goto(`${home}?${q}`))!.status()).toBe(200);
    await expect(page.getByTestId("home-missing")).toHaveCount(0);
  }
});

test("?r=2 images revalidate: primed in a member's cache, a non-member's reload gets 404", async ({ page }) => {
  const imageUrl = `/api/sources/images/${s.sourceImageId}?r=2`;
  const loaded: string[] = [];
  page.on("response", (r) => {
    if (r.url().endsWith(imageUrl)) loaded.push(r.headers()["cache-control"] ?? "");
  });
  // Prime from all three surfaces: an excerpt, a /knowledge card's Claim image and a Claim drawer's.
  await page.goto(`/duos/${s.duoId}/knowledge/sources/${s.sourceId}?section=bollards`);
  await expect.poll(() => page.getByTestId("excerpt-image").evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.goto(knowledge);
  await expect(claimCard(page, s.claimIds.bollards).locator(`img[src="${imageUrl}"]`)).toBeVisible();
  await page.goto(`${knowledge}?claim=${s.claimIds.bollards}`);
  await expect(page.getByTestId("claim-drawer").locator(`img[src="${imageUrl}"]`)).toBeVisible();
  expect(loaded.length).toBeGreaterThan(0);
  expect(loaded.every((c) => c === "private, no-cache")).toBe(true);

  await page.request.post("/auth/logout");
  await login(page, s.outsiderId);
  const res = await page.goto(imageUrl);
  expect(res!.status()).toBe(404);
});
