import type { DiffFile, DiffModel } from "./diff-model.js";

export interface FileContentPair {
  oldContent: string;
  newContent: string;
}

export type GitShow = (sha: string, path: string, cwd: string) => Promise<string>;

export interface FetchFileContentsOptions {
  baseSha: string;
  headSha: string;
  cwd: string;
  gitShow: GitShow;
}

function oldPath(file: DiffFile): string {
  return file.prevName ?? file.name;
}

export async function fetchFileContents(
  model: Pick<DiffModel, "files">,
  opts: FetchFileContentsOptions,
): Promise<Map<string, FileContentPair>> {
  const { baseSha, headSha, cwd, gitShow } = opts;
  const targets = model.files.filter((f) => f.type !== "binary");

  const pairs = await Promise.all(
    targets.map(async (file) => {
      const isNew = file.type === "new" || file.type === "add";
      const isDeleted = file.type === "deleted" || file.type === "delete";
      const [oldContent, newContent] = await Promise.all([
        isNew ? Promise.resolve("") : gitShow(baseSha, oldPath(file), cwd),
        isDeleted ? Promise.resolve("") : gitShow(headSha, file.name, cwd),
      ]);
      return [file.name, { oldContent, newContent }] as const;
    }),
  );

  return new Map(pairs);
}
