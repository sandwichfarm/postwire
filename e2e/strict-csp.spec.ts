import { expect, test } from "@playwright/test";
import type { FixtureServer } from "./fixtures/server.js";
import { startFixtureServer } from "./fixtures/server.js";

let server: FixtureServer;

test.beforeAll(async () => {
  server = await startFixtureServer({
    // Apply strict CSP to the inner sandbox page that loads the library.
    // sandbox-inner.html uses an external module script (no inline), so
    // script-src 'self' allows /dist/index.js and /sandbox-inner-module.js
    // from same origin. No unsafe-eval needed — proves library is CSP-safe.
    cspByPath: {
      "/sandbox-inner.html": "default-src 'self'; script-src 'self'",
    },
  });
});

test.afterAll(async () => {
  await server.close();
});

test("strict-CSP page: library runs without unsafe-eval / wasm-unsafe-eval", async ({ page }) => {
  // Collect any CSP violation reports to verify no violations occur
  const cspViolations: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && msg.text().includes("Content Security Policy")) {
      cspViolations.push(msg.text());
    }
  });

  const done = page.waitForEvent("console", {
    predicate: (msg) => msg.text() === "DONE",
    timeout: 20_000,
  });
  await page.goto(`${server.url}/strict-csp.html`);
  await done;

  // No CSP violations should have occurred
  expect(cspViolations).toHaveLength(0);
  expect(true).toBe(true);
});
