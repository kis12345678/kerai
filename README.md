# KERAI

A local-first AI operating environment. Tell KERAI what to accomplish — it plans,
requests approval for changes, executes through controlled tools, verifies the
result, and reports back. Voice is a first-class interface: the Neural Core on
the home screen is an audio-reactive procedural energy ring driven by the real
microphone and KERAI's own speech.

The UI is a replaceable control surface; the .NET runtime remains the source of
truth for missions, tools, permissions, approvals, execution, and verification.
The model may propose a plan, but runtime contracts validate paths, risk,
approval, execution, and verification — the LLM is never the security boundary.

## Architecture

```
apps/control-surface        React + TypeScript control surface (no agent intelligence)
src/Kerai.Contracts         shared contracts (missions, tools, approvals, events, automations)
src/Kerai.Runtime           deterministic mission transitions, tool registry, permissions,
                            workspace confinement, verifier/recovery, automation rules
src/Kerai.Storage           SQLite (data/kerai.db, WAL) — the single shared source of truth
src/Kerai.Server            ASP.NET Core gateway: REST API + WebSocket event stream
src/Kerai.Worker            the execution authority: claims missions, runs the agent,
                            fires due automations
tests/Kerai.Runtime.Tests   runtime, security-boundary, persistence, and scheduling tests
```

Two processes share one SQLite database. The **Server** is API + WebSocket only;
the **Worker** atomically claims the next runnable mission (Created, or
WaitingForApproval whose approval was granted) and executes it through the agent.
Restarting either process loses nothing.

## Features

- **Command Center (Home)** — KERAI Neural Core (cinematic blue→violet→magenta
  energy ring, one renderer for all seven states: idle, listening, thinking,
  speaking, executing, waitingApproval, error), command input, live mission
  panel, compact readiness strip. Telemetry lives on the System page.
- **Voice (Phase C)** — microphone → Web Audio analyzer → live drive into the
  Neural Core (LISTENING reacts to your actual voice); speech-to-text fills and
  submits commands (Chrome/Edge; falls back to mic-only animation elsewhere);
  KERAI speaks mission results through local system TTS (SPEAKING reacts to
  real utterance boundaries); "stop"/"cancel" spoken while listening halts TTS
  or the active mission. Local-first: the analyzer and TTS never leave the
  machine; only Chrome's SpeechRecognition touches the network, and the
  `IAudioInput`/`ITtsProvider` contracts let a fully local engine replace it.
- **Missions** — Created → Running → WaitingForApproval → Verifying →
  Completed (or Failed/Cancelled), with bounded recovery (2 retries max) and a
  live step checklist streamed over WebSocket.
- **Tool registry** — every capability is a tool with a real JSON schema, risk
  level, approval requirement, timeout, and verification. Filesystem (confined
  to the approved workspace), `dotnet.build`/`dotnet.test`, `git.status`/`git.diff`,
  workspace inspection, and the **Computer agent** (open/close applications,
  list processes, window focus/minimize/maximize, open URLs, clipboard) —
  Windows-native actions, no raw shell anywhere.
- **Specialist lanes** — missions run in a lane (Master, Coder, Computer) that
  scopes the tools the model may call. The **Coder agent** discovers and analyzes
  projects (`workspace.inspect`, `project.analyze`), searches code
  (`code.search`), reads and edits files, runs `dotnet.build`/`dotnet.test`, and
  verifies with git — while the **Computer agent** is limited to `computer.*`
  tools. Lanes are scope, not a second engine: permissions, execution, and
  verification are identical for every lane.
- **Multi-agent (Milestone 10)** — the **Master** delegates focused work to
  specialist sub-agents with `submission.dispatch` (lane: Coder or Computer). Each
  dispatch creates a real sub-mission (`ParentMissionId`) that runs nested through
  the same permission pipeline, verifier, and recovery — its privileged actions
  still require approval, so delegation grants no new capability. Sub-missions
  show up in Missions with a `↳ sub-mission` badge and in the activity trail.
- **Permission engine** — approval is tied to the exact operation; changing an
  argument requires a new approval. Risk levels Read/Safe/Modify/System/Critical.
- **Automations** — scheduled missions (every N minutes or daily at HH:MM),
  persisted in SQLite and fired by the Worker. Firing only *creates a mission*,
  which runs through the exact same permission pipeline — automations can never
  silently gain permissions.
- **Memory** — inspectable, searchable, removable task memory (missions, event
  trail, approvals). "Forget all" never touches active missions.
- **Workspace** — read-only inspection of the confined root (entries, counts,
  git/.sln/manifest detection).
- **System** — real CPU/RAM/GPU/VRAM/storage telemetry with independent
  per-source health (one failed GPU probe never makes the whole core look dead),
  background-sampled so the API never blocks.
- **Models** — dynamic Ollama detection; the selected model drives real inference.
- **Activity** — the operational audit trail (never hidden chain-of-thought).

## Run

```bash
dotnet build Kerai.sln
dotnet test Kerai.sln            # 36 tests: persistence, atomic claim, permissions,
                                 # verification/recovery, automations, workspace, memory,
                                 # multi-agent dispatch
cd apps/control-surface
npm install
npm run build                    # or `npm run dev` for the dev server (http://localhost:5173)
```

Start both processes (order doesn't matter — state is shared):

```bash
dotnet run --project src/Kerai.Server   # gateway, binds 0.0.0.0:5071 (override with --urls)
dotnet run --project src/Kerai.Worker   # execution authority + automation scheduler
```

The control surface resolves the API from the page host (no hardcoded localhost);
set `VITE_KERAI_API` to override. Ollama is optional and expected at
`http://127.0.0.1:11434`. Computer-app names resolve via built-in mappings,
`data/apps.json`, or the `KERAI_APPS` env var.

## Honest boundaries

- Automation-fired missions that need privileged tools still wait for your
  approval — that is deliberate, not a missing feature.
- Some browsers (Chrome) relaunch themselves after being closed (session
  restore); the tool verifies truthfully at execution time.
- SpeechRecognition (Chrome/Edge) routes audio to the browser vendor's speech
  service; everything else in the voice pipeline is local. The provider
  interfaces are shaped for a fully local engine later.
