using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Kerai.Runtime;

/// <summary>
/// Windows-native computer control used by the computer.* tools.
///
/// Safety model: the LLM never gets a shell. Every capability is a fixed,
/// single-purpose operation (launch this app, close this app, focus this
/// window, copy this text) with its own validation and verification. Process
/// launch uses .NET's native Process API — not cmd.exe. Application names are
/// resolved through configurable mappings (built-in defaults, then
/// data/apps.json, then the KERAI_APPS environment variable), never through
/// free-form command strings.
/// </summary>
public sealed class ComputerTools
{
    private static readonly Dictionary<string, string> BuiltInMappings = new(StringComparer.OrdinalIgnoreCase)
    {
        ["chrome"] = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe"),
        ["chrome2"] = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google", "Chrome", "Application", "chrome.exe"),
        ["edge"] = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"),
        ["firefox"] = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Mozilla Firefox", "firefox.exe"),
        ["notepad"] = "notepad.exe",
        ["explorer"] = "explorer.exe",
        ["cmd"] = "cmd.exe",
        ["terminal"] = "wt.exe",
        ["calculator"] = "calc.exe",
        ["paint"] = "mspaint.exe",
        ["vscode"] = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft VS Code", "Code.exe"),
        ["code"] = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft VS Code", "Code.exe"),
    };

    private const int CloseGraceMs = 2500;
    private const int VerifyWaitMs = 3000;
    private const int MaxProcessRows = 120;

    private readonly IReadOnlyDictionary<string, string> mappings;
    private readonly string? mappingSource;

    public ComputerTools(string? dataDirectory = null)
    {
        var config = LoadConfig(dataDirectory ?? ResolveDataDirectory());
        var merged = new Dictionary<string, string>(BuiltInMappings, StringComparer.OrdinalIgnoreCase);
        mappingSource = config.Source;
        if (config.Entries is not null)
            foreach (var (key, value) in config.Entries)
                merged[key] = value; // user config overrides built-ins
        mappings = merged;
    }

    /* ------------------------------------------------------------------ */
    /* Launch                                                              */
    /* ------------------------------------------------------------------ */

    /// <summary>Launches an application by configured name and verifies it is running.</summary>
    public string OpenApplication(string app)
    {
        if (string.IsNullOrWhiteSpace(app)) return Error(app, "An application name is required, e.g. \"chrome\" or \"notepad\".");
        if (!OperatingSystem.IsWindows()) return Error(app, "Computer tools are only available on Windows.");

        var target = ResolveExecutable(app);
        try
        {
            using var process = Process.Start(new ProcessStartInfo(target) { UseShellExecute = true, WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) });
            if (process is null) return Error(app, "Failed to start the process (null handle).");

            var pid = process.Id;
            var verified = VerifyProcessRunning(target, app);
            return Ok(new { application = app, processId = pid, verified, note = verified ? $"{app} is running (pid {pid})." : $"{app} launched (pid {pid}), but the process could not be confirmed within the verification window." });
        }
        catch (Exception ex)
        {
            return Error(app, $"{ex.GetType().Name}: {ex.Message}. If '{app}' is not a known application, add an entry to data/apps.json (or KERAI_APPS) mapping it to the executable path.");
        }
    }

    /// <summary>Opens an http(s) URL in the default browser.</summary>
    public string OpenUrl(string url)
    {
        if (string.IsNullOrWhiteSpace(url)) return Error(string.Empty, "A URL is required.");
        if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed) || (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps))
            return Error(string.Empty, "Only http(s) URLs can be opened (got a scheme outside the allowlist).");

        try
        {
            using var process = Process.Start(new ProcessStartInfo(parsed.ToString()) { UseShellExecute = true });
            if (process is null) return Error(string.Empty, "Failed to open the URL (null handle).");
            return Ok(new { url = parsed.ToString(), processId = process.Id, verified = true, note = $"Opened {parsed.Host} in the default browser." });
        }
        catch (Exception ex)
        {
            return Error(string.Empty, $"{ex.GetType().Name}: {ex.Message}");
        }
    }

    /* ------------------------------------------------------------------ */
    /* Close / list                                                        */
    /* ------------------------------------------------------------------ */

    /// <summary>Gracefully closes all processes for an application, then verifies they stopped.</summary>
    public string CloseApplication(string app)
    {
        if (string.IsNullOrWhiteSpace(app)) return Error(app, "An application name is required, e.g. \"chrome\".");
        if (!OperatingSystem.IsWindows()) return Error(app, "Computer tools are only available on Windows.");

        var processName = ResolveProcessName(app);
        var targets = Process.GetProcessesByName(processName);
        if (targets.Length == 0) return Error(app, $"No running process named '{processName}' was found to close.");

        try
        {
            foreach (var process in targets)
            {
                try
                {
                    if (!process.CloseMainWindow())
                        process.Kill(true);
                }
                catch (InvalidOperationException) { /* process already exited */ }
                catch (System.ComponentModel.Win32Exception) { /* already gone */ }
                finally { process.Dispose(); }
            }

            // Grace period for graceful shutdown, then force-close stragglers.
            var deadline = DateTime.UtcNow.AddMilliseconds(CloseGraceMs);
            while (DateTime.UtcNow < deadline)
            {
                var remaining = Process.GetProcessesByName(processName);
                foreach (var process in remaining)
                {
                    if (process.HasExited) { process.Dispose(); continue; }
                    process.Kill(true);
                    process.Dispose();
                }
                if (remaining.Length == 0) break;
                Thread.Sleep(150);
            }

            var left = Process.GetProcessesByName(processName);
            var verified = left.Length == 0;
            foreach (var process in left) process.Dispose();
            return verified
                ? Ok(new { application = app, verified, note = $"{app} closed." })
                : Error(app, $"{app} was requested to close, but {left.Length} process(es) are still running.");
        }
        catch (Exception ex)
        {
            return Error(app, $"{ex.GetType().Name}: {ex.Message}");
        }
    }

    /// <summary>Lists running processes (optionally filtered by name), with pid, memory, and window state.</summary>
    public string ListProcesses(string? filter = null)
    {
        if (!OperatingSystem.IsWindows()) return Error(string.Empty, "Computer tools are only available on Windows.");
        try
        {
            IEnumerable<Process> all = Process.GetProcesses().OrderBy(p => p.ProcessName, StringComparer.OrdinalIgnoreCase);
            if (!string.IsNullOrWhiteSpace(filter))
                all = all.Where(p => p.ProcessName.Contains(filter, StringComparison.OrdinalIgnoreCase));

            var rows = new List<object>();
            foreach (var process in all.Take(MaxProcessRows))
            {
                long memory = 0;
                try { memory = process.WorkingSet64; } catch { /* access denied */ }
                bool responding = true;
                try { responding = process.Responding; } catch { /* access denied */ }
                rows.Add(new { name = process.ProcessName, pid = process.Id, memory, responding });
                process.Dispose();
            }
            return Ok(new { count = rows.Count, processes = rows });
        }
        catch (Exception ex)
        {
            return Error(string.Empty, $"{ex.GetType().Name}: {ex.Message}");
        }
    }

    /* ------------------------------------------------------------------ */
    /* Windows                                                             */
    /* ------------------------------------------------------------------ */

    /// <summary>Returns the currently focused window (pid, process name, title).</summary>
    public string GetActiveWindow()
    {
        if (!OperatingSystem.IsWindows()) return Error(string.Empty, "Computer tools are only available on Windows.");
        var handle = GetForegroundWindow();
        if (handle == IntPtr.Zero) return Error(string.Empty, "No foreground window is available.");
        GetWindowThreadProcessId(handle, out var pid);
        var title = new StringBuilder(512);
        GetWindowText(handle, title, title.Capacity);
        string processName = "unknown";
        try { processName = Process.GetProcessById((int)pid).ProcessName; } catch { /* exited */ }
        return Ok(new { pid, processName, title = title.ToString() });
    }

    /// <summary>Captures a desktop screenshot and returns image metadata and base64 PNG.</summary>
    public string CaptureScreenshot(string? savePath = null)
    {
        if (!OperatingSystem.IsWindows()) return Error(null, "Screenshot capture is only available on Windows.");
        try
        {
            var width = GetSystemMetrics(0);  // SM_CXSCREEN
            var height = GetSystemMetrics(1); // SM_CYSCREEN
            if (width <= 0) width = 1920;
            if (height <= 0) height = 1080;

            using var bitmap = new System.Drawing.Bitmap(width, height, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
            using (var graphics = System.Drawing.Graphics.FromImage(bitmap))
            {
                graphics.CopyFromScreen(0, 0, 0, 0, new System.Drawing.Size(width, height), System.Drawing.CopyPixelOperation.SourceCopy);
            }

            using var stream = new MemoryStream();
            bitmap.Save(stream, System.Drawing.Imaging.ImageFormat.Png);
            var bytes = stream.ToArray();
            var base64 = Convert.ToBase64String(bytes);

            string? savedFile = null;
            if (!string.IsNullOrWhiteSpace(savePath))
            {
                var full = Path.GetFullPath(savePath);
                var dir = Path.GetDirectoryName(full);
                if (!string.IsNullOrWhiteSpace(dir)) Directory.CreateDirectory(dir);
                File.WriteAllBytes(full, bytes);
                savedFile = full;
            }

            return Ok(new
            {
                width,
                height,
                savedFile,
                base64Length = base64.Length,
                dataUri = $"data:image/png;base64,{base64}",
                note = $"Captured {width}x{height} desktop screenshot."
            });
        }
        catch (Exception ex)
        {
            return Error(null, $"Screenshot capture failed: {ex.GetType().Name} - {ex.Message}");
        }
    }

    public string FocusWindow(string app) => WindowAction(app, "focus", SW_RESTORE);
    public string MinimizeWindow(string app) => WindowAction(app, "minimize", SW_MINIMIZE);
    public string MaximizeWindow(string app) => WindowAction(app, "maximize", SW_MAXIMIZE);

    private string WindowAction(string app, string action, int showCommand)
    {
        if (string.IsNullOrWhiteSpace(app)) return Error(app, "An application name is required, e.g. \"chrome\".");
        if (!OperatingSystem.IsWindows()) return Error(app, "Computer tools are only available on Windows.");

        var processName = ResolveProcessName(app);
        IntPtr? handle = null;
        int pid = 0;
        foreach (var process in Process.GetProcessesByName(processName))
        {
            process.Refresh();
            if (process.MainWindowHandle != IntPtr.Zero)
            {
                handle = process.MainWindowHandle;
                pid = process.Id;
                process.Dispose();
                break;
            }
            process.Dispose();
        }

        if (handle is null) return Error(app, $"No visible window found for '{processName}' (it may be running without a window).");

        var ok = showCommand == SW_RESTORE
            ? SetForegroundWindow(handle.Value)
            : ShowWindow(handle.Value, showCommand);
        return ok
            ? Ok(new { application = app, pid, action, verified = true, note = $"{app} window {action}d." })
            : Error(app, $"The window for '{app}' could not be {action}d.");
    }

    /* ------------------------------------------------------------------ */
    /* Clipboard                                                           */
    /* ------------------------------------------------------------------ */

    public string GetClipboard()
    {
        if (!OperatingSystem.IsWindows()) return Error(string.Empty, "Computer tools are only available on Windows.");
        if (!OpenClipboard(IntPtr.Zero)) return Error(string.Empty, "The clipboard is in use by another application.");
        try
        {
            var handle = GetClipboardData(CF_UNICODETEXT);
            if (handle == IntPtr.Zero) return Ok(new { text = string.Empty, note = "Clipboard does not contain text." });
            var pointer = GlobalLock(handle);
            if (pointer == IntPtr.Zero) return Error(string.Empty, "Could not lock clipboard data.");
            try
            {
                var text = Marshal.PtrToStringUni(pointer);
                return Ok(new { text = text ?? string.Empty, length = (text ?? string.Empty).Length });
            }
            finally { GlobalUnlock(handle); }
        }
        finally { CloseClipboard(); }
    }

    public string SetClipboard(string text)
    {
        if (!OperatingSystem.IsWindows()) return Error(string.Empty, "Computer tools are only available on Windows.");
        if (text is null) return Error(string.Empty, "Text is required.");

        if (!OpenClipboard(IntPtr.Zero)) return Error(string.Empty, "The clipboard is in use by another application.");
        try
        {
            EmptyClipboard();
            var bytes = Encoding.Unicode.GetBytes(text + "\0");
            var handle = GlobalAlloc(GMEM_MOVEABLE, (nuint)bytes.Length);
            if (handle == IntPtr.Zero) return Error(string.Empty, "Could not allocate clipboard memory.");
            var pointer = GlobalLock(handle);
            if (pointer == IntPtr.Zero) { GlobalFree(handle); return Error(string.Empty, "Could not lock clipboard memory."); }
            try
            {
                Marshal.Copy(bytes, 0, pointer, bytes.Length);
            }
            finally { GlobalUnlock(handle); }
            if (SetClipboardData(CF_UNICODETEXT, handle) == IntPtr.Zero)
            {
                GlobalFree(handle);
                return Error(string.Empty, "Could not place text on the clipboard.");
            }
            // Ownership transferred to the clipboard on success.
            return Ok(new { length = text.Length, note = "Clipboard updated." });
        }
        finally { CloseClipboard(); }
    }

    /* ------------------------------------------------------------------ */
    /* Mappings                                                            */
    /* ------------------------------------------------------------------ */

    public string ResolveExecutable(string app)
    {
        return mappings.TryGetValue(app, out var mapped)
            ? mapped
            : app; // fall back to the raw name — Process.Start resolves App Paths / PATH
    }

    public string ResolveProcessName(string app)
    {
        if (mappings.TryGetValue(app, out var mapped))
        {
            var file = Path.GetFileNameWithoutExtension(mapped);
            if (!string.IsNullOrWhiteSpace(file)) return file;
        }
        return app;
    }

    public IReadOnlyDictionary<string, string> Mappings => mappings;

    /// <summary>Human-readable explanation of how to configure application mappings.</summary>
    public string MappingHelp =>
        "Add a JSON file at data/apps.json (or set KERAI_APPS to a path) with {\"app name\": \"C:/path/to/app.exe\"} to map additional applications.";

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

    private static string ResolveDataDirectory()
    {
        var env = Environment.GetEnvironmentVariable("KERAI_DATA_DIR");
        if (!string.IsNullOrWhiteSpace(env)) return Path.GetFullPath(env);
        return Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "data"));
    }

    private static (string? Source, Dictionary<string, string>? Entries) LoadConfig(string dataDirectory)
    {
        var envPath = Environment.GetEnvironmentVariable("KERAI_APPS");
        if (!string.IsNullOrWhiteSpace(envPath) && File.Exists(envPath))
            return (envPath, ReadJsonMap(envPath));

        var local = Path.Combine(dataDirectory, "apps.json");
        if (File.Exists(local)) return (local, ReadJsonMap(local));

        return (null, null);
    }

    private static Dictionary<string, string>? ReadJsonMap(string path)
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return null;
            var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var property in doc.RootElement.EnumerateObject())
                if (property.Value.ValueKind == JsonValueKind.String)
                    map[property.Name] = property.Value.GetString()!;
            return map.Count > 0 ? map : null;
        }
        catch (Exception ex) when (ex is IOException or JsonException)
        {
            return null;
        }
    }

    private bool VerifyProcessRunning(string executable, string app)
    {
        if (!OperatingSystem.IsWindows()) return false;
        var targetName = Path.GetFileNameWithoutExtension(executable);
        var deadline = DateTime.UtcNow.AddMilliseconds(VerifyWaitMs);
        while (DateTime.UtcNow < deadline)
        {
            var matches = Process.GetProcessesByName(string.IsNullOrWhiteSpace(targetName) ? ResolveProcessName(app) : targetName)
                .Where(p =>
                {
                    try { return !p.HasExited; } catch { return false; }
                })
                .ToArray();
            foreach (var process in matches) process.Dispose();
            if (matches.Length > 0) return true;
            Thread.Sleep(150);
        }
        return false;
    }

    private static string Ok(object payload)
    {
        var node = JsonSerializer.SerializeToNode(payload, JsonOptions) as JsonObject;
        node!["success"] = true;
        return JsonSerializer.Serialize(node, JsonOptions);
    }

    private static string Error(string? application, string message)
    {
        var node = new JsonObject { ["success"] = false, ["error"] = message };
        if (!string.IsNullOrWhiteSpace(application)) node["application"] = application;
        return JsonSerializer.Serialize(node, JsonOptions);
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /* ---- Win32 ---- */

    private const uint CF_UNICODETEXT = 13;
    private const uint GMEM_MOVEABLE = 0x0002;
    private const int SW_MINIMIZE = 6;
    private const int SW_MAXIMIZE = 3;
    private const int SW_RESTORE = 9;

    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int nIndex);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool OpenClipboard(IntPtr hWndNewOwner);
    [DllImport("user32.dll")] private static extern bool CloseClipboard();
    [DllImport("user32.dll")] private static extern bool EmptyClipboard();
    [DllImport("user32.dll")] private static extern IntPtr SetClipboardData(uint uFormat, IntPtr hMem);
    [DllImport("user32.dll")] private static extern IntPtr GetClipboardData(uint uFormat);
    [DllImport("kernel32.dll")] private static extern IntPtr GlobalAlloc(uint uFlags, nuint dwBytes);
    [DllImport("kernel32.dll")] private static extern IntPtr GlobalLock(IntPtr hMem);
    [DllImport("kernel32.dll")] private static extern bool GlobalUnlock(IntPtr hMem);
    [DllImport("kernel32.dll")] private static extern IntPtr GlobalFree(IntPtr hMem);
}
