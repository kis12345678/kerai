using System.Net.WebSockets;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using Kerai.Contracts;
using Kerai.Runtime;
using Kerai.Storage;
using Kerai.Server;

var builder = WebApplication.CreateBuilder(args);
/* Default listen on all interfaces so the UI on any host (e.g. openai.kerai.in) can reach the
   gateway on :5071. Override with --urls (dev uses http://localhost:5071) or ASPNETCORE_URLS. */
builder.WebHost.UseUrls("http://0.0.0.0:5071");
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

/* Shared SQLite state — the Server is the API/WS surface; the Worker executes missions.
   Each store is registered once (concrete) and the interface resolves to the same
   instance, so memory/automation endpoints and mission endpoints share state. */
builder.Services.AddSingleton<SqliteDatabase>();
builder.Services.AddSingleton<SqliteMissionStore>();
builder.Services.AddSingleton<SqliteEventBus>();
builder.Services.AddSingleton<SqliteApprovalStore>();
builder.Services.AddSingleton<SqliteAutomationStore>();
builder.Services.AddSingleton<IMissionStore>(sp => sp.GetRequiredService<SqliteMissionStore>());
builder.Services.AddSingleton<IAgentEventBus>(sp => sp.GetRequiredService<SqliteEventBus>());
builder.Services.AddSingleton<IApprovalStore>(sp => sp.GetRequiredService<SqliteApprovalStore>());
builder.Services.AddSingleton<IAutomationStore>(sp => sp.GetRequiredService<SqliteAutomationStore>());
builder.Services.AddSingleton<IPermissionEngine>(sp => new PermissionEngine(sp.GetRequiredService<IApprovalStore>()));
builder.Services.AddSingleton<IKeraiSettings>(sp => new SqliteSettingsStore(sp.GetRequiredService<SqliteDatabase>(), ServerStartup.ResolveWorkspaceRoot()));
builder.Services.AddHttpClient("ollama");
builder.Services.AddSingleton<IOllamaClient>(sp => new OllamaClient(sp.GetRequiredService<IHttpClientFactory>().CreateClient("ollama")));
builder.Services.AddSingleton<IToolRegistry, ToolRegistry>();
builder.Services.AddSingleton<EventHub>();

/* Cached telemetry — never block an API request on CPU sampling. */
builder.Services.AddSingleton<WindowsSystemMonitor>();
builder.Services.AddSingleton<CachedSystemMonitor>();
builder.Services.AddSingleton<ISystemMonitor>(sp => sp.GetRequiredService<CachedSystemMonitor>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<CachedSystemMonitor>());

builder.Services.AddHostedService<EventBroadcaster>();

builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy
    .WithOrigins(ServerStartup.CorsOrigins())
    .AllowAnyHeader()
    .AllowAnyMethod()));

var app = builder.Build();
app.UseCors();
app.UseWebSockets();

app.MapGet("/health", () => Results.Ok(new { service = "kerai-server", status = "ok", user = Environment.UserName }));
app.MapGet("/api/tools", (IToolRegistry tools) => Results.Ok(tools.List()));
app.MapGet("/api/ollama/status", async (IOllamaClient ollama, CancellationToken cancellationToken) => Results.Ok(await ollama.GetStatusAsync(cancellationToken)));
app.MapGet("/api/system/status", (ISystemMonitor monitor) => Results.Ok(monitor.GetStatus()));
app.MapGet("/api/activity", (IAgentEventBus bus) => Results.Ok(bus.Recent(200)));

/* Direct conversational AI chat (answers without creating a mission). */
app.MapPost("/api/chat", async ([FromBody] ChatRequest request, IOllamaClient ollama, IKeraiSettings settings, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request?.Prompt)) return Results.BadRequest(new { error = "Prompt is required." });
    var model = settings.Current.DefaultModel;
    var messages = new ChatMessage[]
    {
        new("system", "You are KERAI — a helpful, warm, intelligent AI assistant. Speak naturally, directly, and concisely like a human assistant. Never mention internal tools unless asked."),
        new("user", request.Prompt.Trim())
    };
    try
    {
        var result = await ollama.GenerateAsync(model, messages, Array.Empty<ToolContract>(), cancellationToken);
        var reply = result.Content?.Trim() ?? "I'm here — how can I help you?";
        return Results.Ok(new { reply });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { reply = $"I couldn't process that: {ex.Message}" });
    }
});

/* Settings (default model drives inference; workspace root confines tools). */
app.MapGet("/api/settings", (IKeraiSettings settings) => Results.Ok(settings.Current));
app.MapPut("/api/settings/model", (UpdateModelRequest request, IKeraiSettings settings) =>
{
    try
    {
        settings.SetDefaultModel(request.Model);
        return Results.Ok(settings.Current);
    }
    catch (ArgumentException ex) { return Results.BadRequest(new { error = ex.Message }); }
});
app.MapPut("/api/settings/workspace", (UpdateWorkspaceRequest request, IKeraiSettings settings) =>
{
    try
    {
        settings.SetWorkspaceRoot(request.Root);
        return Results.Ok(settings.Current);
    }
    catch (Exception ex) when (ex is ArgumentException or DirectoryNotFoundException) { return Results.BadRequest(new { error = ex.Message }); }
});

/* Approvals — always tied to the exact operation. The worker resumes granted missions. */
app.MapGet("/api/approvals", (IApprovalStore store, Guid? missionId) => Results.Ok(store.List(missionId)));
app.MapPost("/api/approvals/{id:guid}/approve", (Guid id, IApprovalStore store, IMissionStore missions, IAgentEventBus events) =>
{
    try
    {
        var approval = store.Approve(id);
        var mission = missions.Get(approval.MissionId);
        if (mission is { Status: MissionStatus.WaitingForApproval })
            events.Publish(new MissionEvent(mission.Id, AgentEventTypes.ApprovalGranted, approval.ToolName, DateTimeOffset.UtcNow));
        return Results.Ok(approval);
    }
    catch (KeyNotFoundException) { return Results.NotFound(); }
    catch (InvalidOperationException ex) { return Results.Conflict(new { error = ex.Message }); }
});
app.MapPost("/api/approvals/{id:guid}/deny", (Guid id, IApprovalStore store, IMissionStore missions, IAgentEventBus events) =>
{
    try
    {
        var approval = store.Deny(id);
        var mission = missions.Get(approval.MissionId);
        if (mission is { Status: MissionStatus.WaitingForApproval })
        {
            missions.SetResult(mission.Id, null, $"Approval denied by user: {approval.ToolName}");
            missions.Transition(mission.Id, MissionStatus.Failed);
            events.Publish(new MissionEvent(mission.Id, AgentEventTypes.ApprovalDenied, approval.ToolName, DateTimeOffset.UtcNow));
            events.Publish(new MissionEvent(mission.Id, AgentEventTypes.MissionFailed, mission.Goal, DateTimeOffset.UtcNow));
        }
        return Results.Ok(approval);
    }
    catch (KeyNotFoundException) { return Results.NotFound(); }
});

/* Automations — scheduled missions. Firing only creates a normal mission; the
   worker executes it through the same permission pipeline. */
app.MapGet("/api/automations", (IAutomationStore store) => Results.Ok(store.List()));
app.MapPost("/api/automations", (CreateAutomationRequest request, IAutomationStore store) =>
{
    try { return Results.Created($"/api/automations", store.Create(request)); }
    catch (ArgumentException ex) { return Results.BadRequest(new { error = ex.Message }); }
});
app.MapPut("/api/automations/{id:guid}", (Guid id, UpdateAutomationRequest request, IAutomationStore store) =>
{
    try { return Results.Ok(store.Update(id, request)); }
    catch (KeyNotFoundException) { return Results.NotFound(); }
    catch (ArgumentException ex) { return Results.BadRequest(new { error = ex.Message }); }
});
app.MapDelete("/api/automations/{id:guid}", (Guid id, IAutomationStore store) =>
{
    try { store.Delete(id); return Results.NoContent(); }
    catch (KeyNotFoundException) { return Results.NotFound(); }
});

/* Workspace — read-only inspection of the confined root (never writes). */
app.MapGet("/api/workspace", (IKeraiSettings settings) => Results.Ok(WorkspaceInspector.Build(settings.Current.WorkspaceRoot)));

/* Memory — inspectable, removable task memory. Clearing never touches active missions. */
app.MapGet("/api/memory", (SqliteMissionStore missions, SqliteEventBus events, SqliteApprovalStore approvals) =>
{
    var all = missions.List();
    var active = all.Count(m => m.Status is MissionStatus.Created or MissionStatus.Running or MissionStatus.WaitingForApproval or MissionStatus.Verifying);
    return Results.Ok(new MemorySnapshotDto(all.Take(50).ToArray(), events.Recent(200), approvals.List().Take(50).ToArray(), active));
});
app.MapDelete("/api/memory", (SqliteMissionStore missions, SqliteEventBus events, SqliteApprovalStore approvals) =>
{
    var missionsCleared = missions.ClearTerminal();
    var approvalsCleared = approvals.ClearForTerminalMissions();
    var eventsCleared = events.ClearAll();
    return Results.Ok(new { missionsCleared, approvalsCleared, eventsCleared });
});

/* Missions — persisted to SQLite; the worker claims and executes them. */
app.MapGet("/api/missions", (IMissionStore store) => Results.Ok(store.List()));
app.MapGet("/api/missions/{id:guid}", (Guid id, IMissionStore store) => store.Get(id) is { } mission ? Results.Ok(mission) : Results.NotFound());
app.MapPost("/api/missions", (CreateMissionRequest request, IMissionStore store, IAgentEventBus events) =>
{
    var mission = store.Create(request);
    events.Publish(new MissionEvent(mission.Id, AgentEventTypes.MissionCreated, mission.Goal, DateTimeOffset.UtcNow));
    return Results.Created($"/api/missions/{mission.Id}", mission);
});
app.MapPost("/api/missions/{id:guid}/transition", (Guid id, [FromBody] MissionStatus status, IMissionStore store, IAgentEventBus events) =>
{
    try
    {
        var mission = store.Transition(id, status);
        if (status == MissionStatus.Cancelled)
            events.Publish(new MissionEvent(id, AgentEventTypes.MissionCancelled, mission.Goal, DateTimeOffset.UtcNow));
        return Results.Ok(mission);
    }
    catch (KeyNotFoundException) { return Results.NotFound(); }
    catch (InvalidOperationException ex) { return Results.Conflict(new { error = ex.Message }); }
});

/* Real-time events. */
app.Map("/ws", async (HttpContext context, EventHub hub) =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = 400;
        return;
    }
    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    hub.Add(socket);
    try
    {
        var buffer = new byte[1024];
        while (socket.State == WebSocketState.Open)
        {
            var result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
            if (result.MessageType == WebSocketMessageType.Close) break;
        }
    }
    finally
    {
        hub.Remove(socket);
    }
});

app.Run();

public partial class Program;

public record ChatRequest(string Prompt);

internal static class ServerStartup
{
    public static string ResolveWorkspaceRoot()
    {
        var env = Environment.GetEnvironmentVariable("KERAI_WORKSPACE");
        if (!string.IsNullOrWhiteSpace(env)) return Path.GetFullPath(env);
        var solutionRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));
        return solutionRoot;
    }

    public static string[] CorsOrigins()
    {
        var env = Environment.GetEnvironmentVariable("KERAI_CORS_ORIGINS");
        if (!string.IsNullOrWhiteSpace(env))
            return env.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return ["http://localhost:5173", "http://127.0.0.1:5173", "http://openai.kerai.in:5173"];
    }
}
