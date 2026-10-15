import { useState, type MouseEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  DoorClosed,
  Flame,
  ScrollText,
  ShieldCheck,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { CommitFileRow, CommitFileTreeView } from "@/components/layout/detail-panel";
import { DiffStat } from "@/components/ui/diff-stat";
import { SectionHeader } from "@/components/ui/section-header";
import { openUrl } from "@/lib/commands";
import { useRepoStore } from "@/stores/repo-store";
import { useTreeCollapseStore } from "@/stores/tree-collapse-store";
import { buildFileTree, collectDirPaths } from "@/lib/file-tree";
import { cn } from "@/lib/utils";
import { COMMIT_TYPE_META } from "@/lib/commit-type";
import { COMMIT_TYPE_ICONS } from "@/lib/commit-type-icons";
import { TIER_META, intentType, matchBriefs, riskReasons, sortIntents, type ShownIntent } from "@/lib/brief";
import type { Brief, FileStatus, RiskTier } from "@/types/git";

/** DOM twins of the canvas icons in TIER_META. */
const TIER_ICONS: Record<RiskTier | "none", LucideIcon> = {
  high: Flame,
  mid: CircleAlert,
  low: ShieldCheck,
  none: ScrollText,
};

function InferredBadge() {
  return (
    <span
      className="shrink-0 text-caption font-semibold text-faint"
      title="Written by Prefetch from the diff, not by the agent that made the change"
    >
      inferred
    </span>
  );
}

export function BriefView({
  briefs,
  files,
  errors = [],
  selectedFilePath,
  onFileClick,
}: {
  briefs: Brief[];
  files: FileStatus[];
  /** Drafts that failed to parse, shown so a bad agent write isn't silent. */
  errors?: string[];
  selectedFilePath: string | null;
  onFileClick: (file: FileStatus) => void;
}) {
  const { shown, unclaimed } = matchBriefs(briefs, files);

  return (
    <div className="flex flex-col gap-2">
      {errors.map((e) => (
        <p key={e} className="rounded-md border border-border bg-card px-4 py-2 text-xs text-red-400">
          Ignored — {e}
        </p>
      ))}

      {shown.map(({ brief, intents }) => {
        const key = brief.session || brief.intent.title;
        return (
          <BriefCard
            key={key}
            brief={brief}
            intents={intents}
            storageKey={`brief:${key}`}
            selectedFilePath={selectedFilePath}
            onFileClick={onFileClick}
          />
        );
      })}

      {unclaimed.length > 0 && (
        <section className="rounded-md border border-border bg-card px-4 pt-2 pb-3">
          <div className="pb-1 text-caption font-semibold text-muted-foreground">Not in any brief</div>
          <Files files={unclaimed} storageKey="brief:unclaimed" selectedFilePath={selectedFilePath} onFileClick={onFileClick} />
        </section>
      )}
    </div>
  );
}

/** One card per brief: the lead intent heads it, its intents sit inside.
 *  Clicking the header collapses the intents; alt-click opens or closes
 *  everything inside, down to the folders. */
function BriefCard({
  brief,
  intents,
  storageKey,
  selectedFilePath,
  onFileClick,
}: {
  brief: Brief;
  intents: ShownIntent[];
  storageKey: string;
  selectedFilePath: string | null;
  onFileClick: (file: FileStatus) => void;
}) {
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
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className="rounded-md border border-border bg-card animate-fade-in">
      <div className="px-4 pt-2 pb-3">
        <button onClick={toggle} className="block w-full text-left">
          <div className="flex items-center gap-2 pb-1.5">
            <Chevron className="-ml-1 h-3 w-3 shrink-0 text-dim" />
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
              defaultOpen={all.open}
              storageKey={keyOf(s)}
              selectedFilePath={selectedFilePath}
              onFileClick={onFileClick}
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
 *  `type:` and title, with the risk line under it. Expanded adds the why and a
 *  collapsed "Changes" section holding the files. */
function IntentCard({
  shown: { intent, files, inferred },
  defaultOpen = false,
  storageKey,
  selectedFilePath,
  onFileClick,
}: {
  shown: ShownIntent;
  defaultOpen?: boolean;
  storageKey: string;
  selectedFilePath: string | null;
  onFileClick: (file: FileStatus) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [filesOpen, setFilesOpen] = useState(defaultOpen);
  const setCollapsed = useTreeCollapseStore((s) => s.setCollapsed);
  // Alt-click opens or closes everything below, like folders in the file trees.
  const setSubtree = (next: boolean) => {
    setFilesOpen(next);
    setCollapsed(storageKey, next ? [] : buildFileTree(files).flatMap(collectDirPaths));
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
  const reasons = riskReasons(intent);
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
      <div className="sticky top-0 z-10 bg-card" style={tint}>
        <button onClick={toggleCard} className="block w-full px-3 py-2 text-left">
          <div className={cn("flex items-center gap-1.5", high ? "text-sm" : "text-xs")}>
            {open ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-dim" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-dim" />
            )}
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

      {open && files.length > 0 && (
        <div className="px-3 pb-2 pl-[30px]">
          <SectionHeader
            label="Changes"
            count={files.length}
            isOpen={filesOpen}
            onToggle={toggleFiles}
            stats={<DiffStat files={files} />}
            className="px-0 py-1"
          />
          {filesOpen && (
            <Files files={files} storageKey={storageKey} selectedFilePath={selectedFilePath} onFileClick={onFileClick} />
          )}
        </div>
      )}
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
