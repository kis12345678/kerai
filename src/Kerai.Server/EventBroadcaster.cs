using Kerai.Contracts;
using Kerai.Runtime;

namespace Kerai.Server;

/// <summary>
/// Polls the shared event store on a watermark and broadcasts to WebSocket clients.
/// The worker writes events/missions to the same SQLite store, so the UI stays live
/// even though execution happens in another process.
/// </summary>
public sealed class EventBroadcaster(IAgentEventBus events, IMissionStore missions, EventHub hub, ILogger<EventBroadcaster> logger) : BackgroundService
{
    private static readonly string[] MissionStateEvents =
    [
        AgentEventTypes.MissionStarted,
        AgentEventTypes.MissionCompleted,
        AgentEventTypes.MissionFailed,
        AgentEventTypes.MissionCancelled,
        AgentEventTypes.ApprovalRequested,
    ];

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        long lastId = events.Recent(1).FirstOrDefault()?.Sequence ?? 0;
        logger.LogInformation("KERAI event broadcaster started at watermark {Watermark}.", lastId);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                foreach (var evt in events.Since(lastId))
                {
                    await hub.SendAsync(new { type = "activity", entry = evt }, stoppingToken);
                    if (MissionStateEvents.Contains(evt.Type))
                    {
                        var mission = missions.Get(evt.MissionId);
                        if (mission is not null)
                            await hub.SendAsync(new { type = "mission", mission }, stoppingToken);
                    }
                    lastId = evt.Sequence;
                }
            }
            catch (Exception ex)
            {
                logger.LogDebug(ex, "Broadcast pass failed; will retry.");
            }
            await Task.Delay(300, stoppingToken);
        }
    }
}
