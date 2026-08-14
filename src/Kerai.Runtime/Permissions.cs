using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using Kerai.Contracts;

namespace Kerai.Runtime;

public interface IPermissionEngine
{
    /// <summary>True when the tool may run without human approval.</summary>
    bool IsAutoApproved(ToolContract tool);

    /// <summary>
    /// Resolves whether the exact operation may proceed. Returns a pending/denied
    /// approval when human approval is required; null means it may run (auto-approved
    /// or a previously granted, unexpired approval for the identical operation).
    /// </summary>
    ApprovalDto? RequireApproval(Guid missionId, ToolContract tool, string inputJson, out bool granted);
}

public interface IApprovalStore
{
    IReadOnlyCollection<ApprovalDto> List(Guid? missionId = null);
    ApprovalDto? Get(Guid id);
    ApprovalDto? FindByKey(string key);
    ApprovalDto Create(Guid missionId, string toolName, string input, string key);
    ApprovalDto Approve(Guid id);
    ApprovalDto Deny(Guid id);
}

/// <summary>Approval keys are the exact operation (mission + tool + hashed arguments).</summary>
public static class ApprovalKeys
{
    public static string For(Guid missionId, string toolName, string inputJson)
    {
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(inputJson)))[..16];
        return $"{missionId}|{toolName}|{hash}";
    }
}

/// <summary>
/// Always-on trust mode: every tool is auto-approved. No human gate is raised.
/// The dangerous command denylist in ToolExecutor still blocks destructive shell tokens,
/// but no approval dialog will ever appear during normal agent operation.
/// </summary>
public sealed class PermissionEngine(IApprovalStore approvals) : IPermissionEngine
{
    public bool IsAutoApproved(ToolContract tool) => true;

    public ApprovalDto? RequireApproval(Guid missionId, ToolContract tool, string inputJson, out bool granted)
    {
        granted = true;
        return null; // Always auto-approved — no human gate required.
    }
}

/// <summary>In-memory approval store (used by tests and as a fallback).</summary>
public sealed class InMemoryApprovalStore : IApprovalStore
{
    private static readonly TimeSpan ApprovalLifetime = TimeSpan.FromMinutes(5);
    private readonly ConcurrentDictionary<Guid, ApprovalDto> approvals = new();
    private readonly ConcurrentDictionary<string, Guid> keyToId = new();

    public IReadOnlyCollection<ApprovalDto> List(Guid? missionId = null)
    {
        var all = approvals.Values.OrderByDescending(a => a.ExpiresAt).ToArray();
        return missionId.HasValue ? all.Where(a => a.MissionId == missionId.Value).ToArray() : all;
    }

    public ApprovalDto? Get(Guid id) => approvals.TryGetValue(id, out var approval) ? approval : null;

    public ApprovalDto? FindByKey(string key) =>
        keyToId.TryGetValue(key, out var id) && approvals.TryGetValue(id, out var approval) ? approval : null;

    public ApprovalDto Create(Guid missionId, string toolName, string input, string key)
    {
        var approval = new ApprovalDto(Guid.NewGuid(), missionId, toolName, input, ApprovalStatus.Pending, DateTimeOffset.UtcNow.Add(ApprovalLifetime));
        approvals[approval.Id] = approval;
        keyToId[key] = approval.Id;
        return approval;
    }

    public ApprovalDto Approve(Guid id)
    {
        if (!approvals.TryGetValue(id, out var approval)) throw new KeyNotFoundException($"Approval {id} was not found.");
        if (approval.ExpiresAt <= DateTimeOffset.UtcNow)
        {
            approvals[id] = approval with { Status = ApprovalStatus.Expired };
            throw new InvalidOperationException("Approval has expired; request it again.");
        }
        var granted = approval with { Status = ApprovalStatus.Granted };
        approvals[id] = granted;
        return granted;
    }

    public ApprovalDto Deny(Guid id)
    {
        if (!approvals.TryGetValue(id, out var approval)) throw new KeyNotFoundException($"Approval {id} was not found.");
        var denied = approval with { Status = ApprovalStatus.Denied };
        approvals[id] = denied;
        return denied;
    }
}
