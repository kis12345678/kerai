// Exposes a tiny, safe native bridge to the web app. The renderer stays sandboxed
// (contextIsolation on); it can only call these named channels, nothing else in Node.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("keraiNative", {
  // The web app checks this to route voice through the OS instead of the in-page models,
  // which don't load reliably inside Electron.
  isDesktop: true,
  speak: (text) => ipcRenderer.invoke("kerai-speak", String(text ?? "")),
  stopSpeaking: () => ipcRenderer.invoke("kerai-stop"),
});
