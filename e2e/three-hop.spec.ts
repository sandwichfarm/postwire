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

test("three-hop: worker → main relay → sandboxed iframe delivers 1 MB", async ({ page }) => {
  const done = page.waitForEvent("console", {
    predicate: (msg) => msg.text() === "DONE",
    timeout: 30_000,
  });
  await page.goto(`${server.url}/three-hop.html`);
  await done;
  expect(true).toBe(true);
});
