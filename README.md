# OmniAI

A single local chat that auto-detects what you need — plain conversation, a full self-contained app built and previewed live, or real edits to a codebase on disk — running on your own GPU via [Ollama](https://ollama.com) by default, with zero API keys and zero cloud cost. A handful of things are opt-in cloud add-ons (see [Optional cloud integrations](#optional-cloud-integrations)) — everything else stays local unless you deliberately turn one of those on.

## How it works

Chat is a docked panel available from every screen (see [Layout](#layout) below). There's no mode switcher — the model itself decides, per message, what to do:

- **Just answer** — questions, explanations, brainstorming.
- **Build an app** — asked to build/make something, it writes one complete, self-contained HTML file (inline CSS/JS, no build step) with `writeFile`. The transcript shows a live iframe preview (and a Code tab) right where the tool call happened, both before you approve the write and after.
- **Work in a real codebase** — it can `listDirectory`/`readFile`/`searchFiles` freely to explore (plus `semanticSearch`, which builds a local embeddings index via Ollama's `nomic-embed-text` the first time it's used, for finding conceptually related code when you don't know the exact string), and `writeFile`/`editFile`/`runCommand` to make changes. It also has `gitStatus`/`gitDiff`/`gitLog` to inspect repo state freely and `gitCommit` to stage and commit. Point the "Workspace" field at any project on disk, including this one.
- **Look things up or act on the web** — `webFetch` reads a URL's content you already know (docs, API references, error messages). `webSearch` (only present when `TAVILY_API_KEY` is set — see below) actually searches the web via [Tavily](https://tavily.com) when you don't know the exact URL. For pages that need real JavaScript rendering, logins, or clicking through a flow, it can drive an actual persistent headless Chromium session via `browserNavigate`/`browserGetText`/`browserScreenshot`/`browserClick`/`browserType`/`browserPressKey`.

`writeFile`, `editFile`, `runCommand`, `gitCommit`, and the interactive browser tools (`browserClick`/`browserType`/`browserPressKey`) each require your explicit approval before they execute, shown right in the transcript (Claude Code/Codex-style permission prompts). Read-only tools (`listDirectory`, `readFile`, `searchFiles`, `semanticSearch`, `gitStatus`, `gitDiff`, `gitLog`, `webFetch`, `webSearch`, `browserNavigate`, `browserGetText`, `browserScreenshot`, `getSystemStatus`) run without asking.

The model can also keep a persistent project memory: notes it writes to `.omniai/memory.md` in the workspace (conventions, past decisions, your stated preferences) are re-loaded into its system prompt on every future chat against that workspace. The `semanticSearch` embeddings cache lives alongside it at `.omniai/embeddings-index.json`.

A **Stop** button appears next to "Working…" (and next to "Speaking…" in voice mode) whenever a response is in flight — it cancels the streaming request and halts any TTS playback immediately, covering both the text and voice cases with one control.

Long-running sessions are compacted automatically (`lib/history-compaction.ts`): once a conversation's total size passes a rough character budget (~120k, a proxy for tokens, checked before every request), the oldest messages are dropped to keep it under that budget — never splitting a message internally, since a tool call and its result always live together as parts of one message in this SDK's format. This happens server-side, silently, and doesn't touch what's shown in your sidebar or saved to `localStorage` — only what's actually sent to the model on the next request.

## Voice mode

Click the mic icon in the chat header to talk to it instead of typing. It listens continuously for the wake word **"Jarvis"**, captures whatever you say right after (until you pause), sends that as your message, and speaks the reply back once it finishes.

- **Wake word + transcription run fully locally by default** — [`@ricky0123/vad-web`](https://github.com/ricky0123/vad) (Silero VAD, ONNX/WASM) cheaply detects when you start/stop talking, and only that speech segment is transcribed by a local Whisper model ([`Xenova/whisper-tiny.en`](https://huggingface.co/Xenova/whisper-tiny.en) via Transformers.js). No audio ever leaves the machine. There's a real UX tradeoff versus a native engine: there's no live "interim results," so whether the wake word was said isn't known until a beat after you finish the phrase (VAD's silence padding plus a Whisper pass on a few seconds of audio).
  - A "Listen: Local / Listen: Fast (cloud)" toggle appears next to the mic when the browser's built-in `SpeechRecognition` is available (Chrome/Edge only). Switching to Fast trades the local guarantee for a snappier, more accurate native engine — but Chrome sends that audio to Google's speech service to transcribe it.
- **Replies are spoken by a real local neural TTS model** ([Kokoro-82M](https://github.com/hexgrad/kokoro), via [`kokoro-js`](https://www.npmjs.com/package/kokoro-js)/Transformers.js), not the browser's robotic built-in `speechSynthesis`. It runs entirely client-side via ONNX/WASM — the ~tens-of-MB model weights are fetched once from the Hugging Face CDN on first use and cached by the browser after (the one piece of "cloud" involved, same idea as `ollama pull` — a one-time download, not a per-request call). Every actual generation after that runs 100% offline; your text never leaves the machine.
  - First use shows a "Loading voice… N%" progress readout while either the STT or TTS model downloads; after that, generation is a second or two per reply, running on CPU (WASM) so it works on any machine without needing WebGPU.
- The mic pauses itself while the assistant is thinking, generating, or speaking, so it doesn't pick up its own voice or your next command mid-response.
- Needs a real, user-granted microphone permission — the browser will prompt the first time you turn it on.
- **Optional: faster, more human-sounding cloud voice.** If `GROQ_API_KEY` is set (see below), a "Voice: Local / Voice: Fast (cloud)" toggle appears next to the mic. Switching it to Fast routes replies through [Groq's Orpheus TTS](https://console.groq.com/docs/text-to-speech) — near-instant, more natural-sounding, but your reply text leaves the machine per request. Local stays the default either way.

## Gesture control

Click "✋ Gestures" in the chat header to drive a few real actions with your hand instead of the keyboard, via your webcam:

- ✋ **Open palm** — stop (interrupts a response and/or TTS playback, same as the Stop button)
- ✊ **Fist** — toggle the mic on/off
- 👍 **Thumbs up** — approve a pending tool-call approval
- 👎 **Thumbs down** — deny a pending tool-call approval

Runs fully in-browser via [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/gesture_recognizer)'s pretrained gesture recognizer (WASM, no API key) — no video frame is ever sent anywhere. A small preview thumbnail appears next to the toggle with a live label of whatever's currently recognized, so you can see it working (or not) and adjust hand position/lighting. A gesture has to be held steady for a handful of frames before it fires, and there's a ~1.5s cooldown per action, so a held pose doesn't repeat-fire.

Needs a webcam and a secure context (same constraint as the mic — `localhost` or HTTPS). Like voice, it's off by default each session and only requests camera access once you turn it on.

## Installing as an app

OmniAI is installable as a standalone PWA (`app/manifest.ts`) — look for the install icon in your browser's address bar, or "Install app" in the menu. It launches without browser chrome, like a native app, so it feels less like "a tab you bookmarked" and more like Jarvis is actually running on your machine. The manifest and its icon (`public/icon.svg`) are deliberately excluded from the login gate in `proxy.ts` — browsers fetch them unauthenticated to decide whether to offer the install prompt, and neither file contains anything sensitive.

## Layout

Logging in takes you straight to **Dashboard** — live stats read straight from the OS (no cloud call, no external service): battery %, CPU load, memory usage, GPU utilization/VRAM/temperature/power, and uptime. Refreshes every 5s. The same data is exposed to the model as a tool, `getSystemStatus` — ask it "what's my battery," "how much RAM am I using," or "how hot is my GPU" and it answers from a live snapshot, not a guess.
  - CPU/memory/battery come from [`systeminformation`](https://systeminformation.io/). GPU stats prefer `nvidia-smi` when present (real utilization %, temp, power draw — `systeminformation` can't read live NVIDIA utilization on Windows), falling back to `systeminformation`'s cross-vendor reader (model + VRAM only, no utilization) for AMD/Intel-only machines or if `nvidia-smi` isn't on PATH.

The sidebar has two page tabs — **Dashboard** and **Automations** — plus a **Chat panel** that isn't a page at all: it's a docked column on the right, toggleable from the sidebar ("💬 Open/Close chat panel") or the floating 💬 button that appears once it's closed. Because it's mounted once at the layout level rather than per-page, it keeps its conversation, scroll position, and in-progress draft as you move between Dashboard and Automations — closing it only hides it, it doesn't reset anything. On narrow/mobile screens it takes over the full screen instead of docking, since 420px wouldn't leave room for anything else.

The glowing orb (`components/ai-orb.tsx`) is a plain `<canvas>` animation — no animation library — that reflects real state: dim amber while idle, emerald while actively capturing a voice command, bright amber while the model is thinking, warm gold while it's speaking. It shows up on the Dashboard hero, the Chat empty-state, the "Working…" indicator, the voice toggle, and the login screen.

## Automations

Scheduled, unattended prompts — "every morning summarize what changed in the repo," "every hour check if X." Create one from the Automations tab: a label, a prompt, a workspace root, a model, and either "daily at HH:MM" or "every N minutes." A background scheduler (`lib/automation-scheduler.ts`) checks once a minute and fires anything due, running it headlessly via `generateText` (`lib/automation-runner.ts`) and logging the result (or error) back onto the automation entry, visible on the same page.

**Automations only ever get read-only tools** — `listDirectory`, `readFile`, `searchFiles`, `semanticSearch`, `gitStatus`/`gitDiff`/`gitLog`, `webFetch`/`webSearch`, `browserNavigate`/`browserGetText`/`browserScreenshot`, `getSystemStatus`. They never get `writeFile`, `editFile`, `runCommand`, `gitCommit`, or the interactive browser tools (`browserClick`/`browserType`/`browserPressKey`). This isn't a missing feature — it's deliberate: the whole tool-approval system (`lib/tool-approval-secret.ts`) assumes a human is present in the UI to click Approve, and there's no safe way to satisfy that gate when nothing is watching. If an automation's task genuinely needs to write or run something, it says so in its result instead of attempting it, and you do that step yourself in Chat.

Schedules persist to `.omniai-schedules.json` at the project root (gitignored) and the scheduler loop survives dev-mode hot reloads via a `globalThis`-pinned timer.

## Models

By default all models run locally through Ollama (`localhost:11434`). Since tools (filesystem, shell, app-building) are always available in the same chat, every local model in the picker must support reliable tool/function calling — reasoning-only models like DeepSeek R1 are intentionally left out.

- **GPT-OSS Agent 13B** (default) — OpenAI's open-weight model tuned for agentic tool use
- **GPT-OSS 20B**, **Devstral 24B**, **Qwen3 30B**, **GLM-4.7 Flash**, **Qwen3 Coder 30B**

Pull any of these with `ollama pull <name>` if you don't already have them (check with `ollama list`).

> **Note on tool-calling reliability:** some models (notably `qwen3-coder:30b` in local testing, despite being marketed for agentic coding) intermittently emit their native `<function=...>` text syntax instead of a real structured tool call when given this app's full tool set — Ollama/llama.cpp's OpenAI-compatible tool-calling support varies by model and quantization. `gpt-oss-agent:latest` and `gpt-oss:20b` tested reliably (3/3) and are ordered first; if you switch models and see it "narrate" a function call as plain text instead of acting, switch back to one of those two.

The picker also shows a **"Cloud (leaves the machine)"** group when any cloud provider key is configured — see [Optional cloud integrations](#optional-cloud-integrations).

## Optional cloud integrations

None of these are required — the app is fully usable with zero of them set. Each is independently gated: if its env var is absent, the corresponding feature/tool/menu entry simply doesn't appear, rather than erroring. Add keys to `.env.local` (gitignored, never committed) — paste values directly into the file yourself, not into a chat with an AI assistant that might log them.

| Env var | Unlocks | Docs |
|---|---|---|
| `GROQ_API_KEY` | "Voice: Fast (cloud)" toggle next to the mic — near-instant, natural TTS via Groq's Orpheus model, opt-in per the toggle | [console.groq.com/docs/text-to-speech](https://console.groq.com/docs/text-to-speech) |
| `TAVILY_API_KEY` | The `webSearch` tool — real, live web search (vs. `webFetch`'s "fetch a URL I already know") | [docs.tavily.com](https://docs.tavily.com) |
| `OPENROUTER_API_KEY` | "GPT-4o mini (OpenRouter)" in the model picker's Cloud group | [openrouter.ai/docs](https://openrouter.ai/docs) |
| `AIHUBMIX_API_KEY` | "GPT-4o mini (AIHubMix)" in the model picker's Cloud group | [docs.aihubmix.com](https://docs.aihubmix.com) |
| `REQUESTY_API_KEY` | "GPT-4o mini (Requesty)" in the model picker's Cloud group | [docs.requesty.ai](https://docs.requesty.ai) |

OpenRouter, AIHubMix, and Requesty are all the same category of product (an OpenAI-compatible gateway to many cloud models) — wired up as three independent options because that's what was asked for, not because you need all three. Pick whichever you actually have credit on; `lib/cloud-providers.ts` is where to add or remove one. Selecting a cloud model in the picker sends that conversation's messages to that provider — the system prompt tells the model this explicitly so it doesn't claim to be fully local when it isn't.

## Getting started

1. Make sure Ollama is running (it starts automatically on Windows once installed).
2. Install dependencies: `npm install`
3. Install the browser used by the browser tools: `npx playwright install chromium`
4. If you want `semanticSearch` to work, pull its embedding model: `ollama pull nomic-embed-text`
5. Run the dev server: `npm run dev`
6. Open [http://localhost:3000](http://localhost:3000)

No API keys required for the local path — `lib/ollama.ts` points at your local Ollama server. Set `OLLAMA_BASE_URL` if it runs somewhere other than `localhost:11434`.

## Exposing it beyond localhost (Cloudflare Tunnel, etc.)

By default this only listens on your machine. If you put it behind a tunnel (e.g. `cloudflared`) so it's reachable at a public domain, two things are required:

1. **A password.** Every route except `/login` and `POST /api/login` is gated by `proxy.ts` behind a shared password — set it in `.env.local`:
   ```
   OMNIAI_PASSWORD=your-password-here
   ```
   `.env.local` is gitignored and never committed. Without this set, `/api/login` refuses all logins (fails closed). There's a "Log out" button in the sidebar to clear the session cookie.
2. **`allowedDevOrigins`.** Since this runs via `next dev`, Next.js blocks cross-origin requests to the dev server by default. Add your tunnel's hostname to `next.config.ts`:
   ```ts
   const nextConfig: NextConfig = {
     allowedDevOrigins: ["your-domain.example.com"],
   };
   ```

Even with the password gate, remember this thing has real filesystem/shell/browser access to whatever "Workspace" is set to — only expose it to a domain you're not sharing around, and use a real password, not something guessable.

## Notes

- This app talks to `localhost:11434`, so it needs to run on the same machine as Ollama (or one with network access to it). It is **not** deployable to a cloud host like Vercel as-is — Vercel's servers can't reach your local GPU.
- Generated apps are plain, dependency-free HTML/CSS/JS written straight into the workspace, so they're portable — open the file or copy it out and deploy it elsewhere freely.
- `writeFile`/`editFile`/`runCommand` are confined to the chosen workspace directory (path traversal outside it is rejected), but `runCommand` still executes whatever shell command the model proposes — that's exactly why it's approval-gated. Read a command before approving it, the same way you would in Claude Code or Codex CLI.
- The browser tools drive one persistent headless Chromium session per server process (kept alive across tool calls so navigate → click → read stays one continuous flow), not a sandboxed one-off per call — treat `browserClick`/`browserType`/`browserPressKey` with the same care as `runCommand`.
- `gitCommit` runs `git add -A` by default before committing, so review `gitStatus`/`gitDiff` first if you only want specific files staged.
- The approval gate on `writeFile`/`runCommand`/etc. protects against the *model* acting unilaterally — it does not distinguish between you and anyone else who has the page open. Anyone who reaches the app (i.e. anyone with the password, once you've exposed it beyond localhost) can approve their own tool calls.
