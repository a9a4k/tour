export interface FileEntry {
  name: string;
}

export interface FolderNode<F extends FileEntry> {
  kind: "folder";
  path: string;
  displayName: string;
  children: TreeNode<F>[];
}

export interface FileNode<F extends FileEntry> {
  kind: "file";
  path: string;
  displayName: string;
  file: F;
}

export type TreeNode<F extends FileEntry> = FolderNode<F> | FileNode<F>;

export type VisibleRow<F extends FileEntry> =
  | {
      kind: "folder";
      path: string;
      displayName: string;
      depth: number;
      hasChildren: boolean;
      annotationCount: number;
      collapsed: boolean;
    }
  | {
      kind: "file";
      path: string;
      displayName: string;
      depth: number;
      file: F;
      annotationCount: number;
    };

function joinPath(parent: string, child: string): string {
  return parent === "" ? child : `${parent}/${child}`;
}

export function buildTree<F extends FileEntry>(files: F[]): FolderNode<F> {
  const root: FolderNode<F> = { kind: "folder", path: "", displayName: "", children: [] };
  for (const file of files) {
    const parts = file.name.split("/").filter((p) => p.length > 0);
    if (parts.length === 0) continue;
    let cursor: FolderNode<F> = root;
    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i];
      const isLeaf = i === parts.length - 1;
      const childPath = joinPath(cursor.path, segment);
      if (isLeaf) {
        cursor.children.push({ kind: "file", path: childPath, displayName: segment, file });
      } else {
        let next = cursor.children.find(
          (c): c is FolderNode<F> => c.kind === "folder" && c.path === childPath,
        );
        if (!next) {
          next = { kind: "folder", path: childPath, displayName: segment, children: [] };
          cursor.children.push(next);
        }
        cursor = next;
      }
    }
  }
  return root;
}

export function compress<F extends FileEntry>(root: FolderNode<F>): FolderNode<F> {
  return compressNode(root, true) as FolderNode<F>;
}

function compressNode<F extends FileEntry>(node: TreeNode<F>, isRoot: boolean): TreeNode<F> {
  if (node.kind === "file") return node;
  const compressedChildren = node.children.map((c) => compressNode(c, false));
  const merged: FolderNode<F> = {
    kind: "folder",
    path: node.path,
    displayName: node.displayName,
    children: compressedChildren,
  };
  if (isRoot) return merged;
  if (merged.children.length === 1) {
    const only = merged.children[0];
    if (only.kind === "folder") {
      return {
        kind: "folder",
        path: only.path,
        displayName: joinPath(merged.displayName, only.displayName),
        children: only.children,
      };
    }
  }
  return merged;
}

function compareSiblings<F extends FileEntry>(a: TreeNode<F>, b: TreeNode<F>): number {
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  return a.displayName.localeCompare(b.displayName);
}

function rollupAnnotations<F extends FileEntry>(
  node: TreeNode<F>,
  counts: Record<string, number>,
  cache: Map<string, number>,
): number {
  if (node.kind === "file") {
    return counts[node.path] ?? 0;
  }
  const cached = cache.get(node.path);
  if (cached !== undefined) return cached;
  let total = 0;
  for (const child of node.children) {
    total += rollupAnnotations(child, counts, cache);
  }
  cache.set(node.path, total);
  return total;
}

export function flatten<F extends FileEntry>(
  root: FolderNode<F>,
  collapsed: ReadonlySet<string>,
  annotationCounts: Record<string, number>,
): VisibleRow<F>[] {
  const out: VisibleRow<F>[] = [];
  const cache = new Map<string, number>();

  const visit = (node: TreeNode<F>, depth: number): void => {
    if (node.kind === "file") {
      out.push({
        kind: "file",
        path: node.path,
        displayName: node.displayName,
        depth,
        file: node.file,
        annotationCount: annotationCounts[node.path] ?? 0,
      });
      return;
    }
    const isCollapsed = collapsed.has(node.path);
    out.push({
      kind: "folder",
      path: node.path,
      displayName: node.displayName,
      depth,
      hasChildren: node.children.length > 0,
      annotationCount: rollupAnnotations(node, annotationCounts, cache),
      collapsed: isCollapsed,
    });
    if (isCollapsed) return;
    const sorted = [...node.children].sort(compareSiblings);
    for (const child of sorted) visit(child, depth + 1);
  };

  const sortedRoot = [...root.children].sort(compareSiblings);
  for (const child of sortedRoot) visit(child, 0);
  return out;
}

export function revealAncestors<F extends FileEntry>(
  root: FolderNode<F>,
  filePath: string,
): string[] {
  const path: string[] = [];
  const found = walk(root, filePath, path);
  return found ? path : [];
}

function walk<F extends FileEntry>(
  node: TreeNode<F>,
  filePath: string,
  ancestors: string[],
): boolean {
  if (node.kind === "file") {
    return node.path === filePath;
  }
  if (node.path !== "") ancestors.push(node.path);
  for (const child of node.children) {
    if (walk(child, filePath, ancestors)) return true;
  }
  if (node.path !== "") ancestors.pop();
  return false;
}
