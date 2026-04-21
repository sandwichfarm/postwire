import { expect, test } from "@playwright/test";
import type { FixtureServer } from "./fixtures/server.js";
import { startFixtureServer } from "./fixtures/server.js";

let server: FixtureServer;

test.beforeAll(async () => {
  server = await startFixtureServer();
});

test.afterAll(async () => {
  await server.close();
});

test.describe("two-party", () => {
  test("iframe ↔ parent delivers 1 MB", async ({ page }) => {
    const done = page.waitForEvent("console", {
      predicate: (msg) => msg.text() === "DONE",
      timeout: 20_000,
    });
    await page.goto(`${server.url}/two-party-iframe.html`);
    await done;
    expect(true).toBe(true);
  });

  test("worker ↔ main delivers 1 MB", async ({ page }) => {
    const done = page.waitForEvent("console", {
      predicate: (msg) => msg.text() === "DONE",
      timeout: 20_000,
    });
    await page.goto(`${server.url}/two-party-worker.html`);
    await done;
    expect(true).toBe(true);
  });
});
