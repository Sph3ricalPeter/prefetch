// Prefetch Change Brief nudge (see ~/.claude/skills/prefetch-brief).
//
//   mark  (PostToolUse on Edit|Write|MultiEdit|NotebookEdit): remember which git
//         repos this session edited and when, and which draft file it wrote.
//   stop  (Stop): if this session edited a repo after its own draft (or wrote
//         none), block once and ask it to update its draft. Other sessions'
//         drafts don't count, so several agents can share one working tree.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const STATE = path.join(os.homedir(), ".claude", "prefetch-brief");

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

function git(dir, args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function stateFile(sessionId) {
  return path.join(STATE, `${String(sessionId).replace(/[^\w-]/g, "_")}.json`);
}

/** `{ edits: { gitDir: ms }, drafts: { gitDir: draftPath } }` for one session. */
function load(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    return { edits: s.edits ?? {}, drafts: s.drafts ?? {} };
  } catch {
    return { edits: {}, drafts: {} };
  }
}

function mark(input) {
  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (!file || !input.session_id) return;
  const abs = path.resolve(file);
  let gitDir;
  try {
    gitDir = git(path.dirname(abs), ["rev-parse", "--absolute-git-dir"]);
  } catch {
    return; // not in a git repo
  }
  fs.mkdirSync(STATE, { recursive: true });
  const sf = stateFile(input.session_id);
  const state = load(sf);

  const rel = path.relative(path.resolve(gitDir), abs);
  const inGitDir = !rel.startsWith("..") && !path.isAbsolute(rel);
  if (inGitDir) {
    // This session's own draft; anything else in .git isn't a code change.
    const wip = path.join("prefetch", "wip");
    if (path.dirname(rel) === wip && rel.endsWith(".json")) state.drafts[gitDir] = abs;
    else return;
  } else {
    state.edits[gitDir] = Date.now();
  }
  fs.writeFileSync(sf, JSON.stringify(state));
}

function mtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function stop(input) {
  if (!input.session_id) return;
  const sf = stateFile(input.session_id);
  const { edits, drafts } = load(sf);
  const stale = Object.entries(edits)
    .filter(([gitDir, at]) => fs.existsSync(gitDir) && !(drafts[gitDir] && mtime(drafts[gitDir]) >= at))
    .map(([gitDir]) => gitDir);
  // Ask once per stop; if the agent still doesn't update, let it go.
  fs.rmSync(sf, { force: true });
  if (stale.length === 0 || input.stop_hook_active) return;
  const where = stale.map((d) => `- ${path.join(d, "prefetch", "wip")}`).join("\n");
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason:
        "You changed files in a git repo but your Prefetch Change Brief draft is out of date. " +
        "Per the prefetch-brief skill, write or update your own draft (<slug>.json) in:\n" +
        where +
        "\nUse your file-writing tool, not a shell command. Cover only the changes you made " +
        "this session. Then finish; do not mention this to the user.",
    }),
  );
}

const input = readStdin();
try {
  if (process.argv[2] === "mark") mark(input);
  else if (process.argv[2] === "stop") stop(input);
} catch {
  // Never break the agent over a brief nudge.
}
