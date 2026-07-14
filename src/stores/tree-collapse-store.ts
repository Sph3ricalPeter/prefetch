import { create } from "zustand";

/** Apply a collapse toggle. `willCollapse` is decided by the clicked node's
 *  current state; on alt-click (`subtree`) that new state is applied to every
 *  path in `dirs` (which includes the clicked node), otherwise just to `path`. */
export function applyCollapseToggle(
  prev: Set<string>,
  path: string,
  dirs: string[],
  subtree: boolean,
): Set<string> {
  const next = new Set(prev);
  const willCollapse = !prev.has(path);
  for (const p of subtree ? dirs : [path]) {
    if (willCollapse) next.add(p);
    else next.delete(p);
  }
  return next;
}

interface TreeCollapseStore {
  // Session-scoped (not persisted to disk): collapsed folder paths per tree key,
  // e.g. `commit:<sha>` / `stash:<index>`. Arrays, not Sets, so state stays plain.
  byKey: Record<string, string[]>;
  toggle: (key: string, path: string, dirs: string[], subtree: boolean) => void;
}

export const useTreeCollapseStore = create<TreeCollapseStore>((set) => ({
  byKey: {},
  toggle: (key, path, dirs, subtree) =>
    set((state) => {
      const next = applyCollapseToggle(new Set(state.byKey[key] ?? []), path, dirs, subtree);
      return { byKey: { ...state.byKey, [key]: [...next] } };
    }),
}));
