# Agentic Development Environment — design notes

Working notes for an agentic workflow runtime layered on top of an existing Git client (GitKraken-style desktop app). Captures decisions made so far, the reasoning behind them, and what's deliberately deferred.

---

## 1. What this is

A desktop app where **the unit of work is a task**, not a chat session. A task moves through a user-defined pipeline of agent sessions, human gates, and commands. The existing Git client becomes the *detail layer* (diffs, conflict resolution, commit graph, logs); the agentic layer sits on top of it.

The dev workflow is one preset. The runtime is general — a workflow could equally pull from Drive, search the web, produce a spreadsheet, and share a link. But see §12: build general, ship narrow.

---

## 2. Prior art

| Tool | Shape | Takeaway |
|---|---|---|
| **Vibe Kanban** (BloopAI) | Kanban board + streaming agent pane, worktree per task | Closest existing shape. Bloop announced shutdown April 2026; community-maintained, hosted cloud switching off. |
| **Emdash** | Electron, ~22 CLI providers | `.emdash.json` defines setup/run/teardown per task, `$EMDASH_PORT` injection gives each task a unique port. **Copy this.** |
| **Conductor** (Melty Labs) | Proprietary macOS, parallel worktrees, review + merge + PR | Polished, but Mac-only and closed. |
| **Crystal** | Was MIT Electron app | Dead — deprecated Feb 2026, points to paid closed-source Nimbalyst. |
| **Claude Squad** | tmux + worktrees, terminal-native | Leanest option; no GUI. |
| **Mission Control** (WebDevCody) | Local-first desktop, projects/runs/sessions/workflows | Session organizer more than a pipeline. |
| **Mission Control** (other, JSON-backed) | Task board, `claude -p` per agent persona, inbox reports | Agents read/write the same JSON the UI uses. Notably avoids the Agent SDK. |

**Coordination-depth framing** (from the Augment Code roundup) — tools cluster into three tiers:

1. Per-edit approval (Claude Squad, Crystal, Conductor)
2. Milestone gates — tool handles retries, human steps in at PR time
3. Spec-driven verification — a living spec constrains output, a verifier checks compliance

This design targets tier 2, which is the least-served.

**What nobody does well** — and therefore the differentiator:

- A stage machine with **typed gates** (plan → signoff → impl → question → QA → UAT → tweak)
- **Selective context inheritance** — a fresh QA session that gets the diff without the implementer's transcript
- Review findings rendered as **structured objects on a diff**, not markdown in a chat pane

Everyone else treats a card as "one agent, one session, one branch."

---

## 3. Core model

### The board is a state machine, not a drag target

Columns are pipeline stages. Cards move themselves; dragging is for cancelling or forcing a stage. Backlog and Done bookend the active stages.

### "Needs you" is populated by typed interrupts

Not a manual status. Interrupt types: `question`, `signoff`, `review`, `conflict`. The card carries the actual prompt on its face, and the sidebar inbox count is the same number.

### Fan-out is computed, not guessed

The planner emits a predicted file-touch set per subtask. If two subtasks' sets intersect, they can't parallelize regardless of sign-off. So the prompt is *"these 3 subtasks are disjoint — run in parallel?"*, not *"how many agents?"*

Default concurrency: 1. Anything above requires explicit sign-off.

---

## 4. The task ledger

**The problem:** a long session goes stale because the QA agent inherits the implementer's transcript — including all its rationalizations.

**The fix:** the task owns a ledger of typed artifacts. Every session writes artifacts into it. Every downstream session is spawned *fresh against the ledger*, not as a continuation of the previous thread.

```
Plan session      ──writes──▶  plan
Implement session ──writes──▶  diff, notes
Review session    ──writes──▶  findings, verdict
                                    │
                                    ▼
                  Fresh QA / tweak sessions read the ledger
```

Consequences:

- Each QA round **appends** rather than replaces, so round 3 sees rounds 1–2's findings without their reasoning.
- Running 3 parallel QA sessions on the same diff is free — same ledger in, separate findings out, diffable against each other.
- What a node inherits is a *wiring* decision, not a config flag (see §5).

---

## 5. Pipeline as an editable graph

The pipeline is a **portable, versioned, importable/exportable artifact**. The default dev workflow is just one instance.

### Typed artifact ports

This is what separates a usable graph editor from unusable BPMN. Every node declares the artifact types it consumes and produces. Edges only connect where types match.

Three payoffs:
1. Pick-and-choose context inheritance is just wiring
2. The graph validates before spending a token
3. "Sensible defaults" = a pre-wired template, not a pile of flags

Artifact types are **not a hardcoded enum**. They're declared in a type registry that travels with the exported workflow. A research workflow declares `source_set`, `extract`, `sheet`; the dev workflow declares `plan`, `diff`, `findings`. Import validates: do I have these types, these connectors, these model families? If not, say what's missing rather than failing at step 4.

### Node kinds

| Kind | Purpose |
|---|---|
| **Agent session** | Model, prompt template, tool policy, declared input artifacts |
| **Gate** | Human sign-off; blocking; carries a question template |
| **Condition** | Branch on an artifact predicate |
| **Fan-out / fan-in** | Map over subtasks, join with a merge policy |
| **Command** | Run a script, capture stdout as a typed artifact (tests, dev server) |
| **Trigger** | Manual, schedule, webhook, on-artifact |

**Condition evaluation:** both deterministic and agent-judged, author picks per node. Deterministic = exit codes, file globs, diff size. Agent = a cheap model reading an artifact and returning a verdict.

**Triggers matter more than they look.** A `/monitor` workflow isn't a task you open — it's a schedule that *produces* tasks. Workflows enqueuing work for other workflows is a feature, not an accident.

### Versioning

A task snapshots the pipeline version when it starts. Editing a template must not break in-flight work.

### The format is the product, not the editor

A workflow is a versioned file: declared types, declared requirements (`requires:` providers, connectors, model families), semver, prompt templates alongside. The graph editor is a *view* over that file.

Build order consequence: get the format right first, render the graph read-only, defer editing. If you build the editor first, the format ends up being whatever the editor happened to need.

**Format stress test:** express the `/monitor` workflow in it — scheduled trigger, no worktree, output is tasks rather than a diff. If that survives without special cases, the Drive-to-spreadsheet case will too.

---

## 6. Data model

```
WORKSPACE ─┬─< PROJECT ─┬─< TASK ─┬─< RUN ─┬─< SESSION
           │            │         │        └─< ARTIFACT
           │            │         └─< WORKTREE >─┐
           └─< REPO >───┘ (N:M)                  │
                └────────────────────────────────┘
```

- **Workspace** — one SQLite database, the board boundary
- **Repo** — registered once at workspace level: path, default branch, test command, dev command, port policy
- **Project ↔ Repo** — many-to-many
- **Task** — belongs to exactly one project
- **Worktree** — the join. One per `(task, repo)` pair

### Multi-repo

The worktree is the join, not the task. A card spanning two repos has **two worktrees, two ports, two branches, one ledger** — "the diff" is the union. This keeps the card as the unit of intent without forcing a rigid repo/project hierarchy.

Views are saved filters, so "everything in this workspace" and "only this project" cost the same.

**Deferred:** cross-repo atomic merge. There's no clean answer. For MVP, group the PRs, show a merge order, let the human pull the trigger.

### Key columns

```
TASK      { id, provider_ref, stage, pipeline_version }
WORKTREE  { id, task_id, repo_id, branch, port }
ARTIFACT  { id, run_id, type, uri }
RUN       { id, task_id, app_instance_id, status }
```

---

## 7. Git strategy

Two independent axes, deliberately separated:

- **Isolation** — worktree vs. in-place
- **Integration** — PR vs. direct push

A hotfix might still want a worktree if a dev server is running on main. Agent suggests at plan time based on the predicted file-touch set; defaults per repo, override per task.

### Ports

Copy Emdash's env injection (`PORT=$ADE_PORT pnpm dev`), but **allocate deterministically from a hash of the worktree path**, so a restarted preview keeps the same port and the browser tab stays valid. Keep the allocation file outside the repo so other projects on the machine are visible to the allocator.

---

## 8. Agent execution

### `claude -p` semantics

A single `-p` invocation is one-shot: runs the full agent loop, prints, exits. Sessions persist and can be threaded.

- Capture `session_id` from `--output-format json`, or from the first event of `--output-format stream-json` (an `init` system event carrying session id, model, tools, MCP servers)
- `--resume <session_id>` continues
- Session ID lookup is **scoped to the current project directory and its git worktrees** — aligns naturally with the worktree-per-repo model
- `--fork-session` with `--resume` branches a new session ID instead of mutating the original

`--fork-session` is the primitive for "N QA sessions on the same implementation." Don't reconstruct context — fork the impl session so each round gets its own transcript that can't pollute the others.

### Guardrails per node

- `--max-turns`, `--max-budget-usd`
- `--allowedTools` / `--disallowedTools`
- `--permission-mode plan` for review nodes (read-only, enforces the tool policy)

### Gotchas

- **The resume dialog trap** — starting in a directory with a previous session shows an interactive prompt that stalls unattended runs with no error and no exit code. Must be suppressed.
- **No published global exit-code table.** Branch on zero vs. non-zero and read the structured output for the reason.
- `--bare` skips OAuth/keychain reads and requires an explicit credential; documented as recommended for scripted calls and slated to become the `-p` default.

### CLI vs. Agent SDK

Docs framing: SDK when embedding the loop in your own program, headless CLI when scripting the existing agent.

**Choose CLI.** The moment the review node is codex, you're shelling out to a foreign CLI anyway — so build one adapter interface over `stream-json`-ish event streams and normalize into your own event schema. Bonus: the user's existing `CLAUDE.md`, skills, and MCP config apply for free, which is what people expect from a desktop app.

---

## 9. Task provider abstraction

Default: a barebones local project-management tool bundled with the app, SQLite-backed. Abstracted so it can be swapped for Linear, GitHub Issues, etc.

**Keep the boundary narrow.** `run`, `session`, `artifact`, `gate`, and `worktree` are **always local, always SQLite, never synced**. The provider owns only: task identity, title, body, status, order, assignee.

- **Outward is a projection** — one-way and lossy. Stage → provider status via a per-provider mapping table, plus a summary and PR link as a comment. Eight stages won't survive contact with someone else's configured Linear workflow, and that's fine.
- **Inward is pull-based** — poll or webhook, reconcile by `provider_ref`, local wins on conflict for anything the provider doesn't own.

**Failure mode to avoid:** making Linear the source of truth for session state. That's rebuilding your own schema inside someone else's comment threads, and the adapter degrades to whatever the weakest provider supports.

---

## 10. UI layering on the Git client

The Git client is the detail layer. Every tool in this space had to build a mediocre diff viewer; starting from one that already exists is the structural advantage.

| Agentic concept | Existing component |
|---|---|
| Run history across tasks | Commit graph, agent runs as lanes |
| `conflict` gate | Merge conflict resolver, deep-linked from the inbox |
| Review node output | PR diff view with inline comments |
| Session transcript | Pipeline log viewer (streaming, collapsible) |
| Worktree per task/repo | Worktree management UI |
| Artifact ledger | Sidecar storage |

### Findings are structured objects

A review finding has a file, a line range, a severity, and a body. Render it in the diff gutter where it belongs — not as a wall of markdown in a chat pane. Actions on each finding: *send back to implementer* / *dismiss*. Gate-level actions: *request changes* / *approve → UAT*, alongside the live preview URL.

### Navigation

Two-way linking. Card → its worktree/branch in the Git layer. Commit/branch → the task that produced it. "Task" becomes a first-class selector alongside branch and tag in the existing left rail — not a separate mode or window.

---

## 11. Process model

**No daemon.** Child processes live and die with the window; the UI says so once. This deletes:

- OS-level scheduler integration (launchd / systemd / Task Scheduler)
- Liveness probing and PID reconciliation on startup
- Mobile alerts, per-day budget guards, loop-detection escalation

**Instead:**

- Stamp each run with the **app instance id**. On launch, mark anything from a prior instance as `interrupted`.
- Spawn each run in its **own process group**, record the pgid. A crash shouldn't strand orphaned `claude` and dev-server processes — kill the group, then mark interrupted.
- **Stream logs to disk, not memory.** A twenty-minute `stream-json` run will eat a gigabyte of RAM if buffered for rendering. Tail from disk.
- Reclaim leaked worktrees and ports on startup.

**Interrupted is a first-class state.** Quitting mid-run is normal, not exceptional. Because `session_id` and the ledger are stored, an interrupted run gets a **resume** button, not a start-over. That's the difference between quitting being cheap and being expensive.

### Cron

In-process timer, fires only while the app is running. **Skip missed fires rather than catching up** — surface staleness on the workflow instead ("last run: 3 days ago"). Catch-up semantics are where schedulers get complicated, and a monitor workflow that fires late is usually worse than one that didn't fire.

---

## 12. Scope discipline

General workflow runtimes already exist and are good — n8n, Windmill, Temporal, Prefect — and most have bolted on agent nodes. **Competing on connector breadth loses**; that's an integrations arms race with a decade head start.

What none of them have:

- Typed context ledger with selective inheritance
- Gates that surface as an inbox rather than a paused execution you have to go find
- Worktree-isolated diff review with structured findings

**Build the runtime general, ship only the git capability pack.** Let MCP cover everything else rather than writing connectors.

### Layering

```
Workflows (import/export)   dev default · monitor · research→sheet
        ↓
Capability packs            git + worktrees · MCP connectors · shell
        ↓
Runtime core                node kinds · type registry · ledger · gate inbox
```

---

## 13. MVP target

**Make "Send back to implementer" work end to end.**

One click that: forks the impl session with `--fork-session`, appends the finding to the ledger as a typed artifact, moves the card back to Implementing, and reuses the same worktree and port.

That single path exercises the graph, the ledger, the gate inbox, session forking, and the git layer simultaneously. If it's solid, the rest is surface area. If it isn't, no amount of board polish saves it.

### Build order

1. Workflow file format + type registry
2. Runtime executing the dev workflow (hand-written in that format), with real worktrees and real ports
3. Graph rendered read-only
4. Board + gate inbox + ledger
5. Findings-on-diff in the existing diff viewer
6. Graph editing
7. Provider adapters (Linear, GH Issues)

---

## 14. Open / deferred

- Cross-repo atomic merge — grouped PRs with a suggested order, manual trigger
- Overnight unattended runs — not needed
- Mobile alerts — not needed
- Agent A/B comparison on the same task — nice to have; the ledger model makes it nearly free later
- Prompt template versioning: does it live in the workflow file or beside it?
- Merge policy for fan-in when parallel subtasks produce conflicting diffs
