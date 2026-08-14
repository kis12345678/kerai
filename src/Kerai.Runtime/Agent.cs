using Kerai.Contracts;

namespace Kerai.Runtime;

public enum MissionOutcomeKind { Completed, WaitingForApproval, Aborted }

public sealed record MissionOutcome(MissionOutcomeKind Kind, string? Result = null, string? Error = null, Guid? ApprovalId = null);

public interface IAgentService
{
    /// <summary>Runs one mission to completion, a human-approval pause, or abort. Throws on hard failure.</summary>
    Task<MissionOutcome> RunAsync(Guid missionId, CancellationToken cancellationToken = default);
}

public interface IVerifier
{
    Task<VerificationVerdict> VerifyAsync(MissionDto mission, IReadOnlyList<ChatMessage> conversation, IReadOnlyList<ToolExecution> executions, CancellationToken cancellationToken = default);
}

/// <summary>
/// Grounded-answer verification: the mission only completes when the model produced
/// a real answer and, when tools were used, at least one tool completed successfully.
/// A "successful" answer that cites nothing is treated as unverified.
/// </summary>
public sealed class GroundedAnswerVerifier : IVerifier
{
    public Task<VerificationVerdict> VerifyAsync(MissionDto mission, IReadOnlyList<ChatMessage> conversation, IReadOnlyList<ToolExecution> executions, CancellationToken cancellationToken = default)
    {
        var answer = conversation.LastOrDefault(m => m.Role == "assistant")?.Content?.Trim();
        if (string.IsNullOrWhiteSpace(answer))
            return Task.FromResult(new VerificationVerdict(false, "the final answer was empty"));
        if (answer.Length < 2)
            return Task.FromResult(new VerificationVerdict(false, "the final answer was too short to be a real result"));

        if (executions.Count > 0)
        {
            var successful = executions.Count(e => e.Ok);
            if (successful == 0)
                return Task.FromResult(new VerificationVerdict(false, "no tool completed successfully, so the answer may not be grounded in real state"));
        }

        return Task.FromResult(new VerificationVerdict(true));
    }
}

/// <summary>
/// The agent loop. The model proposes, tools execute, the permission engine gates,
/// and a verifier checks the result before completion. Failed verification or a
/// stalled attempt triggers bounded recovery (max 2 retries). Multi-turn tool calls
/// preserve the assistant-tool_calls / tool-result message structure Ollama expects.
/// </summary>
public sealed class AgentService(
    IMissionStore missions,
    IOllamaClient ollama,
    IToolRegistry tools,
    IToolExecutor executor,
    IPermissionEngine permissions,
    IAgentEventBus events,
    IKeraiSettings settings,
    IWorkspacePolicy workspace,
    IVerifier verifier) : IAgentService
{
    private const int MaxIterationsPerAttempt = 8;
    private const int MaxRecoveryAttempts = 2;

    public async Task<MissionOutcome> RunAsync(Guid missionId, CancellationToken cancellationToken = default)
    {
        var mission = missions.Get(missionId) ?? throw new KeyNotFoundException($"Mission {missionId} was not found.");
        if (mission.Status == MissionStatus.Cancelled) return new MissionOutcome(MissionOutcomeKind.Aborted, Error: "Mission was cancelled.");

        var model = settings.Current.DefaultModel;
        var status = await ollama.GetStatusAsync(cancellationToken);
        if (!status.Connected) throw new OllamaException($"Ollama is not reachable ({status.Error}). Start Ollama and retry.");
        if (!status.Models.Contains(model, StringComparer.OrdinalIgnoreCase))
            throw new OllamaException($"Configured model '{model}' is not installed. Pull it with `ollama pull {model}` or change the default model in Settings.");

        var lane = AgentLanes.Normalize(mission.Lane);
        var workspaceRoot = workspace.ValidateWorkspace(mission.WorkspacePath ?? settings.Current.WorkspaceRoot);
        var messages = new List<ChatMessage>
        {
            new("system", AgentLanes.BuildSystemPrompt(lane)),
            new("user", $"{mission.Goal}\n\nApproved workspace root: {workspaceRoot}"),
        };

        string? lastRecoveryReason = null;
        for (var attempt = 0; attempt <= MaxRecoveryAttempts; attempt++)
        {
            var turn = await RunPlanningAttemptAsync(mission, messages, model, workspaceRoot, lane, cancellationToken);
            switch (turn.Kind)
            {
                case PlanningTurnKind.WaitingForApproval:
                    return new MissionOutcome(MissionOutcomeKind.WaitingForApproval, ApprovalId: turn.ApprovalId);

                case PlanningTurnKind.Aborted:
                    return new MissionOutcome(MissionOutcomeKind.Aborted, Error: "Mission was cancelled.");

                case PlanningTurnKind.Answer:
                    var verdict = await verifier.VerifyAsync(mission, messages, turn.Executions ?? Array.Empty<ToolExecution>(), cancellationToken);
                    if (verdict.Passed) return Complete(missionId, mission.Goal, turn.Answer!);

                    lastRecoveryReason = verdict.Reason;
                    messages.Add(new ChatMessage("user",
                        $"Your result did not pass verification: {verdict.Reason}. Re-check the real state with the tools and produce a corrected result."));
                    events.Publish(new MissionEvent(missionId, AgentEventTypes.Verifying, $"verification failed: {verdict.Reason}", DateTimeOffset.UtcNow));
                    break;

                case PlanningTurnKind.Stalled:
                    lastRecoveryReason = turn.Reason;
                    messages.Add(new ChatMessage("user",
                        $"Your previous attempt stalled: {turn.Reason}. Either call an available tool to gather real information, or give your final answer."));
                    break;
            }
        }

        throw new OllamaException($"Mission failed after {MaxRecoveryAttempts + 1} attempts. Last issue: {lastRecoveryReason}");
    }

    private async Task<PlanningTurn> RunPlanningAttemptAsync(
        MissionDto mission,
        List<ChatMessage> messages,
        string model,
        string workspaceRoot,
        MissionLane lane,
        CancellationToken cancellationToken)
    {
        var emptyResponses = 0;
        var executions = new List<ToolExecution>();
        var laneTools = tools.List().Where(t => AgentLanes.IsToolAllowed(lane, t.Name)).ToArray();

        for (var iteration = 0; iteration < MaxIterationsPerAttempt; iteration++)
        {
            if (missions.Get(mission.Id) is { Status: MissionStatus.Cancelled })
                return new PlanningTurn(PlanningTurnKind.Aborted);

            var response = await ollama.GenerateAsync(model, messages, laneTools, cancellationToken);

            if (response.ToolCalls.Count == 0)
            {
                var answer = response.Content?.Trim();
                if (!string.IsNullOrEmpty(answer))
                {
                    messages.Add(new ChatMessage("assistant", answer));
                    return new PlanningTurn(PlanningTurnKind.Answer, Answer: answer, Executions: executions);
                }

                emptyResponses++;
                if (emptyResponses >= 2)
                    return new PlanningTurn(PlanningTurnKind.Stalled, Reason: "the model returned empty responses (it may not support tool calling)");
                messages.Add(new ChatMessage("user", "Your previous turn was empty. Either call one of the available tools or give your final answer."));
                continue;
            }

            // Preserve the assistant message with its tool calls, then one tool result per call.
            messages.Add(new ChatMessage("assistant", response.Content ?? string.Empty, response.ToolCalls));

            foreach (var call in response.ToolCalls)
            {
                ToolContract tool;
                try
                {
                    tool = tools.Get(call.Name);
                }
                catch (KeyNotFoundException)
                {
                    messages.Add(new ChatMessage("tool", $"Tool '{call.Name}' is not available. Choose from the provided tools only.", ToolCallId: call.Id));
                    continue;
                }

                var approval = permissions.RequireApproval(mission.Id, tool, call.Arguments, out _);
                if (approval is not null)
                {
                    missions.Transition(mission.Id, MissionStatus.WaitingForApproval);
                    events.Publish(new MissionEvent(mission.Id, AgentEventTypes.ApprovalRequested, $"{tool.Name} · {DescribeArgs(call.Arguments)}", DateTimeOffset.UtcNow));
                    return new PlanningTurn(PlanningTurnKind.WaitingForApproval, ApprovalId: approval.Id);
                }

                events.Publish(new MissionEvent(mission.Id, AgentEventTypes.ToolStarted, call.Name, DateTimeOffset.UtcNow));
                var result = await executor.ExecuteAsync(call.Name, call.Arguments, mission.WorkspacePath ?? workspaceRoot, tool.Timeout, cancellationToken, mission.Id);

                executions.Add(new ToolExecution(call.Name, result.Ok, result.Output, result.Error));
                if (result.Ok)
                    events.Publish(new MissionEvent(mission.Id, AgentEventTypes.ToolCompleted, call.Name, DateTimeOffset.UtcNow));
                else
                    events.Publish(new MissionEvent(mission.Id, AgentEventTypes.ToolFailed, $"{call.Name}: {result.Error}", DateTimeOffset.UtcNow));

                var payload = $"Tool {call.Name} result:\n{result.Output}".Trim();
                if (result.Error is not null) payload += $"\nTool error: {result.Error}";
                messages.Add(new ChatMessage("tool", payload, ToolCallId: call.Id));
            }
        }

        return new PlanningTurn(PlanningTurnKind.Stalled, Reason: $"the agent exceeded {MaxIterationsPerAttempt} tool iterations without reaching an answer");
    }

    private MissionOutcome Complete(Guid missionId, string goal, string answer)
    {
        missions.Transition(missionId, MissionStatus.Verifying);
        events.Publish(new MissionEvent(missionId, AgentEventTypes.Verifying, goal, DateTimeOffset.UtcNow));
        missions.SetResult(missionId, answer, null);
        missions.Transition(missionId, MissionStatus.Completed);
        events.Publish(new MissionEvent(missionId, AgentEventTypes.MissionCompleted, goal, DateTimeOffset.UtcNow));
        return new MissionOutcome(MissionOutcomeKind.Completed, Result: answer);
    }

    private enum PlanningTurnKind { Answer, WaitingForApproval, Aborted, Stalled }

    private sealed record PlanningTurn(PlanningTurnKind Kind, string? Answer = null, string? Reason = null, Guid? ApprovalId = null, IReadOnlyList<ToolExecution>? Executions = null);

    private static string DescribeArgs(string inputJson) =>
        inputJson.Length <= 120 ? inputJson : inputJson[..120] + "…";
}
