// Compile-time embed slot for the webapp client + pierre worker bundles.
// Committed empty so dev mode (`bun src/main.ts serve`) falls through to
// server.ts's runtime Bun.build path. scripts/build-client.ts overwrites
// this file with real bundle strings during binary build; scripts/build-
// binary.ts restores the stub after `bun build --compile` finishes.
export const EMBEDDED_CLIENT_JS: string = "";
export const EMBEDDED_PIERRE_WORKER_JS: string = "";
