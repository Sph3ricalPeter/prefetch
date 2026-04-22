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

/** Recursively collect all file paths under a tree node (including nested directories). */
export function collectFilePaths(node: FileTreeNode): string[] {
  if (node.type === "file") return [node.path];
  const paths: string[] = [];
  for (const child of node.children) {
    paths.push(...collectFilePaths(child));
  }
  return paths;
}
