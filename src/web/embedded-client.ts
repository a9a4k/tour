// Compile-time embed slot for the webapp client bundle.
//
// `EMBEDDED_BUILD_MODE` is the explicit dev-vs-binary discriminator (issue
// #204). Committed as `"dev"`; the binary build pipeline flips it to
// `"binary"` atomically with populating the bundle string, then
// `scripts/build-binary.ts` restores the committed file after `bun --compile`
// finishes. Server.ts reads only the marker — the bundle string's
// truthiness is no longer part of the discriminator, so an interrupted
// binary build that leaves the string populated but the marker `"dev"`
// still falls through to the runtime Bun.build path.
//
// Post-PRD #212 cutover, Pierre's renderer + worker are gone — only the
// client entry remains embedded.
export const EMBEDDED_BUILD_MODE: "dev" | "binary" = "dev";
export const EMBEDDED_CLIENT_JS: string = "";

export function resolveEmbedded(
  mode: "dev" | "binary",
  client: string,
): { client: string } | null {
  return mode === "binary" ? { client } : null;
}
