import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Camera,
  Check,
  ChevronRight,
  Clapperboard,
  Component,
  Cuboid,
  Image,
  Lightbulb,
  Loader2,
  Magnet,
  Mountain,
  Move3d,
  Navigation,
  Palette,
  Sparkles,
  Spline,
  SquareDashed,
  Volume2,
  Weight,
  type LucideIcon,
} from "lucide-react";
import { DiffToolbar } from "@/components/staging/diff-toolbar";
import { getUnityDiff } from "@/lib/commands";
import { resolveDiffRevs } from "@/lib/utils";
import { useRepoStore } from "@/stores/repo-store";
import type { DiffSource } from "@/hooks/use-expandable-context";
import type { UnityObjectChange, UnityPropChange } from "@/types/git";

interface UnityDiffViewerProps {
  filePath: string;
  source: DiffSource;
  staged: boolean;
  /** Changes whenever the line diff does, so the object diff refetches too. */
  refreshKey: unknown;
  onBack?: () => void;
}

interface Result {
  key: string;
  changes: UnityObjectChange[];
  error: string | null;
}

const KIND_STYLE = {
  added: { sign: "+", text: "text-green-400", bg: "bg-[var(--diff-added-bg)]" },
  removed: { sign: "−", text: "text-red-400", bg: "bg-[var(--diff-removed-bg)]" },
  modified: { sign: "~", text: "text-yellow-400", bg: "" },
} as const;

/**
 * Sign gutter, label, then one value column (unified) or before/after
 * (split). Tree depth indents inside the label column, so values stay aligned.
 */
const GRID = {
  unified: "grid grid-cols-[0.75rem_minmax(10rem,18rem)_1fr] items-center gap-x-2 px-3 text-xs",
  "side-by-side": "grid grid-cols-[0.75rem_minmax(10rem,18rem)_1fr_1fr] items-stretch gap-x-2 px-3 text-xs",
} as const;

/** A whole-line tint per side, like the line diff's added/removed rows. */
const LINE = {
  old: { sign: "−", text: "text-red-400", bg: "bg-[var(--diff-removed-line-bg)]" },
  new: { sign: "+", text: "text-green-400", bg: "bg-[var(--diff-added-line-bg)]" },
} as const;

/** Tree indentation, one step per level; deeper levels share the last step. */
const DEPTH = ["pl-0", "pl-4", "pl-8", "pl-12", "pl-16", "pl-20", "pl-24", "pl-28", "pl-32"] as const;
const indent = (depth: number) => DEPTH[Math.min(depth, DEPTH.length - 1)];

type Layout = keyof typeof GRID;

/** Objects that stand for the hierarchy node itself rather than a component on it. */
const isOwner = (c: UnityObjectChange) => c.class_name === "GameObject" || c.class_name === "PrefabInstance";

interface TreeNode {
  name: string;
  /** Hierarchy path below the stripped root; also the collapse key. */
  path: string;
  /** The node's GameObject / prefab instance change, if it changed itself. */
  owner: UnityObjectChange | null;
  components: UnityObjectChange[];
  children: TreeNode[];
}

/**
 * Hierarchy tree of the changes. When every path shares its first segment —
 * the prefab's root, or a single asset — that segment is dropped: the file
 * already names it.
 */
function buildTree(changes: UnityObjectChange[]): TreeNode {
  const firsts = new Set(changes.map((c) => c.path.split("/")[0]));
  const strip = firsts.size === 1 ? [...firsts][0] : null;
  const root: TreeNode = { name: "", path: "", owner: null, components: [], children: [] };
  const nodes = new Map<string, TreeNode>([["", root]]);
  for (const change of changes) {
    const rel = strip === null ? change.path : change.path === strip ? "" : change.path.slice(strip.length + 1);
    let node = root;
    for (const segment of rel ? rel.split("/") : []) {
      const path = node.path ? `${node.path}/${segment}` : segment;
      let child = nodes.get(path);
      if (!child) {
        child = { name: segment, path, owner: null, components: [], children: [] };
        nodes.set(path, child);
        node.children.push(child);
      }
      node = child;
    }
    // The root has no header row, so its own GameObject shows like a
    // component; so does a same-named sibling's, rather than being dropped.
    // ponytail: same-named siblings share one node (paths are names); give
    // changes hierarchy ids if that confuses.
    if (isOwner(change) && node !== root && !node.owner) node.owner = change;
    else node.components.push(change);
  }
  for (const node of nodes.values()) {
    // Inspector order: GameObject, then Transform, then the rest.
    const rank = (c: UnityObjectChange) =>
      c.class_name === "GameObject" ? 0 : c.class_name.endsWith("Transform") ? 1 : 2;
    node.components.sort((a, b) => rank(a) - rank(b));
  }
  return root;
}

/**
 * Past this many changed objects the tree starts folded, so a mass
 * reserialization doesn't mount tens of thousands of rows at once.
 */
const FOLD_BY_DEFAULT_OVER = 200;

/** Object-level diff of a Unity YAML asset, as a hierarchy tree. */
export function UnityDiffViewer({ filePath, source, staged, refreshKey, onBack }: UnityDiffViewerProps) {
  const { commitId, stashIndex } = source;
  const requestKey = `${filePath}|${commitId ?? ""}|${stashIndex ?? ""}|${staged}`;
  // Keyed by request: a refresh of the same file keeps showing the previous
  // result until the new one lands, a different file shows the spinner.
  const [result, setResult] = useState<Result | null>(null);
  const layout = useRepoStore((s) => s.diffViewMode);
  // Same sticky preference as the line diff's Expand; per-object clicks flip it.
  const expandPref = useRepoStore((s) => s.diffExpandContext);
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  // Nodes and components the user flipped from their default (open, or folded
  // for huge diffs).
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const { oldRev, newRev } = resolveDiffRevs({ commitId, stashIndex }, staged);
    getUnityDiff(filePath, oldRev, newRev)
      .then((changes) => ({ changes, error: null }))
      .catch((e: unknown) => ({ changes: [], error: String(e) }))
      .then((r) => {
        if (!cancelled) setResult({ key: requestKey, ...r });
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, commitId, stashIndex, staged, requestKey, refreshKey]);

  const current = result?.key === requestKey ? result : null;
  const changes = useMemo(() => current?.changes ?? [], [current]);
  const tree = useMemo(() => buildTree(changes), [changes]);
  const keys = useMemo(
    () => new Map(changes.map((c, i) => [c, `${c.path}|${c.type_name}|${i}`])),
    [changes],
  );
  const isExpanded = (change: UnityObjectChange) => expandPref !== flipped.has(keys.get(change) ?? "");
  // The toolbar reflects the objects, so expanding each one by hand flips it to "Fold".
  const expandable = changes.filter((c) => c.props.some((p) => !p.changed));
  const allExpanded = expandable.length > 0 && expandable.every(isExpanded);
  const toggleIn = (set: typeof setFlipped, key: string) =>
    set((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const ctx: TreeCtx = {
    layout,
    isExpanded,
    toggleExpanded: (c) => toggleIn(setFlipped, keys.get(c) ?? ""),
    isFolded: (key) => (changes.length > FOLD_BY_DEFAULT_OVER) !== folded.has(key),
    toggleFolded: (key) => toggleIn(setFolded, key),
    keyOf: (c) => keys.get(c) ?? "",
  };

  return (
    <div className="flex flex-col h-full">
      <DiffToolbar
        filePath={filePath}
        onBack={onBack}
        isExpanded={allExpanded}
        onExpandAll={() => setFlipped(new Set())}
        onCollapseAll={() => setFlipped(new Set())}
      />
      {!current ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : current.error ? (
        <Message text={current.error} />
      ) : changes.length === 0 ? (
        <Message text="No object-level changes — toggle Semantic off to see the raw diff" />
      ) : (
        <div className="flex-1 overflow-auto pb-2">
          <Summary changes={changes} layout={layout} />
          <NodeBody node={tree} depth={0} ctx={ctx} />
        </div>
      )}
    </div>
  );
}

interface TreeCtx {
  layout: Layout;
  isExpanded: (change: UnityObjectChange) => boolean;
  toggleExpanded: (change: UnityObjectChange) => void;
  isFolded: (key: string) => boolean;
  toggleFolded: (key: string) => void;
  keyOf: (change: UnityObjectChange) => string;
}

function Message({ text }: { text: string }) {
  return <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">{text}</div>;
}

function Summary({ changes, layout }: { changes: UnityObjectChange[]; layout: Layout }) {
  const count = (kind: UnityObjectChange["kind"]) => changes.filter((c) => c.kind === kind).length;
  return (
    <div className="sticky top-0 z-10 border-b border-border bg-background py-1.5 text-xs text-muted-foreground">
      <div className="flex gap-3 px-3">
        <span>{changes.length} objects changed</span>
        <span className="text-green-400">+{count("added")}</span>
        <span className="text-red-400">−{count("removed")}</span>
        <span className="text-yellow-400">~{count("modified")}</span>
      </div>
      {layout === "side-by-side" && (
        <div className={`${GRID[layout]} pt-1`}>
          <span />
          <span />
          <span className="px-2 text-caption uppercase tracking-wide">Before</span>
          <span className="px-2 text-caption uppercase tracking-wide">After</span>
        </div>
      )}
    </div>
  );
}

/** A node's components, then its child nodes. */
function NodeBody({ node, depth, ctx }: { node: TreeNode; depth: number; ctx: TreeCtx }) {
  return (
    <>
      {node.components.map((c) => (
        <ComponentBlock key={ctx.keyOf(c)} change={c} depth={depth} ctx={ctx} />
      ))}
      {node.children.map((child) => (
        <TreeNodeRow key={child.path} node={child} depth={depth} ctx={ctx} />
      ))}
    </>
  );
}

/** A GameObject (or nested prefab) in the hierarchy. */
function TreeNodeRow({ node, depth, ctx }: { node: TreeNode; depth: number; ctx: TreeCtx }) {
  const foldKey = `node:${node.path}`;
  const open = !ctx.isFolded(foldKey);
  const owner = node.owner;
  const prefab = owner?.class_name === "PrefabInstance";
  return (
    <div className="border-t border-border">
      <Header
        kind={owner?.kind ?? null}
        depth={depth}
        open={open}
        onToggle={() => ctx.toggleFolded(foldKey)}
        icon={<Box className={`h-3.5 w-3.5 ${prefab ? "text-sky-400" : "text-muted-foreground"}`} />}
        title={<span className="font-medium text-foreground">{node.name}</span>}
        // A nested prefab is named after its instance; show what it's an instance of.
        subtitle={prefab ? owner.type_name : null}
      />
      {open && (
        <>
          {owner && <Props change={owner} depth={depth + 1} ctx={ctx} />}
          <NodeBody node={node} depth={depth + 1} ctx={ctx} />
        </>
      )}
    </div>
  );
}

/** A component (or the asset's single object) with its properties. */
function ComponentBlock({ change, depth, ctx }: { change: UnityObjectChange; depth: number; ctx: TreeCtx }) {
  const foldKey = `component:${ctx.keyOf(change)}`;
  const open = !ctx.isFolded(foldKey);
  return (
    <div>
      <Header
        kind={change.kind}
        depth={depth}
        open={open}
        onToggle={() => ctx.toggleFolded(foldKey)}
        icon={<ComponentIcon change={change} />}
        title={<span className="text-foreground">{change.type_name}</span>}
        subtitle={null}
      />
      {open && <Props change={change} depth={depth + 1} ctx={ctx} />}
    </div>
  );
}

function Header({
  kind,
  depth,
  open,
  onToggle,
  icon,
  title,
  subtitle,
}: {
  kind: UnityObjectChange["kind"] | null;
  depth: number;
  open: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  title: React.ReactNode;
  subtitle: string | null;
}) {
  const style = kind ? KIND_STYLE[kind] : null;
  return (
    <button
      onClick={onToggle}
      className={`flex w-full items-center gap-2 px-3 py-1 text-left text-xs transition-colors hover:bg-secondary/50 ${style?.bg ?? ""}`}
    >
      <span className={`w-3 shrink-0 text-center font-medium ${style?.text ?? ""}`}>{style?.sign}</span>
      <span className={`flex min-w-0 items-center gap-1.5 ${indent(depth)}`}>
        <ChevronRight className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
        <span className="truncate">{title}</span>
        {subtitle && <span className="shrink-0 text-muted-foreground">{subtitle}</span>}
      </span>
    </button>
  );
}

/** Built-in component icons, approximating the Editor's (which can't be bundled). */
const ICONS: [RegExp, LucideIcon][] = [
  [/^GameObject$/, Box],
  [/Transform$/, Move3d],
  [/^ParticleSystem/, Sparkles],
  [/^(Line|Trail)Renderer$/, Spline],
  [/^Sprite/, Image],
  [/Mesh|Renderer|LODGroup/, Cuboid],
  [/Rigidbody/, Weight],
  [/Collider|CharacterController/, SquareDashed],
  [/Joint/, Magnet],
  [/Light|Probe/, Lightbulb],
  [/Camera/, Camera],
  [/Audio/, Volume2],
  [/Anim/, Clapperboard],
  [/Material/, Palette],
  [/NavMesh/, Navigation],
  [/Terrain/, Mountain],
];

function ComponentIcon({ change }: { change: UnityObjectChange }) {
  if (change.class_name === "MonoBehaviour") {
    return <span className="rounded-xs border border-border px-0.5 text-caption font-semibold leading-none text-muted-foreground">C#</span>;
  }
  const Icon = ICONS.find(([pattern]) => pattern.test(change.class_name))?.[1] ?? Component;
  return <Icon className="h-3.5 w-3.5 text-muted-foreground" />;
}

/** Properties of one object, with section headings and the unchanged toggle. */
function Props({ change, depth, ctx }: { change: UnityObjectChange; depth: number; ctx: TreeCtx }) {
  const expanded = ctx.isExpanded(change);
  const unchanged = change.props.filter((p) => !p.changed).length;
  const visible = expanded ? change.props : change.props.filter((p) => p.changed);
  const pad = indent(depth);
  return (
    <div className="pb-1">
      {visible.map((p, i) => (
        <PropRow
          key={`${p.key}|${i}`}
          prop={p}
          layout={ctx.layout}
          pad={pad}
          heading={i === 0 || visible[i - 1].section !== p.section ? p.section : ""}
        />
      ))}
      {unchanged > 0 && (
        <div className={GRID[ctx.layout]}>
          <span />
          <button
            onClick={() => ctx.toggleExpanded(change)}
            className={`${pad} py-0.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground`}
          >
            {expanded ? "Hide unchanged" : `${unchanged} unchanged`}
          </button>
        </div>
      )}
    </div>
  );
}

function PropRow({ prop, layout, pad, heading }: { prop: UnityPropChange; layout: Layout; pad: string; heading: string }) {
  const changed = prop.changed && prop.old !== prop.new;
  const label = (
    <span
      className={`truncate ${pad} ${changed ? "text-foreground" : "text-muted-foreground group-hover/prop:text-foreground"}`}
      title={prop.key}
    >
      {prop.label}
    </span>
  );
  let rows: React.ReactNode;
  if (layout === "side-by-side") {
    // One line; each half tinted like a split hunk.
    const sign = !changed ? null : prop.old === null ? LINE.new : prop.new === null ? LINE.old : null;
    const cell = (side: Side, value: string | null) => (
      <span className={`flex min-w-0 items-center px-2 py-0.5 ${changed && value !== null ? LINE[side].bg : ""}`}>
        <Field prop={prop} side={changed ? side : null} />
      </span>
    );
    rows = (
      <div className={GRID[layout]}>
        <span className={`self-center text-center ${sign ? sign.text : "text-yellow-400"}`}>
          {sign ? sign.sign : changed ? "~" : ""}
        </span>
        <span className="flex min-w-0 items-center">{label}</span>
        {cell("old", prop.old)}
        {cell("new", prop.new)}
      </div>
    );
  } else if (!changed) {
    rows = (
      <div className={`${GRID[layout]} py-0.5`}>
        <span />
        {label}
        <Field prop={prop} side={null} />
      </div>
    );
  } else {
    // Stacked like a unified hunk: a tinted − line above a tinted + line.
    const sides = (["old", "new"] as const).filter((side) => prop[side] !== null);
    rows = sides.map((side) => (
      <div key={side} className={`${GRID[layout]} py-0.5 ${LINE[side].bg}`}>
        <span className={`text-center ${LINE[side].text}`}>{LINE[side].sign}</span>
        {label}
        <Field prop={prop} side={side} />
      </div>
    ));
  }
  return (
    <>
      {/* Mirrors the Inspector's [Header] labels. */}
      {heading && (
        <div className={GRID[layout]}>
          <span />
          <span className={`${pad} pt-2 pb-0.5 font-semibold text-foreground`}>{heading}</span>
        </div>
      )}
      <div className="group/prop line-hover">{rows}</div>
    </>
  );
}

type Side = "old" | "new";
type Components = [string, string][];

const BOX = "inline-flex h-5 min-w-0 max-w-full items-center justify-self-start rounded-sm border px-1.5 font-mono text-xs";
const TONE = {
  neutral: "border-border bg-secondary/50 text-foreground",
  old: "border-red-500/40 bg-[var(--diff-removed-line-bg)] text-red-300",
  new: "border-green-500/40 bg-[var(--diff-added-line-bg)] text-green-300",
} as const;

/** `{x: 1, y: 2}` -> `[["x", "1"], ["y", "2"]]`; null unless a flat map of numbers. */
function parseComponents(value: string | null): Components | null {
  if (!value?.startsWith("{") || !value.endsWith("}")) return null;
  const parts = value.slice(1, -1).split(",").map((p) => p.split(":").map((s) => s.trim()));
  if (parts.some((p) => p.length !== 2 || p[1] === "" || Number.isNaN(Number(p[1])))) return null;
  return parts.map(([k, v]) => [k, v]);
}

const VECTOR_SIZE = { vector2: 2, vector3: 3, vector4: 4 } as const;

/** Display labels for a value's components — a shader Vector is stored as r/g/b/a. */
function componentLabels(prop: UnityPropChange, comps: Components): string[] {
  const size = prop.value_type && prop.value_type in VECTOR_SIZE ? VECTOR_SIZE[prop.value_type as keyof typeof VECTOR_SIZE] : 0;
  if (size > 0) return ["X", "Y", "Z", "W"].slice(0, size);
  return comps.map(([k]) => k.toUpperCase());
}

/**
 * One side of a property, drawn like an Inspector field. `side` tints the
 * parts that differ from the other side; null renders an unchanged value.
 */
function Field({ prop, side }: { prop: UnityPropChange; side: Side | null }) {
  const value = side === "old" ? prop.old : (prop.new ?? (side === null ? prop.old : null));
  const other = side === "old" ? prop.new : side === "new" ? prop.old : value;
  if (value === null) return <span />;
  const tone = (differs: boolean) => TONE[side && differs ? side : "neutral"];

  const comps = parseComponents(value);
  const otherComps = parseComponents(other);
  const isColor =
    prop.value_type === "color" || (prop.value_type === null && comps?.map(([k]) => k).join("") === "rgba");

  if (comps && isColor) {
    const differs = comps.some(([, v], i) => v !== otherComps?.[i]?.[1]);
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className={`${BOX} ${tone(differs)} px-0.5`} title={value}>
          <Swatch comps={comps} />
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">{comps.map(([, v]) => v).join(", ")}</span>
      </span>
    );
  }
  if (comps) {
    const labels = componentLabels(prop, comps);
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        {labels.map((label, i) => (
          <span key={label} className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className={`${BOX} ${tone(comps[i]?.[1] !== otherComps?.[i]?.[1])} min-w-12`}>{comps[i]?.[1]}</span>
          </span>
        ))}
      </span>
    );
  }
  const differs = value !== other;
  if (prop.value_type === "toggle") {
    return (
      <span className={`${BOX} ${tone(differs)} w-5 justify-center px-0`}>
        {value !== "0" && <Check className="h-3 w-3" />}
      </span>
    );
  }
  if (prop.value_type === "range" && prop.range) {
    return (
      <span className="flex min-w-0 items-center gap-2" title={`${prop.range[0]}–${prop.range[1]}`}>
        <Slider value={Number(value)} range={prop.range} />
        <span className={`${BOX} ${tone(differs)} min-w-12`}>{value}</span>
      </span>
    );
  }
  return (
    <span className={`${BOX} ${tone(differs)} min-w-12 ${value === "None" ? "text-muted-foreground" : ""}`}>
      <span className="truncate">{value}</span>
    </span>
  );
}

/** Read-only slider track; SVG attributes stand in for inline styles. */
function Slider({ value, range }: { value: number; range: [number, number] }) {
  const span = range[1] - range[0];
  const t = span > 0 ? Math.min(1, Math.max(0, (value - range[0]) / span)) : 0;
  return (
    <svg className="h-3 w-24 shrink-0 text-muted-foreground" viewBox="0 0 96 12" aria-hidden>
      <rect x="0" y="5" width="96" height="2" rx="1" fill="currentColor" opacity="0.4" />
      <circle cx={4 + t * 88} cy="6" r="4" fill="currentColor" />
    </svg>
  );
}

/** SVG fill instead of an inline style; HDR channels clamp to 1. */
function Swatch({ comps }: { comps: Components }) {
  const channel = (i: number) => Math.round(Math.min(1, Math.max(0, Number(comps[i]?.[1] ?? 0))) * 255);
  return (
    <svg className="h-3.5 w-12 shrink-0 rounded-sm" aria-hidden>
      <rect width="100%" height="100%" fill={`rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`} />
    </svg>
  );
}
