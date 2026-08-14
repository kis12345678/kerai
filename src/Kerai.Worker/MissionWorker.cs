using Kerai.Contracts;
using Kerai.Runtime;

namespace Kerai.Worker;

/// <summary>
/// The execution authority. Claims the next runnable mission from the shared store
/// (Created, or WaitingForApproval whose approval was granted), runs the agent, and
/// records completion or failure. The Server never executes missions.
/// </summary>
public sealed class MissionWorker(
    IMissionStore missions,
    IAgentService agent,
    IAgentEventBus events,
    ILogger<MissionWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("KERAI worker started — awaiting missions.");
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var mission = missions.ClaimNext();
                if (mission is null)
                {
                    await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
                    continue;
                }

                logger.LogInformation("Claimed mission {MissionId}: {Goal}", mission.Id, mission.Goal);
                events.Publish(new MissionEvent(mission.Id, AgentEventTypes.MissionStarted, mission.Goal, DateTimeOffset.UtcNow));

                try
                {
                    var outcome = await agent.RunAsync(mission.Id, stoppingToken);
                    switch (outcome.Kind)
                    {
                        case MissionOutcomeKind.Completed:
                            logger.LogInformation("Mission {MissionId} completed.", mission.Id);
                            break;
                        case MissionOutcomeKind.WaitingForApproval:
                            logger.LogInformation("Mission {MissionId} waiting for approval.", mission.Id);
                            break;
                        case MissionOutcomeKind.Aborted:
                            logger.LogInformation("Mission {MissionId} aborted (cancelled).", mission.Id);
                            break;
                    }
                }
                catch (Exception ex)
                {
                    var error = ex is OllamaException ? ex.Message : $"Mission failed: {ex.Message}";
                    logger.LogError(ex, "Mission {MissionId} failed", mission.Id);
                    await FailMissionAsync(mission.Id, mission.Goal, error);
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Worker loop iteration failed.");
                await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
            }
        }
    }

    private async Task FailMissionAsync(Guid missionId, string goal, string error)
    {
        try
        {
            var current = missions.Get(missionId);
            if (current is null || current.Status is MissionStatus.Completed or MissionStatus.Failed or MissionStatus.Cancelled) return;
            missions.SetResult(missionId, null, error);
            missions.Transition(missionId, MissionStatus.Failed);
            events.Publish(new MissionEvent(missionId, AgentEventTypes.MissionFailed, goal, DateTimeOffset.UtcNow));
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to record failure for mission {MissionId}", missionId);
        }
        await Task.CompletedTask;
    }
}
