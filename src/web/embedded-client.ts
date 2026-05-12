// Compile-time embed slot for the webapp client + pierre worker bundles.
//
// `EMBEDDED_BUILD_MODE` is the explicit dev-vs-binary discriminator (issue
// #204). Committed as `"dev"`; the binary build pipeline flips it to
// `"binary"` atomically with populating the two bundle strings, then
// `scripts/build-binary.ts` restores the committed file after `bun --compile`
// finishes. Server.ts reads only the marker — the bundle strings'
// truthiness is no longer part of the discriminator, so an interrupted
// binary build that leaves the strings populated but the marker `"dev"`
// still falls through to the runtime Bun.build path.
export const EMBEDDED_BUILD_MODE: "dev" | "binary" = "dev";
export const EMBEDDED_CLIENT_JS: string = "";
export const EMBEDDED_PIERRE_WORKER_JS: string = "";

export function resolveEmbedded(
  mode: "dev" | "binary",
  client: string,
  worker: string,
): { client: string; worker: string } | null {
  return mode === "binary" ? { client, worker } : null;
}
