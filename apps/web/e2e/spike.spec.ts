import { expect, test, type Page } from "@playwright/test";

// Router spike (#56 0-spike, ADR 0007): proves shallow routing on @sveltejs/kit 2.70.4 against spike-only
// routes (E2E_SPIKE=1). No product code is exercised here.

const store = (page: Page) => page.getByTestId("spike-store");
/** Waits until the layout mounted and its stream opened, so clicks go through the client router. */
async function open(page: Page, url: string) {
  await page.goto(url);
  await expect(store(page)).toHaveAttribute("data-opens", "1");
}
const control = (page: Page, body: Record<string, string>) => page.request.post("/spike/control", { data: body });

test.beforeEach(async ({ page }) => {
  await control(page, { action: "reset" });
});

test("same-route query navigation reruns the load only for keys it read", async ({ page }) => {
  await open(page, "/spike/items/A?duo=d1");
  await expect(page.getByTestId("load-count")).toHaveText("1");
  await page.getByRole("link", { name: "pin learning" }).click();
  await expect(page).toHaveURL(/learning=l1/);
  await expect(page.getByTestId("load-count")).toHaveText("1");
  await page.getByRole("link", { name: "other duo" }).click();
  await expect(page.getByTestId("duo")).toHaveText("other");
  await expect(page.getByTestId("load-count")).toHaveText("2");
});

test("shallow Back restores state without rerunning loaders or beforeNavigate", async ({ page }) => {
  await open(page, "/spike/items/A");
  await page.getByRole("button", { name: "filter es" }).click();
  await expect(page).toHaveURL(/f=es/);
  await page.getByRole("button", { name: "focus r1" }).click();
  await expect(page.getByTestId("focus")).toHaveText("r1");
  await expect(page).toHaveURL(/focus=r1/);
  await page.goBack();
  await expect(page.getByTestId("focus")).toHaveText("");
  await expect(page.getByTestId("filter")).toHaveText("es");
  await expect(page.getByTestId("load-count")).toHaveText("1");
  await expect(page.getByTestId("before-navigate")).toHaveText("0");
  await page.goForward();
  await expect(page.getByTestId("focus")).toHaveText("r1");
  await expect(page.getByTestId("load-count")).toHaveText("1");
});

test("Back from another route reruns the server load, so a revocation applies", async ({ page }) => {
  await open(page, "/spike/items/A");
  await page.getByRole("link", { name: "other route", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Other" })).toBeVisible();
  await control(page, { action: "revoke", id: "A" });
  await page.goBack();
  await expect(page.getByText("Revoked")).toBeVisible();
});

test("filter, focus, another route, Back and reload keep the address bar", async ({ page }) => {
  await open(page, "/spike/items/A");
  await page.getByRole("button", { name: "filter es" }).click();
  await page.getByRole("button", { name: "focus r1" }).click();
  const shallowUrl = page.url();
  expect(shallowUrl).toMatch(/f=es/);
  expect(shallowUrl).toMatch(/focus=r1/);
  await page.getByRole("link", { name: "other route", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Other" })).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("focus")).toHaveText("r1");
  expect(page.url()).toBe(shallowUrl);
  await page.reload();
  await expect(store(page)).toHaveAttribute("data-opens", "1");
  expect(page.url()).toBe(shallowUrl);
  await expect(page.getByTestId("focus")).toHaveText("r1");
  await expect(page.getByTestId("filter")).toHaveText("es");
});

for (const [name, link, landed] of [
  ["same-route id change", "item slowB", "/spike/items/slowB"],
  ["cross-route change", "other route slow", "/spike/other"],
] as const) {
  test(`an event during a held navigation is reconciled once after commit (${name})`, async ({ page }) => {
    await open(page, "/spike/items/A");
    await page.getByRole("link", { name: link, exact: true }).click();
    // The destination load sleeps 1.5 s; the event lands while the navigation is held. beforeNavigate fires a
    // tick after the click (the router resolves the route first), so wait until the navigation is in flight.
    await expect(store(page)).toHaveAttribute("data-in-flight", "1");
    const { id } = (await (await control(page, { action: "emit" })).json()) as { id: number };
    await expect(store(page)).toHaveAttribute("data-last-event", String(id));
    await expect(store(page)).toHaveAttribute("data-refreshes", "0");
    await expect(page).toHaveURL(new RegExp(landed));
    await expect(store(page)).toHaveAttribute("data-refreshes", "1");
    await expect(store(page)).toHaveAttribute("data-refreshed-for", landed);
    await expect(store(page)).toHaveAttribute("data-in-flight", "0");
    await expect(store(page)).toHaveAttribute("data-opens", "1");
  });
}

test("a stream reopen during a held navigation is one unscoped refresh after commit, with no replay", async ({ page }) => {
  await open(page, "/spike/items/A");
  await page.getByRole("link", { name: "item slowB", exact: true }).click();
  await expect(store(page)).toHaveAttribute("data-in-flight", "1");
  await control(page, { action: "drop" });
  await expect(store(page)).toHaveAttribute("data-opens", "2");
  await expect(store(page)).toHaveAttribute("data-refreshes", "0");
  await expect(page).toHaveURL(/\/spike\/items\/slowB/);
  await expect(store(page)).toHaveAttribute("data-refreshes", "1");
  await expect(store(page)).toHaveAttribute("data-last-event", "");
});
