/**
 * # postwire/wasm
 *
 * Reserved subpath for future WebAssembly-backed optimizations.
 *
 * This entrypoint intentionally exports nothing in v1. It exists so that a
 * future WASM addition (e.g. a Rust-compiled framing layer or ring-buffer
 * primitive) can ship as a non-breaking `import ... from "@sandwich/postwire/wasm"`
 * rather than a new package.
 *
 * The Phase 5 benchmark decision deferred WASM — the JavaScript framing layer
 * is CPU-bound but not GC-bound, and absolute throughput at 16 MB payloads
 * (~1.8 GB/s single-stream) is sufficient for the target use case.
 *
 * The baseline `"."` entrypoint runs under strict CSP without `wasm-unsafe-eval`
 * and will continue to do so. If a future WASM path ships here, it will be
 * explicitly opt-in — importing `@sandwich/postwire` alone will never require
 * `wasm-unsafe-eval`.
 *
 * @packageDocumentation
 * @module
 */
export {};
