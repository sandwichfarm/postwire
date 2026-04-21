# Example 05: Strict-CSP iframe receives 512 KB

Demonstrates that the library's baseline path (postMessage + transferable ArrayBuffer, no SAB, no WASM) runs inside an iframe under `Content-Security-Policy: default-src 'self'; script-src 'self'` — no `unsafe-eval`, no `wasm-unsafe-eval`.

## Run

```sh
pnpm install
pnpm dev
```

Open the URL and click **Send 512 KB**. The iframe receives all chunks and the parent logs "DONE".

## What it shows

- Library baseline path is fully CSP-safe (no `eval`, no `new Function`, no inline scripts)
- Sandboxed iframe receiving data via a `MessagePort` handed in via `postMessage`
- `receiver.js` uses plain JS (no TypeScript) to avoid requiring a build step inside the iframe
- The `Content-Security-Policy` meta tag simulates strict-CSP; in production set via HTTP header

## CSP note

The meta CSP tag in `receiver.html` is a simulation. Browsers enforce HTTP response headers more strictly than meta tags for some directives. For production strict-CSP testing, configure your server to send the header. The library code itself is compatible regardless.
