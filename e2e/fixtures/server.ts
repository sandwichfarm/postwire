import fs from "node:fs";
import http from "node:http";
import path from "node:path";

export interface FixtureServerOptions {
  /** CSP header per URL path (exact match) */
  cspByPath?: Record<string, string>;
  /** Other headers per URL path */
  headersByPath?: Record<string, Record<string, string>>;
}

export interface FixtureServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

export async function startFixtureServer(opts: FixtureServerOptions = {}): Promise<FixtureServer> {
  const cspByPath = opts.cspByPath ?? {};
  const headersByPath = opts.headersByPath ?? {};

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";

    // Serve dist/*.js as ES modules
    if (url.startsWith("/dist/")) {
      const file = path.join(process.cwd(), url.slice(1));
      if (!fs.existsSync(file)) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { "Content-Type": "application/javascript" });
      return res.end(fs.readFileSync(file));
    }

    // Serve fixture HTML pages
    const pageName = url === "/" ? "index.html" : url.slice(1);
    const pagePath = path.join(process.cwd(), "e2e/fixtures/pages", pageName);
    if (!fs.existsSync(pagePath)) {
      res.writeHead(404);
      return res.end(`Not found: ${pageName}`);
    }

    const headers: Record<string, string> = {
      "Content-Type": "text/html",
      ...(headersByPath[url] ?? {}),
    };
    if (cspByPath[url]) {
      headers["Content-Security-Policy"] = cspByPath[url];
    }

    res.writeHead(200, headers);
    res.end(fs.readFileSync(pagePath));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
