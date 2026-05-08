import type { DiffRenderableOptions } from "@opentui/core";

declare module "@opentui/solid/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      diff: DiffRenderableOptions & { ref?: any };
    }
  }
}
