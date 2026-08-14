namespace Kerai.Contracts;

public enum MissionStatus { Created, Running, WaitingForApproval, Verifying, Completed, Failed, Cancelled }
public enum PermissionLevel { Read = 0, Safe = 1, Modify = 2, System = 3, Critical = 4 }
public enum ApprovalStatus { Pending, Granted, Denied, Expired }

/// <summary>Specialist lane a mission runs in — scopes the tool allowlist and prompt.</summary>
public enum MissionLane { Master, Coder, Computer }

public sealed record CreateMissionRequest(string Goal, string? WorkspacePath = null, MissionLane? Lane = null, Guid? ParentMissionId = null);

/// <summary>
/// A mission. When <see cref="ParentMissionId"/> is set, this is a sub-mission
/// dispatched by a Master mission to a specialist lane; it is still a fully
/// independent mission that runs through the exact same permission pipeline.
/// </summary>
public sealed record MissionDto(Guid Id, string Goal, MissionStatus Status, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, string? WorkspacePath, MissionLane Lane = MissionLane.Master, string? Result = null, string? Error = null, Guid? ParentMissionId = null);

/// <summary>A persisted operational event. Sequence is the storage row id used for watermarks.</summary>
public sealed record MissionEvent(Guid MissionId, string Type, string Message, DateTimeOffset OccurredAt, long Sequence = 0);

public sealed record ToolContract(string Name, string Description, PermissionLevel Risk, bool RequiresApproval, TimeSpan Timeout, string InputSchema);
public sealed record ToolRequest(Guid MissionId, string ToolName, string Input, string ApprovalToken);
public sealed record ApprovalDto(Guid Id, Guid MissionId, string ToolName, string Input, ApprovalStatus Status, DateTimeOffset ExpiresAt);
public sealed record OllamaStatus(bool Connected, string Endpoint, IReadOnlyList<string> Models, string? Error);

/* ---- Agent core ---- */

/// <summary>
/// A chat message. Tool calls are preserved on assistant messages so multi-turn
/// tool calling keeps the structure Ollama's protocol expects; tool results are
/// role "tool" messages addressed by ToolCallId.
/// </summary>
public sealed record ChatMessage(string Role, string Content, IReadOnlyList<ToolCall>? ToolCalls = null, string? ToolCallId = null);

public sealed record ToolCall(string Name, string Arguments, string? Id = null);
public sealed record OllamaChatResult(string? Content, IReadOnlyList<ToolCall> ToolCalls);

public sealed record ToolExecution(string ToolName, bool Ok, string Output, string? Error = null);
public sealed record VerificationVerdict(bool Passed, string? Reason = null);

public sealed record KeraiSettings(string DefaultModel, string WorkspaceRoot);
public sealed record UpdateModelRequest(string Model);
public sealed record UpdateWorkspaceRequest(string Root);

/* ---- Automations (scheduled missions; execution still goes through permissions) ---- */

public enum AutomationFrequency { Interval, Daily }

public sealed record AutomationDto(
    Guid Id,
    string Label,
    string Prompt,
    AutomationFrequency Frequency,
    int? IntervalMinutes,
    string? DailyAt,
    bool Enabled,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastFiredAt,
    int MissionCount);

public sealed record CreateAutomationRequest(string Label, string Prompt, AutomationFrequency Frequency, int? IntervalMinutes = null, string? DailyAt = null);
public sealed record UpdateAutomationRequest(string? Label = null, string? Prompt = null, AutomationFrequency? Frequency = null, int? IntervalMinutes = null, string? DailyAt = null, bool? Enabled = null);

/* ---- Memory & workspace ---- */

public sealed record MemorySnapshotDto(
    IReadOnlyList<MissionDto> Missions,
    IReadOnlyList<MissionEvent> Events,
    IReadOnlyList<ApprovalDto> Approvals,
    int ActiveMissionCount);

public sealed record WorkspaceEntryDto(string Name, bool IsDirectory, long SizeBytes);
public sealed record WorkspaceSummaryDto(
    string Name,
    string Root,
    int EntryCount,
    int FileCount,
    int DirectoryCount,
    bool HasGit,
    bool HasSolution,
    IReadOnlyList<string> Manifests,
    IReadOnlyList<WorkspaceEntryDto> TopEntries,
    string? Error = null);

/* ---- System telemetry ---- */

public sealed record StorageMetric(string Mount, long TotalBytes, long UsedBytes, double PercentUsed);
public sealed record GpuMetric(string? Name, double? UtilizationPercent, double? VramPercent);
public sealed record SystemStatusDto(double CpuPercent, double RamPercent, long RamTotalBytes, long RamUsedBytes, IReadOnlyList<StorageMetric> Storage, GpuMetric? Gpu, string Os, DateTimeOffset Timestamp, string? Error);
