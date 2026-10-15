import type { Brief, BriefIntent, FileStatus, IntentMark, RiskTier } from "@/types/git";
import { COMMIT_TYPE_META, type CommitType, type IconNode } from "@/lib/commit-type";

const TIER_META_COLORS = { high: "#f97316", mid: "#e3c34d", low: "#71717a", none: "#a78bfa" } as const;

/** Risk tier presentation, shared by the Brief view (lucide-react) and the
 *  graph canvas (`icon` nodes mirror lucide flame / circle-alert / shield-check;
 *  `none` is scroll-text, for briefs nobody assessed). Keep both in sync. */
export const TIER_META: Record<RiskTier | "none", { label: string; color: string; icon: IconNode }> = {
  high: {
    label: "High risk",
    color: TIER_META_COLORS.high,
    icon: [["path", { d: "M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" }]],
  },
  mid: {
    label: "Medium risk",
    color: TIER_META_COLORS.mid,
    icon: [
      ["circle", { cx: "12", cy: "12", r: "10" }],
      ["line", { x1: "12", x2: "12", y1: "8", y2: "12" }],
      ["line", { x1: "12", x2: "12.01", y1: "16", y2: "16" }],
    ],
  },
  low: {
    label: "Low risk",
    color: TIER_META_COLORS.low,
    icon: [
      ["path", { d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" }],
      ["path", { d: "m9 12 2 2 4-4" }],
    ],
  },
  none: {
    label: "Has a Change Brief",
    color: TIER_META_COLORS.none,
    icon: [
      ["path", { d: "M15 12h-5" }],
      ["path", { d: "M15 8h-5" }],
      ["path", { d: "M19 17V5a2 2 0 0 0-2-2H4" }],
      ["path", { d: "M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" }],
    ],
  },
};

export type HeatLevel = "hot" | "warm" | "calm" | "none";

/** How much a commit deserves attention, from its intents' risk. */
export interface Heat {
  /** Highest tier among the intents; "none" when none was assessed. */
  tier: RiskTier | "none";
  /** Null when nothing was assessed, so "unknown" never reads as "safe". */
  score: number | null;
  level: HeatLevel;
}

const TIER_POINTS: Record<RiskTier, number> = { high: 8, mid: 3, low: 0 };
const ONE_WAY_POINTS = 4;

/** Score a commit: one high-risk intent alone makes it hot (>= 8), any
 *  number of low-risk ones never does. */
export function heatOf(intents: IntentMark[]): Heat {
  const assessed = intents.filter((i) => i.tier);
  if (assessed.length === 0) return { tier: "none", score: null, level: "none" };
  const score = assessed.reduce(
    (sum, i) => sum + TIER_POINTS[i.tier!] + (i.oneWay ? ONE_WAY_POINTS : 0),
    0,
  );
  const tier = (["high", "mid", "low"] as const).find((t) => assessed.some((i) => i.tier === t)) ?? "low";
  const level = score >= 8 ? "hot" : score >= 3 ? "warm" : "calm";
  return { tier, score, level };
}

/** Strip color per heat level (brand for briefs nobody assessed). */
export const HEAT_COLOR: Record<HeatLevel, string> = {
  hot: TIER_META_COLORS.high,
  warm: TIER_META_COLORS.mid,
  calm: TIER_META_COLORS.low,
  none: TIER_META_COLORS.none,
};

/** The intent's conventional-commit type, when it's one we know. */
export function intentType(intent: BriefIntent): CommitType | null {
  const t = intent.type?.toLowerCase();
  return t && t in COMMIT_TYPE_META ? (t as CommitType) : null;
}

const TIER_RANK: Record<string, number> = { high: 0, mid: 1 };
const TYPE_RANK: Record<string, number> = { fix: 0, feat: 1 };

/** Why an intent is flagged mid or high, as short phrases, worst first.
 *  `inferred`: "not tested" only means no test in the diff, which the tier
 *  rule ignores (`Risk::tier`), so it isn't given as a reason. */
export function riskReasons(intent: BriefIntent, inferred = false): string[] {
  if (intent.tier !== "high" && intent.tier !== "mid") return [];
  const r = intent.risk;
  const reasons = [
    r?.oneWay && "can't be undone by revert",
    r?.data && "touches stored data",
    r?.external && "acts outside the repo",
    r?.contract && "changes a public interface",
    !inferred && (r?.data || r?.external || r?.contract) && !r?.tested && "not tested",
    intent.pinned && "project risk rule",
  ].filter((x): x is string => !!x);
  if (reasons.length === 0 && r?.shared) reasons.push("used by other code");
  return reasons;
}

/** Reading order: high risk, then medium, then fix › feat › the rest;
 *  unrelated intents last. Stable otherwise, so the agent's order holds. */
export function sortIntents<T extends { intent: BriefIntent }>(list: T[]): T[] {
  const key = ({ intent }: T) => [
    intent.kind === "unrelated" ? 1 : 0,
    TIER_RANK[intent.tier ?? ""] ?? 2,
    TYPE_RANK[intentType(intent) ?? ""] ?? 2,
  ];
  return [...list].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
  });
}

/** A brief narrowed to the files actually in view; intents without files are kept. */
export interface ShownIntent {
  intent: BriefIntent;
  files: FileStatus[];
  /** Moved here from the inferred brief because it `joins` this one. */
  inferred?: boolean;
}

/**
 * Pair briefs with the files in view. A brief that touches none of them is
 * stale (its work was committed or reverted) and is dropped; the rest of the
 * files are "unclaimed" — changed, but no brief says why. Inferred intents
 * that join an agent brief in view are shown inside it.
 */
export function matchBriefs(briefs: Brief[], files: FileStatus[]) {
  // Working changes list a path twice when it's partly staged; prefer staged.
  const byPath = new Map<string, FileStatus>();
  for (const f of files) {
    if (!byPath.has(f.path) || f.is_staged) byPath.set(f.path, f);
  }
  const claimed = new Set<string>();
  const inView = (b: { intents: ShownIntent[] }) => b.intents.some((s) => s.files.length > 0);
  const matched = briefs
    .map((brief) => {
      const intents: ShownIntent[] = brief.intents
        .map((intent) => ({
          intent,
          files: intent.files.flatMap((p) => byPath.get(p) ?? []),
        }))
        .filter((s) => s.intent.files.length === 0 || s.files.length > 0);
      return { brief, intents };
    })
    .filter(inView);
  const hosts = new Map(matched.filter((b) => !b.brief.inferred).map((b) => [b.brief.session, b]));
  for (const b of matched) {
    if (!b.brief.inferred) continue;
    b.intents = b.intents.filter((s) => {
      const host = s.intent.joins ? hosts.get(s.intent.joins) : undefined;
      host?.intents.push({ ...s, inferred: true });
      return !host;
    });
  }
  const shown = matched.filter(inView);
  for (const b of shown) for (const s of b.intents) for (const f of s.files) claimed.add(f.path);
  const unclaimed = [...byPath.values()].filter((f) => !claimed.has(f.path));
  return { shown, unclaimed };
}
