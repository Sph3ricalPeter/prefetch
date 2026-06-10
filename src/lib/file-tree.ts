import type { FileStatus } from "@/types/git";

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  file?: FileStatus;
  children: FileTreeNode[];
}

export function buildFileTree(files: FileStatus[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts[i];
      let dir = current.find((n) => n.type === "directory" && n.name === dirName);
      if (!dir) {
        dir = {
          name: dirName,
          path: parts.slice(0, i + 1).join("/"),
          type: "directory",
          children: [],
        };
        current.push(dir);
      }
      current = dir.children;
    }
    current.push({
      name: parts[parts.length - 1],
      path: file.path,
      type: "file",
      file,
      children: [],
    });
  }
  // Sort: directories first, then files, alphabetically within each group
  const sortTree = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.type === "directory") sortTree(node.children);
    }
  };
  sortTree(root);
  return root;
}

/** Case-insensitive substring match of a file path against a (already
 *  lowercased) filter query. */
export function fileMatchesFilter(path: string, lowerQuery: string): boolean {
  return path.toLowerCase().includes(lowerQuery);
}

/** True when this node, or any file beneath it, matches the (lowercased) query.
 *  Used so a directory on the path to a match isn't dimmed. */
export function treeNodeMatchesFilter(
  node: FileTreeNode,
  lowerQuery: string,
): boolean {
  if (node.type === "file") return node.path.toLowerCase().includes(lowerQuery);
  return node.children.some((c) => treeNodeMatchesFilter(c, lowerQuery));
}

/** Recursively collect all file paths under a tree node (including nested directories). */
export function collectFilePaths(node: FileTreeNode): string[] {
  if (node.type === "file") return [node.path];
  const paths: string[] = [];
  for (const child of node.children) {
    paths.push(...collectFilePaths(child));
  }
  return paths;
}

/** Flatten a sorted tree into FileStatus[] in visual (DFS) order.
 *  Used so shift-click range selection matches what the user sees on screen. */
export function flattenTreeFiles(roots: FileTreeNode[]): FileStatus[] {
  const result: FileStatus[] = [];
  const walk = (nodes: FileTreeNode[]) => {
    for (const node of nodes) {
      if (node.type === "file" && node.file) {
        result.push(node.file);
      } else if (node.type === "directory") {
        walk(node.children);
      }
    }
  };
  walk(roots);
  return result;
}
