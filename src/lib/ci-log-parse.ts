import type { ForgeKind } from "@/types/git";

/**
 * Structured parsing of CI job logs into collapsible group blocks.
 *
 * Most forges emit machine-readable group markers in their raw logs:
 *  - GitHub Actions: `##[group]` / `##[endgroup]` (plus `##[error]`, `##[warning]`).
 *  - GitLab CI:      `section_start:<ts>:<name>` / `section_end:<ts>:<name>`.
 *
 * The parser is selected by forge kind. Forges without known markers (Bitbucket)
 * fall back to a single loose block, so the viewer shows the raw log unchanged.
 *
 * ANSI escape codes are left intact in `content`/`title` — rendering converts them
 * to HTML (see `ansiToHtml` in the viewer).
 */

export type LogLineKind = "normal" | "error" | "warning" | "command";

export interface LogLine {
  /** Line text with ANSI intact, marker prefix and timestamp stripped. */
  content: string;
  kind: LogLineKind;
}

/** Pass/fail state of a group, where the log makes it derivable. */
export type GroupStatus = "success" | "warning" | "failure" | "none";

export interface LogGroup {
  id: string;
  /** Header text — may contain ANSI (GitLab); render via ansiToHtml. */
  title: string;
  lines: LogLine[];
  status: GroupStatus;
  durationSecs: number | null;
  /** Whether the group should start expanded in the structured view. */
  defaultExpanded: boolean;
}

export type LogSegment =
  | { type: "group"; group: LogGroup }
  | { type: "loose"; id: string; lines: LogLine[] };

export interface ParsedLog {
  segments: LogSegment[];
  /** True when at least one collapsible group was detected. */
  hasGroups: boolean;
}

/** RFC3339 timestamp prefix GitHub prepends to every log line. */
const GH_TS = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) (.*)$/;

export function parseCiLog(raw: string, forge: ForgeKind | null | undefined): ParsedLog {
  if (!raw) return { segments: [], hasGroups: false };
  switch (forge) {
    case "github":
      return parseGitHub(raw);
    case "gitlab":
      return parseGitLab(raw);
    default:
      return rawFallback(raw);
  }
}

/** No known marker format — everything is one loose block (raw view). */
function rawFallback(raw: string): ParsedLog {
  const lines = raw.split(/\r?\n/).map((l) => ({ content: l, kind: "normal" as const }));
  return { segments: [{ type: "loose", id: "l0", lines }], hasGroups: false };
}

function parseGitHub(raw: string): ParsedLog {
  const segments: LogSegment[] = [];
  let loose: LogLine[] = [];
  // A block spans from one `##[group]` to the NEXT one. GitHub's `##[group]`
  // only wraps a step's "Run …" header; the command output follows after the
  // matching `##[endgroup]`, so closing on `##[endgroup]` would leave the bulk
  // of each step floating loose. Treating `##[endgroup]` as a header-delimiter
  // (not a closer) keeps that output folded under its step.
  let group: { title: string; lines: LogLine[]; startMs: number | null } | null = null;
  let lastMs: number | null = null;

  const flushLoose = () => {
    if (loose.length > 0) {
      segments.push({ type: "loose", id: `l${segments.length}`, lines: loose });
      loose = [];
    }
  };

  const closeGroup = (endMs: number | null) => {
    if (!group) return;
    const hasError = group.lines.some((l) => l.kind === "error");
    const hasWarning = group.lines.some((l) => l.kind === "warning");
    const status: GroupStatus = hasError ? "failure" : hasWarning ? "warning" : "success";
    const durationSecs =
      group.startMs != null && endMs != null ? Math.max(0, Math.round((endMs - group.startMs) / 1000)) : null;
    segments.push({
      type: "group",
      group: {
        id: `g${segments.length}`,
        title: group.title,
        lines: group.lines,
        status,
        durationSecs,
        defaultExpanded: status !== "success",
      },
    });
    group = null;
  };

  for (const rawLine of raw.split(/\r?\n/)) {
    const tsMatch = rawLine.match(GH_TS);
    const content = tsMatch ? tsMatch[2] : rawLine;
    const tsMs = tsMatch ? Date.parse(tsMatch[1]) : null;
    if (tsMs != null) lastMs = tsMs;

    if (content.startsWith("##[group]")) {
      closeGroup(tsMs); // end the previous block where the next one begins
      flushLoose(); // any pre-first-group content
      group = { title: content.slice("##[group]".length), lines: [], startMs: tsMs };
      continue;
    }

    // `##[endgroup]` ends the header section only — the block stays open.
    if (content.startsWith("##[endgroup]")) continue;

    const line = classifyGitHubLine(content);
    if (group) group.lines.push(line);
    else loose.push(line);
  }

  closeGroup(lastMs);
  flushLoose();

  const hasGroups = segments.some((s) => s.type === "group");
  return { segments, hasGroups };
}

function classifyGitHubLine(content: string): LogLine {
  // GitHub annotations: ##[error]…, ##[warning]…, ##[command]…, ##[notice]…, ##[debug]…
  const m = content.match(/^##\[(error|warning|command|notice|debug)\](.*)$/);
  if (!m) return { content, kind: "normal" };
  switch (m[1]) {
    case "error":
      return { content: m[2], kind: "error" };
    case "warning":
      return { content: m[2], kind: "warning" };
    case "command":
      return { content: m[2], kind: "command" };
    default: // notice, debug — show as normal, prefix stripped
      return { content: m[2], kind: "normal" };
  }
}

/** `section_start:1700000000:name[collapsed=true]\r<ANSI>header`
 *  Uses `[\s\S]*` (not `.*`) so the capture spans the embedded carriage return. */
const GL_START = /section_start:(\d+):([\s\S]*)/;
const GL_END = /section_end:(\d+):/;

function parseGitLab(raw: string): ParsedLog {
  const segments: LogSegment[] = [];
  let loose: LogLine[] = [];
  let group: {
    title: string;
    lines: LogLine[];
    startSecs: number;
    collapsed: boolean;
  } | null = null;

  const flushLoose = () => {
    if (loose.length > 0) {
      segments.push({ type: "loose", id: `l${segments.length}`, lines: loose });
      loose = [];
    }
  };

  const closeGroup = (endSecs: number | null) => {
    if (!group) return;
    const durationSecs = endSecs != null ? Math.max(0, endSecs - group.startSecs) : null;
    // GitLab traces carry no explicit per-section pass/fail, so infer it from the
    // section body: failure on strong signals, success otherwise (matches the
    // green check / red cross icons GitHub gets).
    const status = deriveGitLabSectionStatus(group.lines);
    segments.push({
      type: "group",
      group: {
        id: `g${segments.length}`,
        title: group.title,
        lines: group.lines,
        status,
        durationSecs,
        defaultExpanded: !group.collapsed || status === "failure",
      },
    });
    group = null;
  };

  for (const rawLine of raw.split(/\r?\n/)) {
    const startMatch = rawLine.match(GL_START);
    if (startMatch) {
      flushLoose();
      closeGroup(null); // unterminated previous section
      const startSecs = parseInt(startMatch[1], 10);
      // `rest` = `name[opts]\r<ANSI>header` — split name from human header at the CR.
      const rest = startMatch[2];
      const crIdx = rest.indexOf("\r");
      const nameRaw = crIdx >= 0 ? rest.slice(0, crIdx) : rest;
      const header = crIdx >= 0 ? rest.slice(crIdx + 1) : "";
      const collapsed = /\[collapsed=true\]/.test(nameRaw);
      const name = nameRaw.replace(/\[[^\]]*\]/g, "");
      // Keep the ANSI-bearing header as the title when it has visible text;
      // otherwise fall back to a humanized section name.
      // eslint-disable-next-line no-control-regex -- matching the ANSI ESC byte is intentional
      const headerVisible = header.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/[\r\n]/g, "").trim();
      const title = headerVisible ? header : prettifyGitLabName(name);
      group = { title, lines: [], startSecs, collapsed };
      continue;
    }

    const endMatch = rawLine.match(GL_END);
    if (endMatch) {
      closeGroup(parseInt(endMatch[1], 10));
      continue;
    }

    const line: LogLine = { content: rawLine, kind: "normal" };
    if (group) group.lines.push(line);
    else loose.push(line);
  }

  closeGroup(null);
  flushLoose();

  const hasGroups = segments.some((s) => s.type === "group");
  return { segments, hasGroups };
}

/** `prepare_executor` → `Prepare executor` for sections lacking a header line. */
function prettifyGitLabName(name: string): string {
  const spaced = name.replace(/_/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : name;
}

/** Infer a GitLab section's status from its output (no native marker exists). */
function deriveGitLabSectionStatus(lines: LogLine[]): GroupStatus {
  for (const l of lines) {
    // eslint-disable-next-line no-control-regex -- stripping ANSI before matching
    const plain = l.content.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trim();
    if (
      /^error[: ]/i.test(plain) ||
      /\bjob failed\b/i.test(plain) ||
      /\bexit (?:code|status) [1-9]\d*\b/i.test(plain)
    ) {
      return "failure";
    }
  }
  return "success";
}
