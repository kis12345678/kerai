using Kerai.Contracts;

namespace Kerai.Runtime;

public static class AgentEventTypes
{
    public const string MissionCreated = "MISSION_CREATED";
    public const string MissionStarted = "MISSION_STARTED";
    public const string ToolStarted = "TOOL_STARTED";
    public const string ToolCompleted = "TOOL_COMPLETED";
    public const string ToolFailed = "TOOL_FAILED";
    public const string ApprovalRequested = "APPROVAL_REQUESTED";
    public const string ApprovalGranted = "APPROVAL_GRANTED";
    public const string ApprovalDenied = "APPROVAL_DENIED";
    public const string Verifying = "VERIFICATION";
    public const string MissionCompleted = "MISSION_COMPLETED";
    public const string MissionFailed = "MISSION_FAILED";
    public const string MissionCancelled = "MISSION_CANCELLED";
}

public interface IAgentEventBus
{
    void Publish(MissionEvent evt);
    /// <summary>Most recent events, newest first.</summary>
    IReadOnlyList<MissionEvent> Recent(int count);
    /// <summary>Events with Sequence &gt; lastId, oldest first (for broadcast watermarks).</summary>
    IReadOnlyList<MissionEvent> Since(long lastId);
    void Subscribe(Action<MissionEvent> handler);
}

public sealed class InMemoryAgentEventBus : IAgentEventBus
{
    private readonly object gate = new();
    private readonly List<MissionEvent> events = [];
    private readonly List<Action<MissionEvent>> handlers = [];
    private const int RingCapacity = 300;
    private long nextSequence;

    public void Publish(MissionEvent evt)
    {
        var sequenced = evt with { Sequence = ++nextSequence };
        lock (gate)
        {
            events.Add(sequenced);
            if (events.Count > RingCapacity) events.RemoveRange(0, events.Count - RingCapacity);
            foreach (var handler in handlers.ToArray()) handler(sequenced);
        }
    }

    public IReadOnlyList<MissionEvent> Recent(int count)
    {
        lock (gate) return events.Skip(Math.Max(0, events.Count - count)).Reverse().ToArray();
    }

    public IReadOnlyList<MissionEvent> Since(long lastId)
    {
        lock (gate) return events.Where(e => e.Sequence > lastId).OrderBy(e => e.Sequence).ToArray();
    }

    public void Subscribe(Action<MissionEvent> handler)
    {
        lock (gate) handlers.Add(handler);
    }
}
