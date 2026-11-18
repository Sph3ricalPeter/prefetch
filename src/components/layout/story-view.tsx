import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, CircleAlert, Flame, Loader2, RotateCw, type LucideIcon } from "lucide-react";
import { useRepoStore } from "@/stores/repo-store";
import { HunkLines } from "@/components/staging/diff-viewer-body";
import { DiffToolbar } from "@/components/staging/diff-toolbar";
import { InferredBadge } from "@/components/layout/brief-view";
import { CommitMessageText } from "@/components/ui/commit-message-text";
import { DiffStat } from "@/components/ui/diff-stat";
import { FileIcon } from "@/components/ui/file-icon";
import { SectionHeader } from "@/components/ui/section-header";
import { useHunkTokens } from "@/hooks/use-hunk-tokens";
import { detectLang } from "@/lib/shiki";
import { computeHunkIntraLineRanges } from "@/lib/intra-line-diff";
import {
  TIER_META,
  briefKey,
  intentKey,
  intentType,
  matchBriefs,
  pieceCounts,
  storyOutline,
  type OutlineGroup,
  type OutlineStep,
} from "@/lib/brief";
import { cn } from "@/lib/utils";
import type { Brief, BriefIntent, RiskTier, StoryPiece } from "@/types/git";

/** TIER_META's colours as classes, since this view adds no inline styles.
 *  The Brief view still paints them inline (#90); keep the hexes in sync. */
// `tint`: the Brief tab intent card's severity gradient (8% fading out by 70%).
const RISKY: Partial<Record<RiskTier, { Icon: LucideIcon; text: string; bar: string; border: string; tint: string }>> = {
  high: {
    Icon: Flame,
    text: "text-orange-500",
    bar: "bg-orange-500",
    border: "border-orange-500/35",
    tint: "from-orange-500/8",
  },
  mid: {
    Icon: CircleAlert,
    text: "text-[#e3c34d]",
    bar: "bg-[#e3c34d]",
    border: "border-[#e3c34d]/35",
    tint: "from-[#e3c34d]/8",
  },
};

const BUTTON =
  "flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-border-hover hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

/** Where each story, and each part of one picked in the Brief tab, was
 *  scrolled to, so Back from "Open whole file" lands where the reader left.
 *  Session-only. */
const scrollMemory = new Map<string, number>();

const NO_BRIEFS: Brief[] = [];

/** `type: title`, the way the intent card's title line reads. */
function intentLabel(intent: BriefIntent) {
  const type = intentType(intent);
  return type ? `${type}: ${intent.title}` : intent.title;
}

/** A commit, or the working changes (`commitId` null), read as ordered
 *  steps, each with its narration and its hunks, grouped under the intents
 *  they serve in the Brief tab's order. Replaces the graph in the centre
 *  panel while open. */
export function StoryView() {
  const state = useRepoStore((s) => s.story);
  const commits = useRepoStore((s) => s.commits);
  const wipBriefs = useRepoStore((s) => s.wipBriefs);
  const fileStatuses = useRepoStore((s) => s.fileStatuses);
  const commitBrief = useRepoStore((s) => s.commitBrief);
  const commitFiles = useRepoStore((s) => s.commitFiles);
  const openStory = useRepoStore((s) => s.openStory);
  const closeStory = useRepoStore((s) => s.closeStory);
  const scrollRef = useRef<HTMLDivElement>(null);
  const commitId = state?.commitId ?? null;
  const story = state?.story ?? null;
  const focus = state?.focus ?? null;
  const pick = state?.pick ?? null;
  const focused = useRef(0);

  const shown =
    commitId === null
      ? matchBriefs(wipBriefs.briefs, fileStatuses).shown
      : matchBriefs(commitBrief ?? NO_BRIEFS, commitFiles).shown;
  const outline = story ? storyOutline(story, shown) : [];
  // The part picked in the Brief tab; nothing matching (the briefs moved on) shows it all.
  const picked = pick
    ? outline.filter(
        ({ owner }) =>
          owner &&
          (pick.intent ? intentKey(owner.brief, owner.intent) === pick.intent : briefKey(owner.brief) === pick.brief),
      )
    : [];
  const filter = picked[0]?.owner ?? null;
  const memoryBase = commitId ?? "worktree";
  const scrollKey = `${memoryBase}:${filter ? (pick?.intent ?? pick?.brief) : ""}`;

  // A new focus (a click in the Brief tab) scrolls to its step or file, or
  // the top; otherwise the story stays where the reader left it.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!story || !el) return;
    if (focus && focus.seq !== focused.current) {
      focused.current = focus.seq;
      if (focus.step === undefined) {
        el.scrollTop = 0;
        return;
      }
      const at = el.querySelector(focus.step === "leftovers" ? "[data-leftovers]" : `[data-step="${focus.step}"]`);
      const file = focus.path ? at?.querySelector(`[data-path="${CSS.escape(focus.path)}"]`) : null;
      (file ?? at)?.scrollIntoView({ block: "start" });
    } else el.scrollTop = scrollMemory.get(scrollKey) ?? 0;
  }, [story, scrollKey, focus]);

  if (!state) return null;
  const subject =
    commitId !== null
      ? (commits.find((c) => c.id === commitId)?.message ?? "")
      : shown.length === 1
        ? shown[0].brief.intent.title
        : "Working changes";
  const filterLabel = filter ? (pick?.intent ? intentLabel(filter.intent) : filter.brief.intent.title) : null;
  const unrelated = (g: OutlineGroup) => g.owner?.intent.kind === "unrelated";
  const main = filter ? picked : outline.filter((g) => !unrelated(g));
  const side = filter ? [] : outline.filter(unrelated);
  const focusSide = side.some((g) => g.steps.some((s) => s.i === focus?.step));
  const grouped = outline.some((g) => g.owner);
  // Several briefs: each one's lead and approach head its first group.
  const multi = new Set(outline.flatMap((g) => (g.owner ? [g.owner.brief] : []))).size > 1;

  return (
    <div className="flex h-full flex-col bg-background">
      <DiffToolbar
        onBack={closeStory}
        title={
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-caption font-semibold tracking-widest text-faint">Story</span>
            <CommitMessageText
              message={subject}
              className={cn("min-w-0 truncate text-xs font-medium", filter ? "text-muted-foreground" : "text-foreground")}
            />
            {filterLabel && (
              <>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-dim" />
                <CommitMessageText message={filterLabel} className="min-w-0 truncate text-xs font-medium text-foreground" />
              </>
            )}
            {story?.inferred && <InferredBadge />}
          </div>
        }
        rightSlot={
          filter && (
            <button className={BUTTON} onClick={() => openStory(commitId)}>
              Show all
            </button>
          )
        }
      />

      {state.loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : state.error || !story ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-foreground">Couldn't show the story</p>
          {state.error && <p className="max-w-prose text-xs text-red-400">{state.error}</p>}
          <button className={BUTTON} onClick={() => openStory(commitId, pick ? { pick } : undefined)}>
            <RotateCw className="h-3.5 w-3.5" />
            Try again
          </button>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-8"
          onScroll={(e) => scrollMemory.set(scrollKey, e.currentTarget.scrollTop)}
        >
          {story.approach && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              <Narration text={story.approach} />
            </p>
          )}

          <div className="mt-3 flex flex-col gap-6">
            {main.map((g, gi) => {
              const brief = g.owner?.brief;
              const opensBrief = multi && brief && brief !== main[gi - 1]?.owner?.brief;
              return (
                <Fragment key={g.steps[0].i}>
                  {opensBrief && (
                    <BriefHeader
                      brief={brief}
                      approach={story.chapters.find((c) => c.title === brief.intent.title)?.approach ?? ""}
                    />
                  )}
                  <StepGroup group={g} commitId={commitId} titled={grouped} />
                </Fragment>
              );
            })}
            {side.length > 0 && <SideChanges groups={side} commitId={commitId} forceOpen={focusSide} />}
            {!filter && story.leftovers.length > 0 && (
              <section data-leftovers className="scroll-mt-3 border-t border-border pt-2">
                <div className="py-1.5 text-caption font-semibold text-muted-foreground">
                  Not in the story
                  <span className="ml-1 text-faint">
                    {story.leftovers.length} part{story.leftovers.length === 1 ? "" : "s"}
                  </span>
                </div>
                <PieceList pieces={story.leftovers} commitId={commitId} />
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** One brief's lead intent and approach, above its first group. */
function BriefHeader({ brief, approach }: { brief: Brief; approach: string }) {
  return (
    <div className="border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2">
        <span className="text-caption font-semibold text-muted-foreground">Intent</span>
        {brief.inferred && <InferredBadge />}
      </div>
      <p className="text-sm font-medium text-foreground">{brief.intent.title}</p>
      {approach && (
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          <Narration text={approach} />
        </p>
      )}
    </div>
  );
}

/** The steps of one intent under a heading like its Brief tab card's title
 *  line. `titled`: label steps serving no intent, since others have one. */
function StepGroup({ group: { owner, steps }, commitId, titled }: { group: OutlineGroup; commitId: string | null; titled: boolean }) {
  const tier = owner?.intent.tier;
  const risk = tier ? RISKY[tier] : undefined;
  return (
    <div
      className={cn(
        "relative flex flex-col gap-6 overflow-clip rounded-md px-3 py-3",
        risk && ["bg-linear-to-r to-transparent to-70%", risk.tint],
      )}
    >
      {risk && <span className={cn("absolute inset-y-0 left-0 w-0.5", risk.bar)} />}
      {owner ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <CommitMessageText
            message={intentLabel(owner.intent)}
            className="min-w-0 text-sm font-semibold text-foreground"
            iconClassName="h-3.5 w-3.5"
          />
          {owner.intent.tier && <RiskChip tier={owner.intent.tier} />}
          {owner.intent.kind !== "sub" && (
            <span className="shrink-0 text-caption font-semibold text-faint">{owner.intent.kind}</span>
          )}
        </div>
      ) : (
        titled && <div className="text-caption font-semibold text-muted-foreground">Other steps</div>
      )}
      {steps.map((s) => (
        <StepBlock key={s.i} {...s} commitId={commitId} />
      ))}
    </div>
  );
}

/** An intent's risk label. Its steps share the tier, so they carry none. */
function RiskChip({ tier }: { tier: RiskTier }) {
  const risk = RISKY[tier];
  if (!risk) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-label font-medium",
        risk.text,
        risk.border,
      )}
    >
      <risk.Icon className="h-3 w-3" />
      {TIER_META[tier].label}
    </span>
  );
}

/** Steps for unrelated intents. Collapsed by default, unless one of them is
 *  mid or high risk (that code is never hidden) or a click asked for one. */
function SideChanges({
  groups,
  commitId,
  forceOpen,
}: {
  groups: OutlineGroup[];
  commitId: string | null;
  forceOpen: boolean;
}) {
  const steps = groups.flatMap((g) => g.steps);
  const locked = steps.some(({ step }) => step.tier && RISKY[step.tier]);
  const [open, setOpen] = useState(false);
  const shown = locked || open || forceOpen;
  return (
    <section className="border-t border-border pt-2">
      <SectionHeader
        label="Side changes"
        count={steps.length}
        isOpen={shown}
        onToggle={() => setOpen(!open)}
        className="px-0"
      />
      {shown && (
        <div className="mt-2 flex flex-col gap-6">
          {groups.map((g) => (
            <StepGroup key={g.steps[0].i} group={g} commitId={commitId} titled />
          ))}
        </div>
      )}
    </section>
  );
}

function StepBlock({ step, i, n, commitId }: OutlineStep & { commitId: string | null }) {
  const risk = step.tier ? RISKY[step.tier] : undefined;
  const [open, setOpen] = useState(true);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    // The number sits in a gutter with the step indented beside it, so where
    // one step's code ends and the next begins reads at a glance.
    <section data-step={i} className="flex scroll-mt-3 gap-2 border-t border-border pt-3">
      <span className="w-5 shrink-0 text-right text-sm font-semibold tabular-nums text-dim">{n}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="min-w-0 text-sm font-medium text-foreground">
            <Narration text={step.title} />
          </h3>
          {!risk && (
            <button
              onClick={() => setOpen(!open)}
              className="ml-auto flex shrink-0 items-center gap-1 text-label text-faint transition-colors hover:text-muted-foreground"
            >
              <Chevron className="h-3 w-3" />
              {open ? "Hide code" : "Show code"}
            </button>
          )}
        </div>
        {step.why && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            <Narration text={step.why} />
          </p>
        )}
        <PieceList pieces={step.pieces} commitId={commitId} showCode={!!risk || open} />
      </div>
    </section>
  );
}

/** Narration text, with `backticked` names set as code. */
function Narration({ text }: { text: string }) {
  return text.split("`").map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className="font-mono text-label text-foreground">{part}</code>
    ) : (
      part
    ),
  );
}

/** Pieces in order; consecutive pieces of one file share its label. */
function PieceList({ pieces, commitId, showCode = true }: { pieces: StoryPiece[]; commitId: string | null; showCode?: boolean }) {
  const selectCommitFile = useRepoStore((s) => s.selectCommitFile);
  const selectFile = useRepoStore((s) => s.selectFile);
  const fileStatuses = useRepoStore((s) => s.fileStatuses);
  /** "Open whole file": a commit's file diff, or the file as the Working
   *  Changes list opens it. A partly staged file (two rows) opens its staged
   *  side, as in the Brief tab; one no longer changed can't. */
  const opener = (path: string) => {
    if (commitId !== null) return () => selectCommitFile(commitId, path);
    const rows = fileStatuses.filter((f) => f.path === path);
    const row = rows.find((f) => f.is_staged) ?? rows[0];
    return row ? () => selectFile(row.path, row.is_staged) : undefined;
  };
  const groups: { path: string; pieces: StoryPiece[] }[] = [];
  for (const p of pieces) {
    const last = groups[groups.length - 1];
    if (last?.path === p.path) last.pieces.push(p);
    else groups.push({ path: p.path, pieces: [p] });
  }
  return (
    <div className="mt-2 flex flex-col gap-2">
      {groups.map((g, gi) => {
        const open = opener(g.path);
        return (
          <div key={gi} data-path={g.path} className="flex scroll-mt-3 flex-col gap-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <FileIcon filename={g.path.split("/").pop() ?? g.path} className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-xs text-foreground" title={g.path}>{g.path}</span>
              <DiffStat files={[pieceCounts(g.pieces)]} className="shrink-0" />
              <button
                onClick={open}
                disabled={!open}
                className="ml-auto shrink-0 text-label text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-40"
              >
                Open whole file
              </button>
            </div>
            {showCode && g.pieces.map((p, pi) => <PieceHunk key={pi} piece={p} />)}
          </div>
        );
      })}
    </div>
  );
}

/** One piece's hunk, drawn exactly as the diff viewer draws it, read-only. */
function PieceHunk({ piece }: { piece: StoryPiece }) {
  const split = useRepoStore((s) => s.diffViewMode) === "side-by-side";
  const wrap = useRepoStore((s) => s.diffWrapLines);
  const hunks = useMemo(() => [piece.hunk], [piece.hunk]);
  const lang = useMemo(() => detectLang(piece.path), [piece.path]);
  const tokens = useHunkTokens(hunks, lang).get(0);
  const ranges = useMemo(() => computeHunkIntraLineRanges(piece.hunk), [piece.hunk]);
  return (
    <div className="overflow-x-auto rounded-md border border-border font-mono text-xs leading-5">
      <div className="truncate bg-secondary px-2 py-0.5 text-muted-foreground">{piece.hunk.header}</div>
      <HunkLines
        hunk={piece.hunk}
        hunkIndex={0}
        hunkTokens={tokens}
        intraLineRanges={ranges}
        split={split}
        wrapClass={wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"}
        selectable={false}
      />
    </div>
  );
}
