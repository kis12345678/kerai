using System.Collections.Concurrent;
using Kerai.Contracts;

namespace Kerai.Runtime;

public interface IMissionStore
{
    MissionDto Create(CreateMissionRequest request);
    MissionDto? Get(Guid id);
    IReadOnlyCollection<MissionDto> List();
    MissionDto Transition(Guid id, MissionStatus next);
    MissionDto SetResult(Guid id, string? result, string? error);

    /// <summary>
    /// Atomically claims the next runnable mission: a Created mission, or a
    /// WaitingForApproval mission whose approval has been granted. Only one
    /// consumer (the worker) gets it. Returns null when nothing is runnable.
    /// </summary>
    MissionDto? ClaimNext();
}

public sealed class InMemoryMissionStore : IMissionStore
{
    private readonly ConcurrentDictionary<Guid, MissionDto> missions = new();
    private readonly IApprovalStore? approvals;

    public InMemoryMissionStore(IApprovalStore? approvals = null) => this.approvals = approvals;

    public MissionDto Create(CreateMissionRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Goal)) throw new ArgumentException("Goal is required.", nameof(request));
        var now = DateTimeOffset.UtcNow;
        var mission = new MissionDto(Guid.NewGuid(), request.Goal.Trim(), MissionStatus.Created, now, now, request.WorkspacePath, AgentLanes.Normalize(request.Lane), ParentMissionId: request.ParentMissionId);
        missions[mission.Id] = mission;
        return mission;
    }

    public MissionDto? Get(Guid id) => missions.TryGetValue(id, out var mission) ? mission : null;
    public IReadOnlyCollection<MissionDto> List() => missions.Values.OrderByDescending(x => x.UpdatedAt).ToArray();

    public MissionDto Transition(Guid id, MissionStatus next)
    {
        while (true)
        {
            if (!missions.TryGetValue(id, out var current)) throw new KeyNotFoundException($"Mission {id} was not found.");
            if (!MissionTransitions.IsAllowed(current.Status, next)) throw new InvalidOperationException($"Cannot transition mission from {current.Status} to {next}.");
            var updated = current with { Status = next, UpdatedAt = DateTimeOffset.UtcNow };
            if (missions.TryUpdate(id, updated, current)) return updated;
        }
    }

    public MissionDto SetResult(Guid id, string? result, string? error)
    {
        while (true)
        {
            if (!missions.TryGetValue(id, out var current)) throw new KeyNotFoundException($"Mission {id} was not found.");
            if (current.Status is MissionStatus.Completed or MissionStatus.Failed or MissionStatus.Cancelled)
                throw new InvalidOperationException($"Mission {id} is already in a terminal state.");
            var updated = current with { Result = result, Error = error, UpdatedAt = DateTimeOffset.UtcNow };
            if (missions.TryUpdate(id, updated, current)) return updated;
        }
    }

    public MissionDto? ClaimNext()
    {
        var now = DateTimeOffset.UtcNow;
        var next = missions.Values
            .Where(m => m.Status == MissionStatus.Created)
            .OrderBy(m => m.CreatedAt)
            .FirstOrDefault()
            ?? (approvals is null ? null : missions.Values
                .Where(m => m.Status == MissionStatus.WaitingForApproval)
                .OrderBy(m => m.CreatedAt)
                .FirstOrDefault(m => approvals.List(m.Id).Any(a => a.Status == ApprovalStatus.Granted && a.ExpiresAt > now)));
        if (next is null) return null;
        return Transition(next.Id, MissionStatus.Running);
    }
}

public static class MissionTransitions
{
    private static readonly IReadOnlyDictionary<MissionStatus, MissionStatus[]> Allowed = new Dictionary<MissionStatus, MissionStatus[]>
    {
        [MissionStatus.Created] = [MissionStatus.Running, MissionStatus.Cancelled],
        [MissionStatus.Running] = [MissionStatus.WaitingForApproval, MissionStatus.Verifying, MissionStatus.Completed, MissionStatus.Failed, MissionStatus.Cancelled],
        [MissionStatus.WaitingForApproval] = [MissionStatus.Running, MissionStatus.Failed, MissionStatus.Cancelled],
        [MissionStatus.Verifying] = [MissionStatus.Completed, MissionStatus.Failed, MissionStatus.Running],
        [MissionStatus.Completed] = [],
        [MissionStatus.Failed] = [],
        [MissionStatus.Cancelled] = []
    };

    public static bool IsAllowed(MissionStatus current, MissionStatus next) => Allowed.TryGetValue(current, out var targets) && targets.Contains(next);
}

public interface IToolRegistry
{
    IReadOnlyCollection<ToolContract> List();
    ToolContract Get(string name);
}

/// <summary>
/// Every capability is a tool with a real JSON input schema, a risk level, and an
/// approval requirement. Schemas are sent to the model verbatim so it calls tools
/// with correct arguments.
/// </summary>
public sealed class ToolRegistry : IToolRegistry
{
    private static string Schema(params (string Name, string Description, bool Required)[] properties)
    {
        var props = properties.ToDictionary(p => p.Name, p => (object)new { type = "string", description = p.Description });
        var required = properties.Where(p => p.Required).Select(p => p.Name).ToArray();
        return System.Text.Json.JsonSerializer.Serialize(new { type = "object", properties = props, required });
    }

    private static string TypedSchema(params (string Name, string Description, string Type, bool Required)[] properties)
    {
        var props = properties.ToDictionary(p => p.Name, p => (object)new { type = p.Type, description = p.Description });
        var required = properties.Where(p => p.Required).Select(p => p.Name).ToArray();
        return System.Text.Json.JsonSerializer.Serialize(new { type = "object", properties = props, required });
    }

    private readonly IReadOnlyDictionary<string, ToolContract> tools = new Dictionary<string, ToolContract>(StringComparer.OrdinalIgnoreCase)
    {
        ["workspace.inspect"] = new("workspace.inspect", "Inspect the workspace root: project name, top-level entries, and key manifest files.", PermissionLevel.Read, false, TimeSpan.FromSeconds(15), Schema()),
        ["project.analyze"] = new("project.analyze", "Analyze the project: build system, solutions, projects, manifests, test layout, and entry points. Read-only.", PermissionLevel.Read, false, TimeSpan.FromSeconds(20), Schema()),
        ["code.search"] = new("code.search", "Search workspace files for a text pattern or regular expression; returns file:line matches. Binary and dependency directories are skipped.", PermissionLevel.Read, false, TimeSpan.FromSeconds(20), TypedSchema(("pattern", "Text or regex pattern to search for", "string", true), ("path", "Optional path relative to the workspace to limit the search", "string", false), ("regex", "Set to true to treat the pattern as a regular expression", "boolean", false))),
        ["filesystem.list"] = new("filesystem.list", "List the entries of a directory inside the approved workspace.", PermissionLevel.Read, false, TimeSpan.FromSeconds(10), Schema(("path", "Path relative to the approved workspace", true))),
        ["filesystem.read"] = new("filesystem.read", "Read a file inside the approved workspace.", PermissionLevel.Read, false, TimeSpan.FromSeconds(10), Schema(("path", "Path relative to the approved workspace", true))),
        ["filesystem.write"] = new("filesystem.write", "Write a file inside the approved workspace.", PermissionLevel.Modify, true, TimeSpan.FromSeconds(30), Schema(("path", "Path relative to the approved workspace", true), ("content", "Full file content to write", true))),
        ["process.run"] = new("process.run", "Run a bounded diagnostic or test command in the workspace (denylisted dangerous commands).", PermissionLevel.Modify, true, TimeSpan.FromMinutes(2), Schema(("command", "Command to run, e.g. 'dotnet build' or 'npm run build'", true))),
        ["dotnet.build"] = new("dotnet.build", "Build a .NET project or solution in the workspace.", PermissionLevel.Modify, true, TimeSpan.FromMinutes(5), Schema(("path", "Optional path to project/solution relative to workspace", false))),
        ["dotnet.test"] = new("dotnet.test", "Run tests for a .NET project or solution in the workspace.", PermissionLevel.Modify, true, TimeSpan.FromMinutes(5), Schema(("path", "Optional path to project/solution relative to workspace", false))),
        ["git.status"] = new("git.status", "Show the git working tree status of the workspace.", PermissionLevel.Read, false, TimeSpan.FromSeconds(20), Schema()),
        ["git.diff"] = new("git.diff", "Show unstaged changes (diff) in the workspace.", PermissionLevel.Read, false, TimeSpan.FromSeconds(20), Schema()),
        ["ollama.models"] = new("ollama.models", "Discover locally available Ollama models.", PermissionLevel.Read, false, TimeSpan.FromSeconds(10), Schema()),

        /* Computer agent — controlled OS actions. No raw shell anywhere. */
        ["computer.open_application"] = new("computer.open_application", "Launch an installed application (e.g. 'chrome', 'notepad'). Names resolve through configurable app mappings (data/apps.json or KERAI_APPS).", PermissionLevel.Modify, true, TimeSpan.FromSeconds(25), Schema(("app", "Application name from the configured mappings, e.g. 'chrome'", true))),
        ["computer.close_application"] = new("computer.close_application", "Gracefully close an application's processes and verify they stopped.", PermissionLevel.System, true, TimeSpan.FromSeconds(35), Schema(("app", "Application name, e.g. 'chrome'", true))),
        ["computer.list_processes"] = new("computer.list_processes", "List running processes with pid, memory, and responsiveness (optionally filtered by name).", PermissionLevel.Read, false, TimeSpan.FromSeconds(10), Schema(("name", "Optional process name filter", false))),
        ["computer.get_active_window"] = new("computer.get_active_window", "Read the currently focused window (pid, process name, title).", PermissionLevel.Read, false, TimeSpan.FromSeconds(10), Schema()),
        ["computer.focus_window"] = new("computer.focus_window", "Bring an application's main window to the foreground.", PermissionLevel.Safe, false, TimeSpan.FromSeconds(10), Schema(("app", "Application name, e.g. 'chrome'", true))),
        ["computer.minimize_window"] = new("computer.minimize_window", "Minimize an application's main window.", PermissionLevel.Safe, false, TimeSpan.FromSeconds(10), Schema(("app", "Application name, e.g. 'chrome'", true))),
        ["computer.maximize_window"] = new("computer.maximize_window", "Maximize an application's main window.", PermissionLevel.Safe, false, TimeSpan.FromSeconds(10), Schema(("app", "Application name, e.g. 'chrome'", true))),
        ["computer.open_url"] = new("computer.open_url", "Open an http(s) URL in the default browser.", PermissionLevel.Modify, true, TimeSpan.FromSeconds(15), Schema(("url", "Absolute http(s) URL, e.g. 'https://youtube.com'", true))),
        ["computer.get_clipboard"] = new("computer.get_clipboard", "Read the current clipboard text.", PermissionLevel.Read, false, TimeSpan.FromSeconds(10), Schema()),
        ["computer.set_clipboard"] = new("computer.set_clipboard", "Replace the clipboard with the given text.", PermissionLevel.Modify, true, TimeSpan.FromSeconds(10), Schema(("text", "Text to place on the clipboard", true))),
        ["computer.screenshot"] = new("computer.screenshot", "Capture a desktop screenshot. Returns base64 PNG data, dimensions, and optionally saves to workspace.", PermissionLevel.Read, false, TimeSpan.FromSeconds(15), Schema(("savePath", "Optional relative path in workspace to save screenshot PNG file", false))),

        /* Web & Browser Intelligence */
        ["web.search"] = new("web.search", "Search the internet for real-time information, documentation, and technical answers.", PermissionLevel.Read, false, TimeSpan.FromSeconds(20), Schema(("query", "Search query string", true))),
        ["web.fetch"] = new("web.fetch", "Fetch and read the contents of a web page URL as clean text.", PermissionLevel.Read, false, TimeSpan.FromSeconds(20), Schema(("url", "Absolute HTTP or HTTPS URL to fetch", true))),

        /* Multi-agent — the Master dispatches sub-missions to specialist lanes. The
           sub-mission runs through the same permission pipeline; its own privileged
           actions still require approval, so dispatch grants no new capability. */
        ["submission.dispatch"] = new("submission.dispatch", "Dispatch a sub-mission to a specialist lane (Coder or Computer). Creates a real sub-mission with that lane's scoped tools and runs it through the same permission pipeline; its privileged actions still require approval. Returns the sub-mission's result (or 'waiting for approval') so the caller can report it.", PermissionLevel.Modify, true, TimeSpan.FromMinutes(15), TypedSchema(("goal", "What the sub-agent should accomplish", "string", true), ("lane", "Specialist lane: 'Coder' or 'Computer'", "string", true)))
    };

    public IReadOnlyCollection<ToolContract> List() => tools.Values.ToArray();
    public ToolContract Get(string name) => tools.TryGetValue(name, out var tool) ? tool : throw new KeyNotFoundException($"Unknown tool: {name}");
}

public interface IAutomationStore
{
    IReadOnlyCollection<AutomationDto> List();
    AutomationDto Create(CreateAutomationRequest request);
    AutomationDto Update(Guid id, UpdateAutomationRequest request);
    void Delete(Guid id);
    AutomationDto MarkFired(Guid id, DateTimeOffset firedAt);
}

/// <summary>
/// Pure scheduling rules for automations. Automations never execute anything
/// themselves — firing only creates a normal mission, which then goes through
/// the exact same permission/approval pipeline as a user-created mission, so an
/// automation can never silently gain new permissions.
/// </summary>
public static class AutomationRules
{
    public static void Validate(string label, string prompt, AutomationFrequency frequency, int? intervalMinutes, string? dailyAt)
    {
        if (string.IsNullOrWhiteSpace(label)) throw new ArgumentException("Label is required.", nameof(label));
        if (string.IsNullOrWhiteSpace(prompt)) throw new ArgumentException("Prompt is required.", nameof(prompt));
        switch (frequency)
        {
            case AutomationFrequency.Interval:
                if (intervalMinutes is null or < 1) throw new ArgumentException("Interval must be at least 1 minute.", nameof(intervalMinutes));
                if (!string.IsNullOrWhiteSpace(dailyAt)) throw new ArgumentException("DailyAt must be empty for interval automations.", nameof(dailyAt));
                break;
            case AutomationFrequency.Daily:
                if (string.IsNullOrWhiteSpace(dailyAt) ||
                    !TimeOnly.TryParseExact(dailyAt, "HH:mm", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out _))
                    throw new ArgumentException("DailyAt must be a 24-hour time in HH:mm.", nameof(dailyAt));
                if (intervalMinutes is not null) throw new ArgumentException("IntervalMinutes must be empty for daily automations.", nameof(intervalMinutes));
                break;
            default:
                throw new ArgumentException("Unknown frequency.", nameof(frequency));
        }
    }

    /// <summary>Due when now has passed the next occurrence after the anchor (created or last fired).</summary>
    public static bool IsDue(AutomationDto automation, DateTimeOffset now)
    {
        if (!automation.Enabled) return false;
        var anchor = automation.LastFiredAt ?? automation.CreatedAt;
        return automation.Frequency switch
        {
            AutomationFrequency.Interval => now >= anchor.AddMinutes(automation.IntervalMinutes ?? 1),
            // Daily times are interpreted in the machine's local time (this is a local-first product).
            AutomationFrequency.Daily => now >= NextDailyLocal(anchor.ToLocalTime(), automation.DailyAt ?? "00:00").ToUniversalTime(),
            _ => false
        };
    }

    private static DateTimeOffset NextDailyLocal(DateTimeOffset anchorLocal, string dailyAt)
    {
        var time = TimeOnly.ParseExact(dailyAt, "HH:mm", System.Globalization.CultureInfo.InvariantCulture);
        var candidate = new DateTimeOffset(anchorLocal.Year, anchorLocal.Month, anchorLocal.Day, time.Hour, time.Minute, 0, anchorLocal.Offset);
        if (candidate <= anchorLocal) candidate = candidate.AddDays(1);
        return candidate;
    }
}

public interface IWorkspacePolicy
{
    string ValidateWorkspace(string? requestedPath);
    string ValidateChildPath(string workspace, string requestedPath);
}

public sealed class WorkspacePolicy : IWorkspacePolicy
{
    private readonly string defaultWorkspace;
    public WorkspacePolicy(string? defaultWorkspace = null) => this.defaultWorkspace = Path.GetFullPath(defaultWorkspace ?? Environment.CurrentDirectory);

    public string ValidateWorkspace(string? requestedPath)
    {
        var workspace = Path.GetFullPath(string.IsNullOrWhiteSpace(requestedPath) ? defaultWorkspace : requestedPath);
        if (!Directory.Exists(workspace)) throw new DirectoryNotFoundException(workspace);
        return workspace;
    }

    public string ValidateChildPath(string workspace, string requestedPath)
    {
        var normalized = ValidateWorkspace(workspace).TrimEnd(Path.DirectorySeparatorChar);
        var root = normalized + Path.DirectorySeparatorChar;
        var full = Path.GetFullPath(Path.Combine(normalized, requestedPath));
        var within = full.Equals(normalized, StringComparison.OrdinalIgnoreCase)
            || full.StartsWith(root, StringComparison.OrdinalIgnoreCase);
        if (!within) throw new UnauthorizedAccessException("Path escapes the approved workspace.");
        return full;
    }
}
