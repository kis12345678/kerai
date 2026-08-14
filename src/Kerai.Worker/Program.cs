using Kerai.Runtime;
using Kerai.Storage;
using Kerai.Worker;

var builder = Host.CreateApplicationBuilder(args);

/* Shared SQLite state — the Worker claims and executes missions the Server created.
   Each store is registered once (concrete) and the interface resolves to the
   same instance, so no duplicate connections or split state. */
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
builder.Services.AddSingleton<IKeraiSettings>(sp => new SqliteSettingsStore(sp.GetRequiredService<SqliteDatabase>(), WorkerStartup.ResolveWorkspaceRoot()));

builder.Services.AddSingleton<IToolRegistry, ToolRegistry>();
builder.Services.AddSingleton<IWorkspacePolicy, WorkspacePolicy>();
builder.Services.AddHttpClient("ollama");
builder.Services.AddSingleton<IOllamaClient>(sp => new OllamaClient(sp.GetRequiredService<IHttpClientFactory>().CreateClient("ollama")));
builder.Services.AddSingleton<ComputerTools>();
/* ToolExecutor depends on a lazy IAgentService to run nested sub-missions (the
   agent and its executor are mutually dependent, so resolution is deferred). */
builder.Services.AddSingleton(sp => new Lazy<IAgentService>(sp.GetRequiredService<IAgentService>));
builder.Services.AddSingleton<IToolExecutor, ToolExecutor>();
builder.Services.AddSingleton<IVerifier, GroundedAnswerVerifier>();
builder.Services.AddSingleton<IAgentService, AgentService>();

builder.Services.AddHostedService<MissionWorker>();
builder.Services.AddHostedService<AutomationScheduler>();

await builder.Build().RunAsync();

internal static class WorkerStartup
{
    public static string ResolveWorkspaceRoot()
    {
        var env = Environment.GetEnvironmentVariable("KERAI_WORKSPACE");
        if (!string.IsNullOrWhiteSpace(env)) return Path.GetFullPath(env);
        return Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));
    }
}
