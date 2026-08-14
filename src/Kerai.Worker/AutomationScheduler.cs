using Kerai.Contracts;
using Kerai.Runtime;

namespace Kerai.Worker;

/// <summary>
/// Fires due automations. Firing only means "create a normal mission" — the
/// mission then goes through the exact same claim → agent → permission →
/// execute → verify pipeline as any user-created mission. An automation can
/// never silently gain new permissions.
/// </summary>
public sealed class AutomationScheduler(
    IAutomationStore automations,
    IMissionStore missions,
    IAgentEventBus events,
    ILogger<AutomationScheduler> logger) : BackgroundService
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(20);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("KERAI automation scheduler started — polling every {Seconds}s.", PollInterval.TotalSeconds);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var now = DateTimeOffset.UtcNow;
                foreach (var automation in automations.List().Where(a => AutomationRules.IsDue(a, now)))
                {
                    var mission = missions.Create(new CreateMissionRequest(automation.Prompt));
                    automations.MarkFired(automation.Id, DateTimeOffset.UtcNow);
                    events.Publish(new MissionEvent(mission.Id, AgentEventTypes.MissionCreated, mission.Goal, DateTimeOffset.UtcNow));
                    logger.LogInformation("Automation '{Label}' fired mission {MissionId}: {Prompt}", automation.Label, mission.Id, automation.Prompt);
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Automation scheduler iteration failed.");
            }

            try
            {
                await Task.Delay(PollInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }
}
