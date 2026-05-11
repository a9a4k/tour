// Static shim that exists solely so Bun.build can find @pierre/diffs's
// worker module via the same module-resolution path that already works
// for main.tsx (sibling node_modules in the embedded /$bunfs filesystem).
//
// server.ts passes this file as a second Bun.build entrypoint; the output
// is served at /pierre-worker.js and consumed by `new Worker(...)` in
// main.tsx. Resolving the bare specifier here — instead of via
// import.meta.resolve from the compiled binary root — is what lets the
// shipped binary boot.
import "@pierre/diffs/worker/worker.js";
