import { useEffect, useState, type MouseEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  DoorClosed,
  Flame,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { CommitFileRow, CommitFileTreeView } from "@/components/layout/detail-panel";
import { DiffStat } from "@/components/ui/diff-stat";
import { SectionHeader } from "@/components/ui/section-header";
import { openUrl } from "@/lib/commands";
import { useRepoStore, type StoryPick } from "@/stores/repo-store";
import { useTreeCollapseStore } from "@/stores/tree-collapse-store";
import { buildFileTree, collectDirPaths } from "@/lib/file-tree";
import { cn } from "@/lib/utils";
import { COMMIT_TYPE_META } from "@/lib/commit-type";
import { COMMIT_TYPE_ICONS } from "@/lib/commit-type-icons";
import {
  TIER_META,
  briefKey,
  intentKey,
  intentType,
  matchBriefs,
  pieceCounts,
  riskReasons,
  sortBriefs,
  sortIntents,
  storyOutline,
  type OutlineGroup,
  type OutlineStep,
  type ShownIntent,
} from "@/lib/brief";
import type { Brief, FileStatus, RiskTier, StoryPiece } from "@/types/git";

/** DOM twins of the canvas icons in TIER_META. */
const TIER_ICONS: Record<RiskTier | "none", LucideIcon> = {
  high: Flame,
  mid: CircleAlert,
  low: ShieldCheck,
  none: ScrollText,
};

export function InferredBadge() {
  return (
    <span
      className="shrink-0 text-caption font-semibold text-faint"
      title="Written by Prefetch from the diff, not by the agent that made the change"
    >
      inferred
    </span>
  );
}

/** The story as the Brief tab lists it: its steps under their intents. */
interface StoryNav {
  outline: OutlineGroup[];
  /** What the open story shows; null when closed or showing it all. */
  pick: StoryPick | null;
  /** Show only this part of the story; picking it again shows it all. */
  choose: (pick: StoryPick) => void;
  /** Every file in view, for the files under each step. */
  files: Map<string, FileStatus>;
}

const samePick = (a: StoryPick | null, b: StoryPick) =>
  !!a && a.brief === b.brief && a.intent === b.intent && a.step === b.step && a.path === b.path;

export function BriefView({
  commitId,
  briefs,
  files,
  errors = [],
  selectedFilePath,
  onFileClick,
}: {
  /** Whose story the steps come from: a commit, or null for the working changes. */
  commitId: string | null;
  briefs: Brief[];
  files: FileStatus[];
  /** Drafts that failed to parse, shown so a bad agent write isn't silent. */
  errors?: string[];
  selectedFilePath: string | null;
  /** Opens the file's diff. */
  onFileClick: (file: FileStatus) => void;
}) {
  const { shown, unclaimed } = matchBriefs(briefs, files);
  const state = useRepoStore((s) => (s.story?.commitId === commitId ? s.story : null));
  const peekStory = useRepoStore((s) => s.peekStory);
  const openStory = useRepoStore((s) => s.openStory);
  const told = shown.some((s) => s.brief.story);
  const loaded = state !== null;
  // Summarize or Generate brief rewrote the stories: re-read them in place.
  const stories = JSON.stringify(shown.map((s) => s.brief.story ?? null));
  // The story the briefs tell is listed under its intents; reading it never calls Claude.
  useEffect(() => {
    if (told || loaded) peekStory(commitId);
  }, [told, loaded, commitId, stories, peekStory]);
  const pick = state?.open ? state.pick : null;
  const nav: StoryNav = {
    outline: state?.story ? storyOutline(state.story, shown) : [],
    pick,
    choose: (next) => openStory(commitId, samePick(pick, next) ? undefined : { pick: next, path: next.path }),
    // A partly staged file has two rows; the staged one is listed last, so it wins.
    files: new Map([...files].sort((a, b) => Number(a.is_staged) - Number(b.is_staged)).map((f) => [f.path, f])),
  };
  // A file listed in an intent card opens the story there when one is at hand.
  const openFile = (f: FileStatus) => {
    if (told || state?.open) openStory(commitId, { path: f.path, fallback: () => onFileClick(f) });
    else onFileClick(f);
  };

  return (
    <div className="flex flex-col gap-2">
      {errors.map((e) => (
        <p key={e} className="rounded-md border border-border bg-card px-4 py-2 text-xs text-red-400">
          Ignored — {e}
        </p>
      ))}

      {!told && files.length > 0 && <NoStoryHint commitId={commitId} />}

      {sortBriefs(shown).map(({ brief, intents }) => (
        <BriefCard
          key={briefKey(brief)}
          brief={brief}
          intents={intents}
          selectedFilePath={selectedFilePath}
          onFileClick={openFile}
          nav={nav}
        />
      ))}

      {unclaimed.length > 0 && (
        <section className="rounded-md border border-border bg-card px-4 pt-2 pb-3">
          <div className="pb-1 text-caption font-semibold text-muted-foreground">Not in any brief</div>
          <Files files={unclaimed} storageKey="brief:unclaimed" selectedFilePath={selectedFilePath} onFileClick={onFileClick} />
        </section>
      )}
    </div>
  );
}

/** What writes the story when no brief in view tells one: the button that
 *  writes the brief writes its story too. */
function NoStoryHint({ commitId }: { commitId: string | null }) {
  const claudeAvailable = useRepoStore((s) => s.claudeAvailable);
  return (
    <p className="rounded-md border border-dashed border-border px-4 py-2 text-xs leading-relaxed text-muted-foreground">
      <span className="font-medium text-foreground">No story yet. </span>
      {!claudeAvailable ? (
        "An agent writes one with its brief (the prefetch-brief skill)."
      ) : commitId === null ? (
        "Summarize, below, writes the brief and a step-by-step story of these changes."
      ) : (
        <>
          Generate brief (<Sparkles className="inline h-3 w-3 align-middle" /> in the bar above) writes one for this commit.
        </>
      )}
    </p>
  );
}

/** The chevron of a card header that is itself a button (it picks the
 *  story part): a nested toggle, so a span, as elsewhere in the app. */
function HeaderChevron({ open, onToggle }: { open: boolean; onToggle: (e: MouseEvent) => void }) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <span
      role="button"
      aria-label={open ? "Collapse" : "Expand"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(e);
      }}
      className="-m-0.5 shrink-0 rounded-xs p-0.5 text-dim transition-colors hover:text-foreground"
    >
      <Chevron className="h-3 w-3" />
    </span>
  );
}

/** One card per brief: the lead intent heads it, its intents sit inside.
 *  The chevron collapses the intents; alt-click opens or closes everything
 *  inside, down to the folders. With a story, clicking the header shows that
 *  brief's steps; without one, it collapses too. */
function BriefCard({
  brief,
  intents,
  selectedFilePath,
  onFileClick,
  nav,
}: {
  brief: Brief;
  intents: ShownIntent[];
  selectedFilePath: string | null;
  onFileClick: (file: FileStatus) => void;
  nav: StoryNav;
}) {
  const key = briefKey(brief);
  const storageKey = `brief:${key}`;
  const told = nav.outline.some((g) => g.owner?.brief === brief);
  const picked = nav.pick?.brief === key && nav.pick.intent === undefined;
  const [open, setOpen] = useState(true);
  // Alt-click remounts the intent cards (new epoch) opened or closed.
  const [all, setAll] = useState({ epoch: 0, open: false });
  const setCollapsed = useTreeCollapseStore((s) => s.setCollapsed);
  const sorted = sortIntents(intents);
  // By identity, not position: an inferred intent joining this card can land
  // anywhere in the sort and must not take another card's open state.
  const keyOf = ({ intent }: ShownIntent) => `${storageKey}:${intent.title}:${intent.files[0] ?? ""}`;
  const toggle = (e: MouseEvent) => {
    if (!e.altKey) {
      setOpen(!open);
      return;
    }
    const next = !(open && all.open);
    setOpen(next);
    setAll({ epoch: all.epoch + 1, open: next });
    sorted.forEach((s) =>
      setCollapsed(keyOf(s), next ? [] : buildFileTree(s.files).flatMap(collectDirPaths)),
    );
  };
  return (
    <section className="rounded-md border border-border bg-card animate-fade-in">
      <div className={cn("rounded-md px-4 pt-2 pb-3", picked && "bg-card-hover")}>
        <button onClick={told ? () => nav.choose({ brief: key }) : toggle} className="block w-full text-left">
          <div className="flex items-center gap-2 pb-1.5">
            <span className="-ml-1 flex">
              <HeaderChevron open={open} onToggle={toggle} />
            </span>
            <span className="text-caption font-semibold text-muted-foreground">Intent</span>
            {brief.inferred && <InferredBadge />}
            {brief.session && !brief.inferred && (
              <span className="ml-auto truncate text-label text-faint">{brief.session}</span>
            )}
          </div>
          <p className="text-sm font-medium text-foreground">{brief.intent.title}</p>
          {brief.intent.why && (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{brief.intent.why}</p>
          )}
        </button>

        {brief.issues.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {brief.issues.map((issue) => (
              <button
                key={issue.id}
                disabled={!issue.url}
                onClick={() => issue.url && openUrl(issue.url)}
                title={issue.criteria.length ? issue.criteria.join("\n") : undefined}
                className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-0.5 text-xs enabled:hover:bg-card-hover"
              >
                <span className="text-brand">{issue.id}</span>
                {issue.title && <span className="truncate text-muted-foreground">{issue.title}</span>}
              </button>
            ))}
          </div>
        )}

        <RiskSummary intents={intents} />
      </div>

      {open && (
        <div className="flex flex-col gap-1.5 pb-2 pl-4 pr-2">
          {sorted.map((s) => (
            <IntentCard
              key={`${all.epoch}:${keyOf(s)}`}
              shown={s}
              brief={brief}
              fromDiff={!!brief.inferred || !!s.inferred}
              defaultOpen={all.open}
              storageKey={keyOf(s)}
              selectedFilePath={selectedFilePath}
              onFileClick={onFileClick}
              nav={nav}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** Counts of the intents that need attention; nothing when all are low or unassessed. */
function RiskSummary({ intents }: { intents: ShownIntent[] }) {
  const count = (tier: RiskTier) => intents.filter((s) => s.intent.tier === tier).length;
  const oneWay = intents.filter((s) => s.intent.risk?.oneWay).length;
  const chips = [
    { n: count("high"), label: "high risk", Icon: Flame, cls: "text-orange-500 border-orange-500/35" },
    { n: oneWay, label: "one-way door", Icon: DoorClosed, cls: "text-red-400 border-red-400/35" },
    { n: count("mid"), label: "medium", Icon: CircleAlert, cls: "text-yellow-400 border-yellow-400/30" },
  ].filter((c) => c.n > 0);
  if (chips.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map(({ n, label, Icon, cls }) => (
        <Chip key={label} className={cls}>
          <Icon className="h-3 w-3" />
          {n} {label}
        </Chip>
      ))}
    </div>
  );
}

function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-caption font-semibold uppercase tracking-wide",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** One intent as a card tinted by its risk tier. Collapsed: tier icon,
 *  `type:` and title, with the risk line under it. Expanded adds the why.
 *  With a story, its steps follow, always shown, each with its files, and
 *  clicking the header shows that intent's steps. A collapsed "Changes"
 *  section holds the files no step shows (all of them without a story). */
function IntentCard({
  shown: { intent, files, inferred },
  brief,
  fromDiff,
  defaultOpen = false,
  storageKey,
  selectedFilePath,
  onFileClick,
  nav,
}: {
  shown: ShownIntent;
  /** The brief whose card it sits in. */
  brief: Brief;
  /** Risk answers come from an inferred brief. */
  fromDiff: boolean;
  defaultOpen?: boolean;
  storageKey: string;
  selectedFilePath: string | null;
  onFileClick: (file: FileStatus) => void;
  nav: StoryNav;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [filesOpen, setFilesOpen] = useState(defaultOpen);
  const setCollapsed = useTreeCollapseStore((s) => s.setCollapsed);
  const steps = nav.outline.find((g) => g.owner?.brief === brief && g.owner.intent === intent)?.steps ?? [];
  const here: StoryPick = { brief: briefKey(brief), intent: intentKey(brief, intent) };
  const picked = !!nav.pick && nav.pick.intent === here.intent && nav.pick.step === undefined;
  const inSteps = new Set(steps.flatMap((s) => s.step.pieces.map((p) => p.path)));
  const rest = files.filter((f) => !inSteps.has(f.path));
  // Alt-click opens or closes everything below, like folders in the file trees.
  const setSubtree = (next: boolean) => {
    setFilesOpen(next);
    setCollapsed(storageKey, next ? [] : buildFileTree(rest).flatMap(collectDirPaths));
  };
  const toggleCard = (e: MouseEvent) => {
    setOpen(!open);
    if (e.altKey) setSubtree(!open);
  };
  const toggleFiles = (e: MouseEvent) => {
    if (e.altKey) setSubtree(!filesOpen);
    else setFilesOpen(!filesOpen);
  };
  const type = intentType(intent);
  const typeMeta = type ? COMMIT_TYPE_META[type] : null;
  const TypeIcon = type ? COMMIT_TYPE_ICONS[type] : null;
  const tier = intent.tier;
  const tierColor = tier ? TIER_META[tier].color : undefined;
  const TierIcon = tier ? TIER_ICONS[tier] : null;
  const high = tier === "high";
  const iconSize = high ? "h-4 w-4" : "h-3.5 w-3.5";
  const reasons = riskReasons(intent, fromDiff);
  const reasonText = reasons.join(", ");
  // Severity tint: the tier color fading out to the right (hex + 8% alpha).
  const tint = tierColor ? { backgroundImage: `linear-gradient(90deg, ${tierColor}14, transparent 70%)` } : undefined;

  return (
    <div
      // overflow-clip, not hidden: hidden would trap the sticky header below.
      className={cn(
        "relative overflow-clip rounded-md border border-border bg-card animate-fade-in",
        intent.kind === "unrelated" && "opacity-70",
      )}
      style={tint}
    >
      <span
        className={cn("absolute inset-y-0 left-0 z-20 w-0.5", !tierColor && "bg-border")}
        style={tierColor ? { backgroundColor: tierColor } : undefined}
      />
      {/* Title and why stay pinned while you scroll through the files below. */}
      <div className={cn("sticky top-0 z-10", picked ? "bg-card-hover" : "bg-card")} style={tint}>
        <button
          onClick={steps.length > 0 ? () => nav.choose(here) : toggleCard}
          className="block w-full px-3 py-2 text-left"
        >
          <div className={cn("flex items-center gap-1.5", high ? "text-sm" : "text-xs")}>
            <HeaderChevron open={open} onToggle={toggleCard} />
            {TierIcon && tier && (
              <span title={TIER_META[tier].label} className="shrink-0" style={{ color: tierColor }}>
                <TierIcon className={iconSize} />
              </span>
            )}
            {typeMeta && TypeIcon && (
              <span className="inline-flex shrink-0 items-center gap-1 font-medium" style={{ color: typeMeta.color }}>
                <TypeIcon className={iconSize} />
                {typeMeta.label}:
              </span>
            )}
            <span className={cn("font-semibold text-foreground", !open && "truncate")}>{intent.title}</span>
            {intent.kind !== "sub" && (
              <span className="shrink-0 text-caption font-semibold text-faint">{intent.kind}</span>
            )}
            {inferred && <InferredBadge />}
          </div>
          {intent.tags && intent.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1 pl-[18px]">
              {intent.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-label font-medium leading-none text-muted-foreground"
                >
                  <Tag className="h-2.5 w-2.5 text-dim" />
                  {tag}
                </span>
              ))}
            </div>
          )}
          {(reasons.length > 0 || intent.risk?.why) && (
            <p className="mt-1.5 pl-[18px] text-label leading-relaxed" style={{ color: tierColor }}>
              {reasons.length > 0 && (
                <span className="font-semibold">
                  {reasonText.charAt(0).toUpperCase() + reasonText.slice(1)}
                  {intent.risk?.why && ": "}
                </span>
              )}
              {intent.risk?.why}
            </p>
          )}
        </button>
        {open && (intent.risk?.oneWay || intent.why) && (
          <div className="px-3 pb-1.5 pl-[30px]">
            {intent.risk?.oneWay && (
              <Chip className="text-red-400 border-red-400/35">
                <DoorClosed className="h-3 w-3" />
                one-way door
              </Chip>
            )}
            {intent.why && (
              <p className={cn("text-xs leading-relaxed text-muted-foreground", intent.risk?.oneWay && "mt-2")}>
                {intent.why}
              </p>
            )}
          </div>
        )}
      </div>

      {steps.length > 0 && <StepList steps={steps} at={here} nav={nav} selectedFilePath={selectedFilePath} />}

      {(open || steps.length > 0) && rest.length > 0 && (
        <div className="px-3 pb-2 pl-[30px]">
          <SectionHeader
            label={steps.length > 0 ? "Other changes" : "Changes"}
            count={rest.length}
            isOpen={filesOpen}
            onToggle={toggleFiles}
            stats={<DiffStat files={rest} />}
            className="px-0 py-1"
          />
          {filesOpen && (
            <Files files={rest} storageKey={storageKey} selectedFilePath={selectedFilePath} onFileClick={onFileClick} />
          )}
        </div>
      )}
    </div>
  );
}

/** An intent's story steps, numbered as in the story, each with the files
 *  it shows and their line counts within the step. */
function StepList({
  steps,
  at,
  nav,
  selectedFilePath,
}: {
  steps: OutlineStep[];
  /** The intent, as picked. */
  at: StoryPick;
  nav: StoryNav;
  selectedFilePath: string | null;
}) {
  return (
    <div className="flex flex-col gap-1 px-3 pb-2 pl-[22px]">
      {steps.map(({ step, i, n }) => {
        const here = { ...at, step: i };
        const byFile = new Map<string, StoryPiece[]>();
        for (const p of step.pieces) byFile.set(p.path, [...(byFile.get(p.path) ?? []), p]);
        return (
          <div key={i}>
            <button
              onClick={() => nav.choose(here)}
              className={cn(
                "flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
                samePick(nav.pick, here) ? "bg-card-hover text-accent-foreground" : "hover:bg-card-hover",
              )}
            >
              <span className="min-w-3 shrink-0 text-right font-semibold tabular-nums text-dim">{n}</span>
              <span className="min-w-0 font-medium text-foreground">{step.title}</span>
            </button>
            <div className="pl-5">
              {[...byFile].map(([path, pieces]) => {
                const file = nav.files.get(path);
                if (!file) return null;
                const pick = { ...here, path };
                return (
                  <CommitFileRow
                    key={path}
                    file={{ ...file, ...pieceCounts(pieces) }}
                    isSelected={samePick(nav.pick, pick) || (!nav.pick && selectedFilePath === path)}
                    onClick={() => nav.choose(pick)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Files in the user's tree/list mode, matching the Files tab. */
function Files({
  files,
  storageKey,
  selectedFilePath,
  onFileClick,
}: {
  files: FileStatus[];
  storageKey: string;
  selectedFilePath: string | null;
  onFileClick: (file: FileStatus) => void;
}) {
  const viewMode = useRepoStore((s) => s.fileViewMode);
  if (viewMode === "tree") {
    const byPath = new Map(files.map((f) => [f.path, f]));
    return (
      <div className="-ml-4 -mb-3">
        <CommitFileTreeView
          files={files}
          selectedFilePath={selectedFilePath}
          fileQuery=""
          onFileClick={(path) => {
            const f = byPath.get(path);
            if (f) onFileClick(f);
          }}
          storageKey={storageKey}
        />
      </div>
    );
  }
  return (
    <div className="-mx-2">
      {files.map((f) => (
        <CommitFileRow
          key={`${f.path}:${f.is_staged}`}
          file={f}
          isSelected={selectedFilePath === f.path}
          onClick={() => onFileClick(f)}
        />
      ))}
    </div>
  );
}
