// Client-bundle cache shared by `tour serve` for `/client.js` and any
// auxiliary chunks/assets Bun emits.
//
// Two-mode cache (issue #202):
//
//  * Compiled binary: EMBEDDED_CLIENT_JS is baked into the binary at
//    compile time and never changes for the life of the process. We
//    cache forever — the first call materialises the map, every
//    subsequent call returns the same map.
//
//  * Dev mode (`bun src/main.ts serve`, `npm run cli serve`, etc.):
//    EMBEDDED constants are empty stubs, so the server runs Bun.build at
//    runtime. The cache is drop-through in dev: every call invokes the
//    builder. Concurrent calls share a single in-flight build so a page
//    load fetching `/client.js` does not trigger parallel builds.

export interface ClientAsset {
  body: string | ArrayBuffer;
  contentType: string;
}

export type AssetsResult =
  | { assets: Map<string, ClientAsset>; error: null }
  | { assets: null; error: string };

export interface ClientAssetsDeps {
  // Returns the embedded bundle string if running inside a compiled
  // binary (constant baked in at build time); null in dev mode.
  getEmbedded: () => { client: string } | null;
  // Build the bundle from source at runtime. Dev-mode only — the
  // compiled-binary path short-circuits before this is called.
  buildFromSource: () => Promise<AssetsResult>;
}

export function createClientAssetsCache(
  deps: ClientAssetsDeps,
): () => Promise<AssetsResult> {
  let cachedEmbedded: AssetsResult | null = null;
  let inFlightDevBuild: Promise<AssetsResult> | null = null;

  return async function getClientAssets(): Promise<AssetsResult> {
    const embedded = deps.getEmbedded();
    if (embedded !== null) {
      if (cachedEmbedded === null) {
        const assets = new Map<string, ClientAsset>();
        const ct = "application/javascript; charset=utf-8";
        assets.set("/client.js", { body: embedded.client, contentType: ct });
        cachedEmbedded = { assets, error: null };
      }
      return cachedEmbedded;
    }

    if (inFlightDevBuild !== null) return inFlightDevBuild;
    const build = deps.buildFromSource().finally(() => {
      if (inFlightDevBuild === build) inFlightDevBuild = null;
    });
    inFlightDevBuild = build;
    return build;
  };
}
