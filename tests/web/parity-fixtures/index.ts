import type { ParityFixture } from "./types.js";
import { fixture as singleSmallFile } from "./single-small-file.js";
import { fixture as manyFiles } from "./many-files.js";
import { fixture as hiddenContext } from "./hidden-context.js";
import { fixture as orphanWindowAnnotations } from "./orphan-window-annotations.js";
import { fixture as fileRenames } from "./file-renames.js";
import { fixture as binaryFiles } from "./binary-files.js";
import { fixture as classifierCollapsed } from "./classifier-collapsed.js";
import { fixture as stackedAnnotations } from "./stacked-annotations.js";
import { fixture as deepLinkAnn } from "./deep-link-ann.js";
import { fixture as layoutSplitAndUnified } from "./layout-split-and-unified.js";
import { fixture as expansionApplied } from "./expansion-applied.js";

export const FIXTURES: ParityFixture[] = [
  singleSmallFile,
  manyFiles,
  hiddenContext,
  orphanWindowAnnotations,
  fileRenames,
  binaryFiles,
  classifierCollapsed,
  stackedAnnotations,
  deepLinkAnn,
  layoutSplitAndUnified,
  expansionApplied,
];

export type { ParityFixture } from "./types.js";
