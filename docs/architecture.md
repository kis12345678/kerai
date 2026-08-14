# KERAI — Architecture

KERAI is a local-first AI **operating layer**: the UI is a replaceable control
surface; the .NET runtime is the source of truth for missions, tools, permissions,
approvals, execution, and verification. The KERAI Neural Core is the visual
identity — one animation engine whose state mirrors what KERAI is doing.

## Product hierarchy

```
KERAI (presence)          ← Neural Core is the face
  ├── Home                ← core + voice/command input + context + current mission
  ├── Chat                ← the conversation (real mission transcripts)
  ├── Missions            ← execution layer for complex requests
  ├── Workspace / Memory  ← context
  ├── Agents              ← Computer / Coder / Browser specialist lanes
  └── System / Models     ← supporting infrastructure (not the home)
```

## Repository layout

```
├── apps/control-surface/      React + TypeScript + Vite control surface
├── src/
│   ├── Kerai.Contracts/       shared mission, tool, security, approval, event contracts
│   ├── Kerai.Runtime/         agent loop, tool executor, permission engine, verifier, Ollama client
│   ├── Kerai.Storage/         SQLite persistence shared by Server and Worker (WAL, cross-process)
│   ├── Kerai.Server/          ASP.NET Core gateway — API + WebSocket only, no mission execution
│   └── Kerai.Worker/          execution authority — claims missions from the shared store and runs the agent
├── tests/Kerai.Runtime.Tests/ runtime, security, persistence, and recovery tests
├── docs/                      architecture notes
└── data/                      runtime data (kerai.db, gitignored)
```

## Frontend structure (`apps/control-surface/src`)

```
├── main.tsx                   entry → App (ToastProvider + AppShell)
├── app.tsx
├── styles/
│   ├── tokens.css             design tokens (colors, spacing, type, motion, z-index)
│   ├── base.css               reset, typography, focus, scrollbars
│   ├── components.css         all component styles
│   └── pages.css              page-level layouts
├── lib/
│   ├── api.ts                 typed API client (timeouts, structured errors)
│   ├── types.ts               mirrors of Kerai.Contracts DTOs
│   ├── routes.ts              navigation registry (KERAI / Agents / Operations / System)
│   ├── router.ts              dependency-free hash router
│   ├── activity.ts            operational events + mission checklist derivation
│   ├── neural.ts              Neural Core state → animation parameter table
│   ├── audio.ts               audio metrics, attack/release smoothing, mic/TTS interfaces
│   └── format.ts              time/status formatting
├── components/
│   ├── ui/                    design-system primitives
│   ├── shell/                 TopBar, Sidebar, AppShell
│   ├── core/                  KeraiNeuralCore (canvas renderer)
│   ├── mission/               MissionCard, ActivityItem, ToolCard, ModelCard, ApprovalDialog
│   └── icons.tsx              hand-rolled 24px stroke icons (no icon dependency)
└── pages/
    ├── HomePage.tsx           primary screen — presence, core, command, context
    ├── ChatPage.tsx           conversation transcript (real mission data)
    ├── MissionsPage.tsx       real mission list + lifecycle + live checklist
    ├── AgentsPage.tsx         Computer / Coder / Browser specialist lanes
    ├── ActivityPage.tsx       operational event feed
    ├── ModelsPage.tsx         real Ollama model list + selection
    └── *Page.tsx              planned-state pages (Workspace, Memory, System, Automations, Settings)
```

## Design system

- **Tokens** (`styles/tokens.css`): near-black charcoal background, slightly lighter
  surface, low-contrast borders, one KERAI accent (mint), restrained semantic
  success/warning/error tones, 4px spacing scale, Inter/UI system font stack,
  110–240ms motion, explicit z-index scale.
- **Components**: Button, IconButton, Input, CommandInput, Panel/Card, Badge,
  StatusIndicator, ProgressBar, Tabs, Modal, Drawer, Dropdown, Tooltip, Toast,
  SystemMetric, EmptyState, Skeleton, plus domain cards.
- **Rules**: real data only — never fake telemetry or progress; state communicated
  through motion only where it matters (executing, connecting, waiting).

## Routes (hash-based, no router dependency)

**KERAI** `#/` Home · `#/chat` · `#/missions` · `#/workspace` · `#/memory` —
**Agents** `#/agents/computer` · `#/agents/coder` · `#/agents/browser` —
**Operations** `#/automations` · `#/activity` — **System** `#/system` · `#/models` · `#/settings`

Shortcuts: `⌘/Ctrl+K` focus command · `⌘/Ctrl+J` missions · `⌘/Ctrl+M` memory ·
`Esc` dismiss.

## KERAI Neural Core

One canvas 2D renderer (`components/core/KeraiNeuralCore.tsx`), one parameter
table (`lib/neural.ts`), seven states: idle, listening, thinking, speaking,
executing, waitingApproval, error. States only move the same knobs (radius,
flow, deformation, strand count, hotspot energy, bloom, palette hues) and the
engine interpolates smoothly between rows — no per-state animations, no video.

The renderer draws the cinematic energy ring natively (DPR-aware, `ResizeObserver`
+ `matchMedia` DPR listener, rAF loop owned outside React, disposed on unmount,
`prefers-reduced-motion` honored): a deep black central void, deep-blue inner
energy hugging the ring's interior, several overlapping blue→violet strands with
four-octave procedural radial deformation (the circumference never repeats),
moving magenta hotspots, three-level bloom (fine line / medium glow / wide
annular halo), motion trails via `destination-out` fading, and drifting
ember/wisp particles. The error state briefly destabilizes the field, then
settles into controlled low energy.

Audio is a first-class input: `lib/audio.ts` provides `AudioAnalyzer` — a Web
Audio FFT wrapper that computes smoothed low/mid/high bands + amplitude,
`speechDetected`/`silenceDuration`, and maps them onto a `NeuralAudioDrive`
(scale/inner/deform/strand/density) exactly as the renderer consumes it
(amplitude→ring scale, lows→inner blue, mids→deformation, highs→strands/
particles, speech→energy density). Attack/release smoothing (`SmoothedMeter`,
`SmoothedDrive`, `PeakEnvelope`) guarantees no jitter. The core accepts either a
simple `audioLevel` (0..1) or a full spectral `drive`, applied only while
LISTENING/SPEAKING. `IAudioInput` / `ITtsProvider` remain the Phase C contracts
for the microphone and local TTS; nothing downstream changes when they land.
The home screen shows only a compact readiness/context strip — system telemetry
lives on the System page.

## Current backend contract

`GET /health` · `GET /api/tools` · `GET /api/ollama/status` · `GET /api/system/status` ·
`GET /api/settings` · `PUT /api/settings/model` · `PUT /api/settings/workspace` ·
`GET /api/activity` · `GET /api/approvals` · `POST /api/approvals/{id}/approve|deny` ·
`GET /api/missions` · `POST /api/missions` · `POST /api/missions/{id}/transition` ·
`GET|POST /api/automations` · `PUT|DELETE /api/automations/{id}` · `GET /api/workspace` ·
`GET|DELETE /api/memory` · `WS /ws`

Enums serialize as strings everywhere (HTTP and WebSocket). CORS is restricted to the
control-surface origins (localhost:5173, openai.kerai.in:5173, or `KERAI_CORS_ORIGINS`).
Settings and all state persist to `data/kerai.db` (SQLite, WAL mode), shared by both processes.
The gateway defaults to binding `0.0.0.0:5071` (override with `--urls`), and the frontend
API base is derived from the page host (never hardcoded localhost) unless `VITE_KERAI_API`
is set — so a production UI served from any host reaches the gateway on the same host.

## Shared state (SQLite)

`Kerai.Storage` owns the single source of truth: missions, events, approvals, and
settings live in `data/kerai.db` (WAL mode so two processes read/write concurrently).
The Server and the Worker each open the same database — no in-memory split, no
state loss on restart.

- `SqliteMissionStore` — CRUD + `ClaimNext()`: an atomic single-statement claim of
  the next runnable mission (Created, or WaitingForApproval whose approval was
  granted). Exactly one consumer (the worker) ever gets a mission.
- `SqliteEventBus` — append-only events with monotonic sequences; the Server
  broadcasts from a watermark to WebSocket clients.
- `SqliteApprovalStore` — approvals keyed by exact operation (mission + tool +
  hashed args), persisted so granted approvals survive restarts.
- `SqliteSettingsStore` — default model + workspace root, loaded in the constructor.
- `SqliteAutomationStore` — scheduled missions (interval or daily-at), with
  `MarkFired` tracking last fire + mission count. Firing only creates a mission.
- Memory clear (`ClearTerminal` / `ClearForTerminalMissions` / `ClearAll`) removes
  completed history but **never** touches active missions.

Each store is registered once (concrete) and its interface resolves to the same
instance in both processes, so memory/automation endpoints and mission endpoints
share exactly one state.

## Automations

`AutomationRules` (pure, tested) decides due-ness from the created/last-fired anchor:
interval automations restart the countdown at each fire; daily automations interpret
`HH:mm` in the machine's local time. The Worker's `AutomationScheduler` hosted
service polls every 20s and, for each due automation, **creates a normal mission**
and publishes `MissionCreated`. The mission then goes through the exact same
claim → agent → permission → execute → verify pipeline as a user-created mission —
an automation can never silently gain new permissions.

## Memory & workspace

`GET /api/memory` returns an inspectable snapshot (recent missions, event trail,
approvals, active count); `DELETE /api/memory` forgets finished history only.
`GET /api/workspace` returns a read-only `WorkspaceInspector` summary of the
confined root: entries, counts, git/.sln/manifest detection — never writes.

## Computer agent

`Kerai.Runtime/ComputerTools.cs` gives KERAI real hands — Windows-native OS actions,
never a raw shell. Ten `computer.*` tools, all routed through the existing
Agent → Tool Router → Permission Engine → Executor → Verification chain:

| Tool | Risk / approval | Behavior |
|---|---|---|
| `computer.open_application` | Modify / approval | Launch an app by configured name, verify a process is running |
| `computer.close_application` | System / approval | Graceful `CloseMainWindow`, then bounded force-close; verify none remain |
| `computer.list_processes` | Read / auto | Pid, memory, responsiveness (optional name filter) |
| `computer.get_active_window` | Read / auto | Foreground window pid/process/title (Win32) |
| `computer.focus_window` | Safe / auto | Bring an app's main window forward |
| `computer.minimize_window` | Safe / auto | Minimize an app's main window |
| `computer.maximize_window` | Safe / auto | Maximize an app's main window |
| `computer.open_url` | Modify / approval | Open an http(s) URL in the default browser (scheme allowlisted) |
| `computer.get_clipboard` | Read / auto | Read clipboard text (Win32) |
| `computer.set_clipboard` | Modify / approval | Replace clipboard text (Win32) |

App names resolve through **configurable mappings** (built-in defaults for chrome/edge/
firefox/notepad/vscode/…, overridden by `data/apps.json`, or a JSON file from the
`KERAI_APPS` env var). Unknown apps fall back to `Process.Start` with the raw name, which
resolves installed apps via Windows App Paths; failures explain the mapping mechanism.
Each result is structured JSON (`success`, `application`, `processId`, `verified`, `note`
or `error`), and every action is verified after execution (process running / none left /
window state). Known limitation: some browsers (Chrome) relaunch themselves after being
killed — the tool verifies honestly at execution time, but session-restore is browser
behavior outside the tool's control.

## Source health (System page)

Every dependency reports **independently** — a failed GPU probe never looks like a dead
core. The System page shows one row per source (KERAI core, system telemetry, GPU,
Ollama, missions, tools), each with its own available/unavailable/error state, the real
reason, the last successful update, and a per-source retry. CPU/RAM/storage always render
when telemetry is reachable, even if the GPU is not detected.

## Multi-agent (Master dispatches sub-agents)

`submission.dispatch` (Master-only, Modify / approval) creates a **real sub-mission**
in a specialist lane (Coder or Computer) and runs it **nested through the same agent
pipeline** — the sub-agent gets only that lane's tool allowlist and prompt, its own
permission checks, verifier, and bounded recovery. The tool result returns the sub-mission's
outcome to the Master so it can report or adapt.

- Sub-missions are ordinary mission rows (`ParentMissionId` links them to the Master),
  persisted in SQLite, listed in the UI with a `↳ sub-mission` badge, and visible in the
  activity trail.
- Dispatch grants no new capability: every privileged action inside the sub-mission still
  goes through the exact same permission engine and still requires approval. A sub-mission
  that pauses for approval resumes independently through the worker's normal claim flow.
- Specialist lanes never see `submission.dispatch` (it is not in their allowlists), so
  delegation is one-directional and cannot recurse.
- The executor holds a `Lazy<IAgentService>` (the agent and its executor are mutually
  dependent), so the cycle is resolved at dispatch time, not construction time.

## Agent runtime

- `OllamaClient` — **streaming** `/api/chat` (NDJSON, `stream: true`) with
  OpenAI-style tool calling; tool-call arguments are merged across stream fragments
  and normalized between object and JSON-string forms. Assistant messages preserve
  their `tool_calls`; each tool result is a role-`tool` message addressed by id, so
  multi-turn tool calling keeps the structure the protocol expects.
- `ToolExecutor` — tools with **real JSON input schemas** sent to the model verbatim:
  workspace.inspect, filesystem.list/read/write, process.run (denylisted dangerous
  commands, workspace working directory, `WaitForExitAsync(token)` cancellation
  with `Kill(true)` on timeout/cancel), plus explicit dotnet.build, dotnet.test,
  git.status, git.diff, ollama.models. Every path is confined to the approved
  workspace.
- **Specialist lanes** (`AgentLanes`) — a mission runs in a lane (Master, Coder,
  Computer) that selects the system prompt and the tool allowlist offered to the
  model. A lane is a scope, not a second engine: permissions, executor, verifier,
  and recovery are identical. The Coder lane gets workspace/project/code tools
  (`workspace.inspect`, `project.analyze`, `code.search`, `filesystem.*`,
  `dotnet.*`, `git.*`) and never sees computer or shell tools; the Computer lane
  gets only `computer.*`. Lane is persisted on the mission and survives claims.
- `code.search` / `project.analyze` — the Coder lane's read-only analysis tools:
  pattern/regex search across workspace files (dependency and binary directories
  skipped, results capped) and structured project analysis (build system,
  solutions, projects, manifests, test layout).
- `PermissionEngine` — read/safe tools auto-approve; modify/system tools require
  an approval bound to the exact operation (mission + tool + hashed arguments).
  Argument changes force a new approval; approvals expire after 5 minutes.
- `AgentService` — bounded loop (max 8 iterations per attempt): model plans →
  tool calls → permission check → execute → feed results back. **Verification**
  (`GroundedAnswerVerifier`) gates completion: the answer must be non-empty and,
  when tools were used, at least one tool must have succeeded — a confident answer
  with no grounded evidence is rejected. **Recovery** is bounded: failed
  verification or a stalled attempt gets up to 2 retries, then the mission fails.
  No chain-of-thought exposure.
- **Execution authority is the Worker.** The Server exposes REST + WebSocket only;
  it never runs the agent. The Worker polls `ClaimNext()`, runs `AgentService`,
  and records completion/failure back to the shared store.
- `EventHub` — WebSocket broadcast of mission/activity/approval events (watermark
  replay from the event store); the UI updates live without polling.
- `CachedSystemMonitor` — samples CPU/RAM/storage/GPU in the background; the API
  returns the cached snapshot instantly instead of blocking on CPU sampling.

## Milestone status

| Milestone | Scope | Status |
|---|---|---|
| 1 | Repository, design system, shell, Command Center | ✅ done |
| 2 | Agent core: streaming inference, tool schemas, permissions, verifier, recovery, live UI | ✅ done |
| 3 | Mission lifecycle depth: checklist streaming, Mission Control, approval flows | ✅ done |
| 4 | Verification + recovery hardening (bounded retries, grounded answers) | ✅ done |
| 5 | World model, cached system monitor, per-source health, event stream | ✅ done |
| 6 | Memory (inspectable/removable), workspace inspection, coding tools | ✅ done |
| 7 | Mission Control, Activity audit trail | ✅ done |
| 8 | Automations (Worker scheduler, SQLite persistence, permission-safe firing) | ✅ done |
| 9a | Voice foundation (mic → analyzer → Neural Core, STT, local TTS, interrupt) | ✅ done |
| 9b | Vision, gestures | planned |
| 10 | Multi-agent: Master dispatches sub-missions to specialist lanes | ✅ done |
