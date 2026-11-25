import { expect, test } from "@playwright/test";
import { login, seed, withSql } from "./helpers.js";

// #56 3b: Review's own refresh endpoint, its on-demand Claim drawer, the parity decisions, and Recall across Back.
const s = seed();
const review = `/duos/${s.duoId}/review`;

test.beforeEach(async ({ page }) => {
  await login(page, s.mikoId);
});

test("GET /review answers Review's payload; GET /claims/[id] is Duo-scoped", async ({ page }) => {
  const api = (path: string) => page.request.get(`/api/duos/${s.duoId}${path}`);
  const body = (await (await api("/review")).json()) as { duo: { id: string }; learnings: unknown[] };
  expect(body.duo.id).toBe(s.duoId);
  expect(body.learnings.length).toBeGreaterThan(0);

  expect((await api("/claims/not-a-uuid")).status()).toBe(400);
  expect((await api(`/claims/${crypto.randomUUID()}`)).status()).toBe(404);
  const claim = (await (await api(`/claims/${s.claimIds.bollards}`)).json()) as { claim: { text: string; imageUrls: string[] } };
  expect(claim.claim.text).toBe("Spanish bollards have a red band.");
  expect(claim.claim.imageUrls).toEqual([`/api/sources/images/${s.sourceImageId}?r=2`]);

  await login(page, s.outsiderId);
  expect((await api(`/claims/${s.claimIds.bollards}`)).status()).toBe(404);
  expect((await api("/review")).status()).toBe(404);
});

test("Review's Claim drawer fetches its Claim on demand and refetches on a claim event", async ({ page }) => {
  const claimRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes(`/api/duos/${s.duoId}/claims/`)) claimRequests.push(r.url());
  });
  await page.goto(`${review}?claim=${s.claimIds.bollards}`);
  await expect(page.getByRole("navigation", { name: "Duo" })).toHaveAttribute("data-stream", "open");
  const drawer = page.getByTestId("claim-drawer");
  await expect(drawer).toContainText("Spanish bollards have a red band.");
  await expect(drawer).toContainText("Verified");
  expect(claimRequests.length).toBeGreaterThan(0);
  try {
    // A vote from elsewhere: the claim event refetches the drawer's Claim.
    await page.request.post(`/api/claims/${s.claimIds.bollards}/evidence`, { data: { direction: "against" } });
    await expect(drawer).toContainText("Disputed");
  } finally {
    await page.request.post(`/api/claims/${s.claimIds.bollards}/evidence`, { data: { direction: null } });
  }
  await expect(drawer).toContainText("Verified");
  // The drawer's linked Learning pins it on Review without revealing anything.
  await drawer.locator("button", { hasText: "Learning:" }).click();
  await expect(page.locator(`[data-learning-row="${s.learningIds[1]}"]`)).toHaveAttribute("data-selected", "1");
});

test("parity: no Confusion Pairs or uncited-speech search on Review; Continent -> Country sets ?country=", async ({ page }) => {
  await page.goto(review);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Confusion Pairs")).toHaveCount(0);
  await expect(page.getByText("Atlas (Region → Country)")).toHaveCount(0);
  await expect(page.getByText("Continent → Country")).toBeVisible();
  const search = page.getByPlaceholder("Search Learnings (/)");
  await search.fill("Bollards again");
  await expect(page.getByText(/Uncited Raw Speech/)).toHaveCount(0);
  await search.fill("");
  await page.locator("aside button", { hasText: "Spain" }).first().click();
  await expect(page).toHaveURL(new RegExp(`${review}\\?country=ES$`));
  await page.reload();
  await expect(page.locator("[data-learning-row]")).toHaveCount(2);
});

test("a LearningRow's Claim chip opens the Claim drawer on Review", async ({ page }) => {
  const game1 = s.games[0]!;
  await withSql((sql) => sql`UPDATE learnings SET claim_id = ${s.claimIds.bollards} WHERE id = ${s.learningIds[0]!}`);
  try {
    await page.goto(`/duos/${s.duoId}/games/${game1.id}/rounds/1`);
    const row = page.locator(`[data-testid="learning-row"][data-learning-id="${s.learningIds[0]}"]`);
    const chip = row.locator('[data-entity-chip="claim"]');
    await expect(chip).toHaveAttribute("href", `${review}?claim=${s.claimIds.bollards}`);
    await chip.click();
    await expect(page.getByTestId("claim-drawer")).toContainText("Spanish bollards have a red band.");
  } finally {
    await withSql((sql) => sql`UPDATE learnings SET claim_id = NULL WHERE id = ${s.learningIds[0]!}`);
  }
});

test("gate: Recall survives Back", async ({ page }) => {
  await page.goto(review);
  await page.evaluate(([k]) => localStorage.setItem(k!, "1"), [`recall:v1:${s.mikoId}:${s.duoId}`]);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: /Recall ON/ })).toBeVisible();
  await page.getByTestId("section-stats").click();
  await expect(page).toHaveURL(/\/stats$/);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${review}$`));
  await expect(page.locator("html")).toHaveAttribute("data-recall", "on");
  await expect(page.getByRole("button", { name: /Recall ON/ })).toBeVisible();
  await expect(page.locator('[data-answer="learning-text"] .recall-mask-content').first()).toBeHidden();
  // A reload after Back keeps it too.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-recall", "on");
  await expect(page.locator('[data-answer="learning-text"] .recall-mask-content').first()).toBeHidden();
});

test("Review ships only cited speech; a Learning's Round card fetches its full Round on demand", async ({ page }) => {
  const data = await (await page.request.get(`${review}/__data.json`)).text();
  expect(data).toContain("Okay, Portugal it is");
  expect(data).not.toContain("Nice split, that saved us");
  const rounds = page.waitForRequest((r) => r.url().includes(`/api/duos/${s.duoId}/review/rounds?ids=`));
  await page.goto(`${review}?learning=${s.learningIds[0]}`);
  await rounds;
  // The full Round: its guesses and all three of its utterances, not only the two the Learning cites.
  await expect(page.getByText("Miko: ES · 4000pt").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Jump to Utterance" })).toHaveCount(3);
});
