using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Kerai.Contracts;

namespace Kerai.Runtime;

public sealed record ToolResult(bool Ok, string Output, string? Error = null);

public interface IToolExecutor
{
    Task<ToolResult> ExecuteAsync(string toolName, string inputJson, string? workspacePath, TimeSpan timeout, CancellationToken cancellationToken = default, Guid? missionId = null);
}

/// <summary>
/// Executes registered tools against the real machine. Every filesystem path is
/// validated against the approved workspace, inputs are checked against the tool's
/// declared schema, and processes are bounded (timeout, cancellation, denylist).
/// submission.dispatch runs a sub-mission through the same agent pipeline (nested),
/// so the executor holds a lazy reference to the agent to avoid a construction cycle.
/// </summary>
public sealed class ToolExecutor(
    IWorkspacePolicy policy,
    IOllamaClient ollama,
    ComputerTools computer,
    IMissionStore? missions = null,
    IAgentEventBus? events = null,
    Lazy<IAgentService>? subAgentRunner = null) : IToolExecutor
{
    private static readonly string[] SkippedDirectories =
        ["node_modules", "bin", "obj", ".git", "dist", ".next", "build", "out", ".vs", ".claude", ".idea", ".vscode", "coverage", ".venv", "__pycache__"];

    private const int ReadFileCapBytes = 32 * 1024;
    private const int InspectManifestCapBytes = 16 * 1024;
    private const int OutputCapChars = 16 * 1024;

    private static readonly string[] DangerousCommandTokens =
    [
        "shutdown", "format", "diskpart", "reg ", "reg.exe", "taskkill", "sc ", "sc.exe",
        "del /f /s", "rm -rf /", "rmdir /s", "rd /s", "cipher /w", "bcdedit", "sfc ",
        "powershell -enc", "pwsh -enc", "cmd /c format", "net user", "net localgroup", "attrib -r -s",
    ];

    public async Task<ToolResult> ExecuteAsync(string toolName, string inputJson, string? workspacePath, TimeSpan timeout, CancellationToken cancellationToken = default, Guid? missionId = null)
    {
        try
        {
            return toolName switch
            {
                "workspace.inspect" => InspectWorkspace(workspacePath, inputJson),
                "project.analyze" => AnalyzeProject(workspacePath, inputJson),
                "code.search" => SearchCode(workspacePath, inputJson),
                "filesystem.list" => ListDirectory(workspacePath, inputJson),
                "filesystem.read" => ReadFile(workspacePath, inputJson),
                "filesystem.write" => WriteFile(workspacePath, inputJson),
                "process.run" => await RunProcessAsync(workspacePath, inputJson, timeout, cancellationToken),
                "dotnet.build" => await RunProcessAsync(workspacePath, WithCommand(inputJson, "dotnet build"), timeout, cancellationToken),
                "dotnet.test" => await RunProcessAsync(workspacePath, WithCommand(inputJson, "dotnet test"), timeout, cancellationToken),
                "git.status" => await RunProcessAsync(workspacePath, "{\"command\":\"git status --short\"}", timeout, cancellationToken),
                "git.diff" => await RunProcessAsync(workspacePath, "{\"command\":\"git diff --stat\"}", timeout, cancellationToken),
                "ollama.models" => await ListModelsAsync(cancellationToken),
                "computer.open_application" => Computer(computer.OpenApplication(GetStringArg(inputJson, "app") ?? string.Empty)),
                "computer.close_application" => Computer(computer.CloseApplication(GetStringArg(inputJson, "app") ?? string.Empty)),
                "computer.list_processes" => Computer(computer.ListProcesses(GetStringArg(inputJson, "name"))),
                "computer.get_active_window" => Computer(computer.GetActiveWindow()),
                "computer.focus_window" => Computer(computer.FocusWindow(GetStringArg(inputJson, "app") ?? string.Empty)),
                "computer.minimize_window" => Computer(computer.MinimizeWindow(GetStringArg(inputJson, "app") ?? string.Empty)),
                "computer.maximize_window" => Computer(computer.MaximizeWindow(GetStringArg(inputJson, "app") ?? string.Empty)),
                "computer.open_url" => Computer(computer.OpenUrl(GetStringArg(inputJson, "url") ?? string.Empty)),
                "computer.get_clipboard" => Computer(computer.GetClipboard()),
                "computer.set_clipboard" => Computer(computer.SetClipboard(GetStringArg(inputJson, "text") ?? string.Empty)),
                "computer.screenshot" => Computer(computer.CaptureScreenshot(GetStringArg(inputJson, "savePath"))),
                "web.search" => await SearchWebAsync(inputJson, cancellationToken),
                "web.fetch" => await FetchWebPageAsync(inputJson, cancellationToken),
                "submission.dispatch" => await DispatchSubAgentAsync(missionId, workspacePath, inputJson, timeout, cancellationToken),
                _ => new ToolResult(false, "", $"Unknown tool: {toolName}"),
            };
        }
        catch (UnauthorizedAccessException ex)
        {
            return new ToolResult(false, "", ex.Message);
        }
        catch (Exception ex)
        {
            return new ToolResult(false, "", $"{ex.GetType().Name}: {ex.Message}");
        }
    }

    private ToolResult InspectWorkspace(string? workspacePath, string inputJson)
    {
        var workspace = policy.ValidateWorkspace(workspacePath);
        var result = new Dictionary<string, object?>
        {
            ["root"] = workspace,
            ["project"] = DetectProjectName(workspace),
        };

        var entries = new List<object>();
        foreach (var entry in Directory.EnumerateFileSystemEntries(workspace))
        {
            var name = Path.GetFileName(entry);
            if (Directory.Exists(entry) && SkippedDirectories.Contains(name)) continue;
            entries.Add(new { name, type = Directory.Exists(entry) ? "dir" : "file" });
        }
        result["entries"] = entries;

        var manifests = new Dictionary<string, string>();
        foreach (var manifest in DiscoverManifests(workspace))
        {
            manifests[Path.GetFileName(manifest)] = ReadCapped(manifest, InspectManifestCapBytes);
        }
        result["manifests"] = manifests;

        return new ToolResult(true, JsonSerializer.Serialize(result, JsonOptions));
    }

    private ToolResult AnalyzeProject(string? workspacePath, string inputJson)
    {
        var workspace = policy.ValidateWorkspace(workspacePath);
        var result = new Dictionary<string, object?>
        {
            ["name"] = DetectProjectName(workspace),
            ["buildSystem"] = DetectBuildSystem(workspace),
            ["hasGit"] = Directory.Exists(Path.Combine(workspace, ".git")),
        };

        result["solutions"] = Directory.EnumerateFiles(workspace, "*.sln", SearchOption.TopDirectoryOnly).Select(Path.GetFileName).ToArray();
        result["projects"] = Directory.EnumerateFiles(workspace, "*.csproj", SearchOption.TopDirectoryOnly).Select(Path.GetFileName).ToArray();

        var manifests = new Dictionary<string, string>();
        foreach (var manifest in DiscoverManifests(workspace))
            manifests[Path.GetFileName(manifest)] = ReadCapped(manifest, InspectManifestCapBytes);
        result["manifests"] = manifests;

        result["testDirectories"] = Directory.EnumerateDirectories(workspace)
            .Where(d => Path.GetFileName(d).Contains("test", StringComparison.OrdinalIgnoreCase))
            .Select(Path.GetFileName).ToArray();
        result["testProjects"] = Directory.EnumerateFiles(workspace, "*Tests*.csproj", SearchOption.TopDirectoryOnly)
            .Select(Path.GetFileName).ToArray();

        return new ToolResult(true, JsonSerializer.Serialize(result, JsonOptions));
    }

    private ToolResult SearchCode(string? workspacePath, string inputJson)
    {
        var workspace = policy.ValidateWorkspace(workspacePath);
        using var doc = JsonDocument.Parse(inputJson);
        var pattern = doc.RootElement.TryGetProperty("pattern", out var p) ? p.GetString() : null;
        if (string.IsNullOrWhiteSpace(pattern))
            return new ToolResult(false, "", "code.search requires {\"pattern\"}.");

        var root = ".";
        if (doc.RootElement.TryGetProperty("path", out var pathProp) && pathProp.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(pathProp.GetString()))
            root = pathProp.GetString()!;
        var fullRoot = policy.ValidateChildPath(workspace, root);

        var useRegex = doc.RootElement.TryGetProperty("regex", out var regexProp) && regexProp.ValueKind == JsonValueKind.True;
        Regex? compiled = null;
        if (useRegex)
        {
            try { compiled = new Regex(pattern, RegexOptions.Compiled | RegexOptions.CultureInvariant); }
            catch (ArgumentException ex) { return new ToolResult(false, "", $"Invalid regular expression: {ex.Message}"); }
        }

        const int maxMatches = 100;
        const int maxFiles = 400;
        var matches = new List<object>();
        var filesScanned = 0;
        var skippedBinary = 0;

        foreach (var file in EnumerateSearchableFiles(fullRoot))
        {
            if (++filesScanned > maxFiles) break;
            string[] lines;
            try
            {
                var text = File.ReadAllText(file);
                if (text.Contains('\0')) { skippedBinary++; continue; }
                lines = text.Split('\n');
            }
            catch { continue; }

            var relative = Path.GetRelativePath(workspace, file);
            for (var i = 0; i < lines.Length && matches.Count < maxMatches; i++)
            {
                var line = lines[i].TrimEnd('\r');
                var isMatch = compiled is not null ? compiled.IsMatch(line) : line.Contains(pattern, StringComparison.OrdinalIgnoreCase);
                if (isMatch)
                    matches.Add(new { path = relative, line = i + 1, text = line.Length > 160 ? line[..160] : line });
            }
            if (matches.Count >= maxMatches) break;
        }

        return new ToolResult(true, JsonSerializer.Serialize(new
        {
            pattern,
            regex = useRegex,
            matchCount = matches.Count,
            truncated = matches.Count >= maxMatches,
            filesScanned,
            skippedBinary,
            matches,
        }, JsonOptions));
    }

    private static IEnumerable<string> EnumerateSearchableFiles(string root)
    {
        var queue = new Stack<string>();
        queue.Push(root);
        while (queue.Count > 0)
        {
            var current = queue.Pop();
            foreach (var directory in Directory.EnumerateDirectories(current))
            {
                var name = Path.GetFileName(directory);
                if (!SkippedDirectories.Contains(name)) queue.Push(directory);
            }
            foreach (var file in Directory.EnumerateFiles(current))
                yield return file;
        }
    }

    private static string DetectBuildSystem(string workspace)
    {
        var files = EnumerateSearchableFiles(workspace).Take(500).ToArray();
        var systems = new List<string>();
        if (files.Any(f => f.EndsWith(".sln", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".csproj", StringComparison.OrdinalIgnoreCase))) systems.Add("dotnet");
        if (files.Any(f => Path.GetFileName(f).Equals("package.json", StringComparison.OrdinalIgnoreCase))) systems.Add("node");
        if (files.Any(f => Path.GetFileName(f).Equals("pyproject.toml", StringComparison.OrdinalIgnoreCase) || Path.GetFileName(f).StartsWith("requirements", StringComparison.OrdinalIgnoreCase))) systems.Add("python");
        if (files.Any(f => Path.GetFileName(f).Equals("Cargo.toml", StringComparison.OrdinalIgnoreCase))) systems.Add("rust");
        if (files.Any(f => Path.GetFileName(f).Equals("go.mod", StringComparison.OrdinalIgnoreCase))) systems.Add("go");
        if (files.Any(f => Path.GetFileName(f).Equals("pom.xml", StringComparison.OrdinalIgnoreCase))) systems.Add("java");
        return systems.Count > 0 ? string.Join("+", systems) : "other";
    }

    private static IEnumerable<string> DiscoverManifests(string workspace)
    {
        var candidates = EnumerateSearchableFiles(workspace)
            .Where(f =>
            {
                var name = Path.GetFileName(f);
                if (name.StartsWith("README", StringComparison.OrdinalIgnoreCase)) return true;
                if (name.EndsWith(".sln", StringComparison.OrdinalIgnoreCase)) return true;
                if (name.EndsWith(".csproj", StringComparison.OrdinalIgnoreCase)) return true;
                if (name.Equals("package.json", StringComparison.OrdinalIgnoreCase)) return true;
                if (name.Equals("Cargo.toml", StringComparison.OrdinalIgnoreCase)) return true;
                if (name.Equals("go.mod", StringComparison.OrdinalIgnoreCase)) return true;
                if (name.Equals("pyproject.toml", StringComparison.OrdinalIgnoreCase)) return true;
                if (name.StartsWith("requirements", StringComparison.OrdinalIgnoreCase)) return true;
                if (name.Equals("pom.xml", StringComparison.OrdinalIgnoreCase)) return true;
                if (name.StartsWith("build.gradle", StringComparison.OrdinalIgnoreCase)) return true;
                if (name.Equals("tsconfig.json", StringComparison.OrdinalIgnoreCase)) return true;
                if (name.Equals("vite.config.ts", StringComparison.OrdinalIgnoreCase)) return true;
                return false;
            }).Take(20);
        foreach (var candidate in candidates.OrderBy(f => f.Length)) yield return candidate;
    }

    private ToolResult ListDirectory(string? workspacePath, string inputJson)
    {
        var workspace = policy.ValidateWorkspace(workspacePath);
        var path = ParsePath(inputJson);
        var full = policy.ValidateChildPath(workspace, path);

        var entries = new List<object>();
        foreach (var entry in Directory.EnumerateFileSystemEntries(full))
        {
            var name = Path.GetFileName(entry);
            if (Directory.Exists(entry) && SkippedDirectories.Contains(name)) continue;
            long size = 0;
            if (File.Exists(entry)) size = new FileInfo(entry).Length;
            entries.Add(new { name, type = Directory.Exists(entry) ? "dir" : "file", size });
        }
        return new ToolResult(true, JsonSerializer.Serialize(new { path = full, entries }, JsonOptions));
    }

    private ToolResult ReadFile(string? workspacePath, string inputJson)
    {
        var workspace = policy.ValidateWorkspace(workspacePath);
        var path = ParsePath(inputJson);
        var full = policy.ValidateChildPath(workspace, path);
        if (!File.Exists(full)) return new ToolResult(false, "", $"File not found: {path}");
        return new ToolResult(true, ReadCapped(full, ReadFileCapBytes));
    }

    private ToolResult WriteFile(string? workspacePath, string inputJson)
    {
        var workspace = policy.ValidateWorkspace(workspacePath);
        using var doc = JsonDocument.Parse(inputJson);
        var path = doc.RootElement.TryGetProperty("path", out var p) ? p.GetString() : null;
        var content = doc.RootElement.TryGetProperty("content", out var c) ? c.GetString() : null;
        if (string.IsNullOrWhiteSpace(path) || content is null) return new ToolResult(false, "", "Write requires {\"path\", \"content\"}.");
        var full = policy.ValidateChildPath(workspace, path);
        var directory = Path.GetDirectoryName(full);
        if (directory is not null) Directory.CreateDirectory(directory);
        File.WriteAllText(full, content);
        return new ToolResult(true, $"Wrote {full} ({content.Length} characters).");
    }

    private async Task<ToolResult> RunProcessAsync(string? workspacePath, string inputJson, TimeSpan timeout, CancellationToken cancellationToken)
    {
        var workspace = policy.ValidateWorkspace(workspacePath);
        using var doc = JsonDocument.Parse(inputJson);
        var command = doc.RootElement.TryGetProperty("command", out var c) ? c.GetString() : null;
        if (string.IsNullOrWhiteSpace(command)) return new ToolResult(false, "", "process.run requires {\"command\"}.");

        var rejected = DangerousCommandTokens.FirstOrDefault(token => command.Contains(token, StringComparison.OrdinalIgnoreCase));
        if (rejected is not null)
            return new ToolResult(false, "", $"Command contains a denylisted pattern ('{rejected}') and was refused.");

        var fileName = "cmd.exe";
        var arguments = $"/C {command}";
        if (!OperatingSystem.IsWindows())
        {
            fileName = "/bin/bash";
            arguments = $"-c \"{command}\"";
        }

        var startInfo = new ProcessStartInfo(fileName, arguments)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = workspace,
        };
        using var process = Process.Start(startInfo);
        if (process is null) return new ToolResult(false, "", "Failed to start process.");

        var stdout = new StringBuilder();
        var stderr = new StringBuilder();
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) AppendCapped(stdout, e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) AppendCapped(stderr, e.Data); };
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        try
        {
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(timeout);
            try
            {
                await process.WaitForExitAsync(timeoutCts.Token);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                process.Kill(true);
                return new ToolResult(false, "", $"Process timed out after {(int)timeout.TotalSeconds}s.");
            }
            catch (OperationCanceledException)
            {
                process.Kill(true);
                return new ToolResult(false, "", "Process cancelled.");
            }
        }
        finally
        {
            process.WaitForExit(); // flush async output readers
        }

        var output = stdout.ToString().Trim();
        var error = stderr.ToString().Trim();
        if (process.ExitCode != 0)
        {
            return new ToolResult(false, output, $"exit {process.ExitCode}: {error}".Trim());
        }
        return new ToolResult(true, output);
    }

    private async Task<ToolResult> ListModelsAsync(CancellationToken cancellationToken)
    {
        var status = await ollama.GetStatusAsync(cancellationToken);
        if (!status.Connected) return new ToolResult(false, "", $"Ollama unreachable: {status.Error}");
        return new ToolResult(true, JsonSerializer.Serialize(new { models = status.Models }, JsonOptions));
    }

    private static string WithCommand(string inputJson, string command)
    {
        try
        {
            using var doc = JsonDocument.Parse(inputJson);
            if (doc.RootElement.TryGetProperty("path", out var path) && path.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(path.GetString()))
                return JsonSerializer.Serialize(new { command = $"{command} \"{path.GetString()}\"" });
        }
        catch (JsonException) { /* fall through */ }
        return JsonSerializer.Serialize(new { command });
    }

    private static string? DetectProjectName(string workspace)
    {
        var sln = Directory.EnumerateFiles(workspace, "*.sln").FirstOrDefault();
        if (sln is not null) return Path.GetFileNameWithoutExtension(sln);
        var csproj = Directory.EnumerateFiles(workspace, "*.csproj").FirstOrDefault();
        if (csproj is not null) return Path.GetFileNameWithoutExtension(csproj);
        var packageJson = Path.Combine(workspace, "package.json");
        if (File.Exists(packageJson))
        {
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(packageJson));
                if (doc.RootElement.TryGetProperty("name", out var name)) return name.GetString();
            }
            catch { /* not JSON */ }
        }
        return new DirectoryInfo(workspace).Name;
    }

    private static string ReadCapped(string path, int cap)
    {
        var text = File.ReadAllText(path);
        if (text.Length <= cap) return text;
        return text[..cap] + $"\n… [truncated at {cap} characters]";
    }

    private static void AppendCapped(StringBuilder builder, string line)
    {
        if (builder.Length > OutputCapChars) return;
        builder.AppendLine(line);
    }

    private static string ParsePath(string inputJson)
    {
        if (string.IsNullOrWhiteSpace(inputJson)) return ".";
        using var doc = JsonDocument.Parse(inputJson);
        return doc.RootElement.TryGetProperty("path", out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() ?? "." : ".";
    }

    /// <summary>
    /// Multi-agent: creates a real sub-mission in a specialist lane and runs it
    /// through the same agent pipeline (nested, inline). The sub-mission is a
    /// normal mission row — if it pauses for approval, it resumes independently
    /// through the worker's normal claim flow once granted.
    /// </summary>
    private async Task<ToolResult> DispatchSubAgentAsync(Guid? missionId, string? workspacePath, string inputJson, TimeSpan timeout, CancellationToken cancellationToken)
    {
        if (subAgentRunner is null || missions is null || events is null)
            return new ToolResult(false, "", "submission.dispatch is not available in this host.");
        if (missionId is null)
            return new ToolResult(false, "", "submission.dispatch requires a parent mission context.");

        using var doc = JsonDocument.Parse(inputJson);
        var goal = doc.RootElement.TryGetProperty("goal", out var goalProp) ? goalProp.GetString() : null;
        var laneText = doc.RootElement.TryGetProperty("lane", out var laneProp) ? laneProp.GetString() : null;
        if (string.IsNullOrWhiteSpace(goal))
            return new ToolResult(false, "", "submission.dispatch requires {\"goal\"}.");
        if (!Enum.TryParse<MissionLane>(laneText, ignoreCase: true, out var lane) || lane == MissionLane.Master)
            return new ToolResult(false, "", "submission.dispatch lane must be 'Coder' or 'Computer'.");

        var parent = missions.Get(missionId.Value);
        if (parent is null)
            return new ToolResult(false, "", $"Parent mission {missionId} was not found.");

        var sub = missions.Create(new CreateMissionRequest(goal, workspacePath, lane, missionId));
        events.Publish(new MissionEvent(sub.Id, AgentEventTypes.MissionCreated, sub.Goal, DateTimeOffset.UtcNow));
        missions.Transition(sub.Id, MissionStatus.Running);
        events.Publish(new MissionEvent(sub.Id, AgentEventTypes.MissionStarted, sub.Goal, DateTimeOffset.UtcNow));

        try
        {
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            linked.CancelAfter(timeout);
            var outcome = await subAgentRunner.Value.RunAsync(sub.Id, linked.Token);

            return outcome.Kind switch
            {
                MissionOutcomeKind.Completed => new ToolResult(true, JsonSerializer.Serialize(new
                {
                    dispatched = true,
                    subMissionId = sub.Id,
                    lane = lane.ToString(),
                    goal = sub.Goal,
                    status = "completed",
                    result = outcome.Result,
                }, JsonOptions)),
                MissionOutcomeKind.WaitingForApproval => new ToolResult(true, JsonSerializer.Serialize(new
                {
                    dispatched = true,
                    subMissionId = sub.Id,
                    lane = lane.ToString(),
                    goal = sub.Goal,
                    status = "waiting_for_approval",
                    approvalId = outcome.ApprovalId,
                    note = "The sub-mission is waiting for human approval and will resume on its own once granted.",
                }, JsonOptions)),
                _ => new ToolResult(true, JsonSerializer.Serialize(new
                {
                    dispatched = true,
                    subMissionId = sub.Id,
                    lane = lane.ToString(),
                    goal = sub.Goal,
                    status = "cancelled",
                }, JsonOptions)),
            };
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            await FailSubAsync(sub.Id, sub.Goal, $"Sub-mission timed out after {(int)timeout.TotalSeconds}s.");
            return new ToolResult(false, "", $"Sub-mission timed out after {(int)timeout.TotalSeconds}s.");
        }
        catch (Exception ex)
        {
            var message = ex is OllamaException ? ex.Message : $"Sub-mission failed: {ex.Message}";
            await FailSubAsync(sub.Id, sub.Goal, message);
            return new ToolResult(false, "", message);
        }
    }

    private async Task FailSubAsync(Guid subId, string goal, string error)
    {
        try
        {
            var current = missions!.Get(subId);
            if (current is null || current.Status is MissionStatus.Completed or MissionStatus.Failed or MissionStatus.Cancelled) return;
            missions!.SetResult(subId, null, error);
            missions!.Transition(subId, MissionStatus.Failed);
            events!.Publish(new MissionEvent(subId, AgentEventTypes.MissionFailed, goal, DateTimeOffset.UtcNow));
        }
        catch
        {
            // sub-mission already terminal — nothing to clean up
        }
        await Task.CompletedTask;
    }

    /// <summary>Wraps a ComputerTools JSON result (success/error envelope) into a ToolResult.</summary>
    private static ToolResult Computer(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var ok = doc.RootElement.TryGetProperty("success", out var success) && success.GetBoolean();
            var error = ok ? null : doc.RootElement.TryGetProperty("error", out var reason) ? reason.GetString() : json;
            return new ToolResult(ok, ok ? json : string.Empty, error);
        }
        catch (JsonException)
        {
            return new ToolResult(false, string.Empty, json);
        }
    }

    private static string? GetStringArg(string inputJson, string key)
    {
        if (string.IsNullOrWhiteSpace(inputJson)) return null;
        try
        {
            using var doc = JsonDocument.Parse(inputJson);
            return doc.RootElement.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private async Task<ToolResult> SearchWebAsync(string inputJson, CancellationToken cancellationToken)
    {
        var query = GetStringArg(inputJson, "query");
        if (string.IsNullOrWhiteSpace(query)) return new ToolResult(false, "", "Search query is required.");

        try
        {
            using var client = new HttpClient();
            client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) KERAI/1.0");
            var url = $"https://html.duckduckgo.com/html/?q={Uri.EscapeDataString(query)}";
            var html = await client.GetStringAsync(url, cancellationToken);

            var matches = Regex.Matches(html, @"<a[^>]+class=""result__url""[^>]*href=""([^""]+)""[^>]*>\s*(.*?)\s*</a>", RegexOptions.IgnoreCase);
            var snippets = Regex.Matches(html, @"<a[^>]+class=""result__snippet""[^>]*>\s*(.*?)\s*</a>", RegexOptions.IgnoreCase);

            var results = new List<object>();
            for (int i = 0; i < Math.Min(5, matches.Count); i++)
            {
                var link = matches[i].Groups[1].Value;
                var title = Regex.Replace(matches[i].Groups[2].Value, "<.*?>", "").Trim();
                var snippet = i < snippets.Count ? Regex.Replace(snippets[i].Groups[1].Value, "<.*?>", "").Trim() : "";
                results.Add(new { title, link, snippet });
            }

            var payload = JsonSerializer.Serialize(new { query, resultsCount = results.Count, results }, JsonOptions);
            return new ToolResult(true, payload);
        }
        catch (Exception ex)
        {
            return new ToolResult(false, "", $"Web search failed: {ex.Message}");
        }
    }

    private async Task<ToolResult> FetchWebPageAsync(string inputJson, CancellationToken cancellationToken)
    {
        var url = GetStringArg(inputJson, "url");
        if (string.IsNullOrWhiteSpace(url)) return new ToolResult(false, "", "URL is required.");
        if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed) || (parsed.Scheme != "http" && parsed.Scheme != "https"))
            return new ToolResult(false, "", "Only http and https URLs can be fetched.");

        try
        {
            using var client = new HttpClient();
            client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) KERAI/1.0");
            var html = await client.GetStringAsync(url, cancellationToken);

            var text = Regex.Replace(html, @"<(script|style)[^>]*>.*?</\1>", "", RegexOptions.Singleline | RegexOptions.IgnoreCase);
            text = Regex.Replace(text, @"<.*?>", " ");
            text = System.Net.WebUtility.HtmlDecode(text);
            text = Regex.Replace(text, @"\s+", " ").Trim();

            if (text.Length > OutputCapChars) text = text.Substring(0, OutputCapChars) + "\n... (content truncated)";

            var payload = JsonSerializer.Serialize(new { url = parsed.ToString(), length = text.Length, content = text }, JsonOptions);
            return new ToolResult(true, payload);
        }
        catch (Exception ex)
        {
            return new ToolResult(false, "", $"Web fetch failed: {ex.Message}");
        }
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
}
