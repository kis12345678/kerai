// Kerai AI desktop shell.
//
// A native window around the local OmniAI web app — the desktop counterpart to the mobile app,
// and the equivalent of IRIS-AI's desktop client. Electron is full Chromium, so unlike the phone
// WebView the in-page voice stack (local Whisper STT + Kokoro TTS) actually runs here.
//
// Assumes the Next server is already serving (npm run dev / start, or the tunnel). Point it
// elsewhere with KERAI_URL.

const { app, BrowserWindow, Tray, Menu, globalShortcut, session, nativeImage, shell, ipcMain } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

const PRELOAD = path.join(__dirname, "preload.js");

// --- Native OS text-to-speech --------------------------------------------------------------
// The in-page TTS models (Kokoro) and Groq TTS both fail on this setup (Electron model loading /
// Groq terms), so the desktop speaks through the operating system's own synthesizer instead —
// bulletproof and instant. Text is passed on stdin, never the command line, so nothing in a
// reply can inject a command.
let speaking = null;

function speakNative(text) {
  stopNative();
  const clean = (text || "").trim();
  if (!clean) return;

  if (process.platform === "win32") {
    // System.Speech reads the whole reply from stdin and speaks it.
    const script =
      "$t=[Console]::In.ReadToEnd();" +
      "Add-Type -AssemblyName System.Speech;" +
      "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;" +
      "$s.Speak($t);";
    speaking = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
  } else if (process.platform === "darwin") {
    speaking = spawn("say", []);
  } else {
    speaking = spawn("spd-say", ["-e", "-w"]); // falls back cleanly if absent (caught below)
  }

  speaking.on("error", () => { speaking = null; });
  speaking.on("close", () => { speaking = null; });
  try {
    speaking.stdin.write(clean);
    speaking.stdin.end();
  } catch { /* process already gone */ }
}

function stopNative() {
  if (speaking) { try { speaking.kill(); } catch { /* already dead */ } speaking = null; }
}

ipcMain.handle("kerai-speak", (_e, text) => speakNative(text));
ipcMain.handle("kerai-stop", () => stopNative());

const APP_URL = process.env.KERAI_URL || "http://localhost:3000/dashboard";
const ICON = path.join(__dirname, "..", "public", "favicon.ico");
const SMOKE = process.env.KERAI_SMOKE === "1"; // launch, verify, self-quit — for automated checks

let mainWindow = null;
let voiceWindow = null;
let tray = null;

// One instance only; a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showMain());
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: "#0B0F14",
    icon: ICON,
    title: "Kerai AI",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: PRELOAD },
  });
  mainWindow.loadURL(APP_URL);
  // Keep external links in the real browser, not inside the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("close", (e) => {
    // Closing hides to tray instead of quitting, so the hotkey stays live.
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function showMain() {
  if (!mainWindow) createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** A compact always-on-top voice HUD that opens straight into listening mode. */
function toggleVoice() {
  if (voiceWindow && !voiceWindow.isDestroyed()) {
    voiceWindow.close();
    voiceWindow = null;
    return;
  }
  voiceWindow = new BrowserWindow({
    width: 420,
    height: 560,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#0B0F14",
    icon: ICON,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: PRELOAD },
  });
  // ?assist=1 tells the web app to start voice immediately (same signal the phone uses).
  voiceWindow.loadURL(`${APP_URL}?assist=1`);
  voiceWindow.on("blur", () => voiceWindow && voiceWindow.close());
  voiceWindow.on("closed", () => (voiceWindow = null));
}

app.whenReady().then(() => {
  // Grant the web app mic/camera/notifications without a prompt — it's our own trusted origin,
  // and the whole point is hands-free voice and gesture control.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(["media", "microphone", "camera", "audioCapture", "videoCapture", "notifications"].includes(permission));
  });

  createMainWindow();

  // Tray with quick actions, so it lives in the background like a real assistant.
  try {
    const icon = nativeImage.createFromPath(ICON);
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.setToolTip("Kerai AI");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open Kerai", click: showMain },
        { label: "Voice (Ctrl+Shift+Space)", click: toggleVoice },
        { type: "separator" },
        { label: "Quit", click: () => { app.isQuitting = true; app.quit(); } },
      ])
    );
    tray.on("click", showMain);
  } catch {
    // Tray is a nicety; the app still works without it.
  }

  // Global hotkeys: summon the app, or pop the voice HUD, from anywhere.
  globalShortcut.register("CommandOrControl+Shift+K", showMain);
  globalShortcut.register("CommandOrControl+Shift+Space", toggleVoice);

  if (SMOKE) {
    // Automated launch check: confirm the process came up cleanly, then exit.
    setTimeout(() => {
      console.log("SMOKE_OK: window=" + Boolean(mainWindow) + " tray=" + Boolean(tray) + " url=" + APP_URL);
      app.isQuitting = true;
      app.quit();
    }, 2500);
  }
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => { /* stay alive in tray; quit only via the menu */ });
