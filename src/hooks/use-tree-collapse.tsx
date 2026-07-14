import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyCollapseToggle,
  useTreeCollapseStore,
} from "@/stores/tree-collapse-store";

interface TreeCollapseValue {
  collapsed: Set<string>;
  /** Toggle a directory's collapsed state. When `subtree` is true (alt-click),
   *  the clicked node's *new* state is applied to every path in `dirs` (which
   *  includes the clicked node itself). State lives above the node — not in it —
   *  so it survives the child unmount that collapsing a folder causes. */
  toggle: (path: string, dirs: string[], subtree: boolean) => void;
}

const TreeCollapseContext = createContext<TreeCollapseValue | null>(null);

/** Provides collapse state to a file tree. With `storageKey` set (e.g. per
 *  commit/stash) the state is kept in the session store and remembered across
 *  view switches; without it, state is local and resets when the tree unmounts. */
export function TreeCollapseProvider({
  storageKey,
  children,
}: {
  storageKey?: string;
  children: ReactNode;
}) {
  const [localSet, setLocalSet] = useState<Set<string>>(() => new Set());
  const storedArr = useTreeCollapseStore((s) => (storageKey ? s.byKey[storageKey] : undefined));
  const storeToggle = useTreeCollapseStore((s) => s.toggle);

  const collapsed = useMemo(
    () => (storageKey ? new Set(storedArr ?? []) : localSet),
    [storageKey, storedArr, localSet],
  );

  const toggle = useCallback(
    (path: string, dirs: string[], subtree: boolean) => {
      if (storageKey) storeToggle(storageKey, path, dirs, subtree);
      else setLocalSet((prev) => applyCollapseToggle(prev, path, dirs, subtree));
    },
    [storageKey, storeToggle],
  );

  const value = useMemo(() => ({ collapsed, toggle }), [collapsed, toggle]);
  return (
    <TreeCollapseContext.Provider value={value}>
      {children}
    </TreeCollapseContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- the hook shares the module-private context with its provider; splitting them buys nothing.
export function useTreeCollapse(): TreeCollapseValue {
  const ctx = useContext(TreeCollapseContext);
  if (!ctx) throw new Error("useTreeCollapse must be used within TreeCollapseProvider");
  return ctx;
}
