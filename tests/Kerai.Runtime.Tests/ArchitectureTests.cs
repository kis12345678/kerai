using Kerai.Contracts;
using Kerai.Runtime;
using Kerai.Storage;
using Xunit;

namespace Kerai.Runtime.Tests;

public sealed class ArchitectureTests
{
    private static string TempDataDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), "kerai-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        return dir;
    }

    /* ---- SQLite: shared cross-process state ---- */

    [Fact]
    public void Sqlite_store_persists_across_instances()
    {
        var dataDir = TempDataDir();

        // "Server" process creates the mission.
        var serverStore = new SqliteMissionStore(new SqliteDatabase(dataDir));
        var mission = serverStore.Create(new CreateMissionRequest("Inspect the project"));
        serverStore.Transition(mission.Id, MissionStatus.Running);
        serverStore.SetResult(mission.Id, "A real result.", null);

        // A brand-new store instance (the "Worker" process) sees the same state.
        var workerStore = new SqliteMissionStore(new SqliteDatabase(dataDir));
        var reloaded = workerStore.Get(mission.Id);

        Assert.NotNull(reloaded);
        Assert.Equal(MissionStatus.Running, reloaded!.Status);
        Assert.Equal("A real result.", reloaded.Result);

        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        Directory.Delete(dataDir, recursive: true);
    }

    [Fact]
    public void Sqlite_store_survives_restart_with_terminal_state()
    {
        var dataDir = TempDataDir();
        var store = new SqliteMissionStore(new SqliteDatabase(dataDir));
        var mission = store.Create(new CreateMissionRequest("Run the tests"));
        store.Transition(mission.Id, MissionStatus.Running);
        store.Transition(mission.Id, MissionStatus.Completed);

        var reopened = new SqliteMissionStore(new SqliteDatabase(dataDir)).Get(mission.Id);
        Assert.Equal(MissionStatus.Completed, reopened!.Status);

        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        Directory.Delete(dataDir, recursive: true);
    }

    /* ---- Atomic claim: exactly one consumer wins ---- */

    [Fact]
    public void ClaimNext_never_double_claims_a_mission()
    {
        var store = new InMemoryMissionStore();
        var first = store.Create(new CreateMissionRequest("Mission one"));
        var second = store.Create(new CreateMissionRequest("Mission two"));
        var third = store.Create(new CreateMissionRequest("Mission three"));

        var claimed = new[] { store.ClaimNext(), store.ClaimNext(), store.ClaimNext() };
        Assert.All(claimed, m => Assert.NotNull(m));
        Assert.All(claimed, m => Assert.Equal(MissionStatus.Running, m!.Status));

        // Each mission claimed exactly once, oldest first.
        Assert.Equal([first.Id, second.Id, third.Id], claimed.Select(m => m!.Id));

        // Nothing left to claim.
        Assert.Null(store.ClaimNext());
    }

    [Fact]
    public void ClaimNext_claims_approved_waiting_mission()
    {
        var approvals = new InMemoryApprovalStore();
        var store = new InMemoryMissionStore(approvals);
        var mission = store.Create(new CreateMissionRequest("Modify a file"));
        store.ClaimNext(); // worker claims it (Created → Running)
        store.Transition(mission.Id, MissionStatus.WaitingForApproval); // agent asks for approval

        var tool = new ToolRegistry().Get("filesystem.write");
        var engine = new PermissionEngine(approvals);
        var approval = engine.RequireApproval(mission.Id, tool, "{\"path\":\"a.txt\",\"content\":\"x\"}", out _);
        Assert.NotNull(approval);
        approvals.Approve(approval!.Id);

        var claimed = store.ClaimNext(); // user granted → worker re-claims
        Assert.NotNull(claimed);
        Assert.Equal(mission.Id, claimed!.Id);
        Assert.Equal(MissionStatus.Running, claimed.Status);
    }

    /* ---- Verification engine ---- */

    [Fact]
    public async Task Verifier_passes_a_grounded_answer()
    {
        var verifier = new GroundedAnswerVerifier();
        var mission = new MissionDto(Guid.NewGuid(), "Inspect the project", MissionStatus.Running, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, null, MissionLane.Master);
        var conversation = new List<ChatMessage>
        {
            new("user", "Inspect the project"),
            new("assistant", "I inspected the workspace and found the KERAI solution with five sub-projects: contracts, runtime, server, worker, and the React control surface."),
        };
        var executions = new List<ToolExecution> { new("workspace.inspect", true, "{\"project\":\"Kerai\"}") };

        var verdict = await verifier.VerifyAsync(mission, conversation, executions);
        Assert.True(verdict.Passed);
    }

    [Fact]
    public async Task Verifier_rejects_an_empty_answer()
    {
        var verifier = new GroundedAnswerVerifier();
        var mission = new MissionDto(Guid.NewGuid(), "Inspect the project", MissionStatus.Running, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, null, MissionLane.Master);
        var conversation = new List<ChatMessage> { new("assistant", "   ") };

        var verdict = await verifier.VerifyAsync(mission, conversation, []);
        Assert.False(verdict.Passed);
    }

    [Fact]
    public async Task Verifier_rejects_ungrounded_answer_when_tools_failed()
    {
        var verifier = new GroundedAnswerVerifier();
        var mission = new MissionDto(Guid.NewGuid(), "Inspect the project", MissionStatus.Running, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, null, MissionLane.Master);
        var conversation = new List<ChatMessage>
        {
            new("assistant", "This is a confident-sounding answer that is long enough to look real but it cites no tool output whatsoever in this test scenario."),
        };
        var executions = new List<ToolExecution> { new("filesystem.read", false, "", "File not found") };

        var verdict = await verifier.VerifyAsync(mission, conversation, executions);
        Assert.False(verdict.Passed);
    }

    /* ---- Recovery loop: bounded retry, then completion ---- */

    [Fact]
    public async Task Agent_recovers_once_then_completes()
    {
        var store = new InMemoryMissionStore();
        var mission = store.Create(new CreateMissionRequest("Inspect the workspace and report what project this is"));
        store.ClaimNext(); // the worker claims (Created → Running) before the agent runs
        var events = new InMemoryAgentEventBus();
        var ollama = new RecoveryFakeOllama("test-model");
        var registry = new ToolRegistry();
        var executor = new ToolExecutor(new WorkspacePolicy(Environment.CurrentDirectory), ollama, new ComputerTools());
        var agent = new AgentService(
            store,
            ollama,
            registry,
            executor,
            new PermissionEngine(new InMemoryApprovalStore()),
            events,
            new TestSettings("test-model", Environment.CurrentDirectory),
            new WorkspacePolicy(Environment.CurrentDirectory),
            new GroundedAnswerVerifier());

        var outcome = await agent.RunAsync(mission.Id);

        Assert.Equal(MissionOutcomeKind.Completed, outcome.Kind);
        Assert.NotNull(outcome.Result);

        var finished = store.Get(mission.Id);
        Assert.Equal(MissionStatus.Completed, finished!.Status);

        // The recovery loop published a verification-failure event before the retry succeeded.
        var trail = events.Recent(50);
        Assert.Contains(trail, e => e.Type == AgentEventTypes.Verifying && e.Message.Contains("verification failed", StringComparison.OrdinalIgnoreCase));
        Assert.Equal(2, ollama.GenerationCalls); // failed attempt + recovery retry, bounded
    }

    [Fact]
    public void Agent_fails_after_bounded_recovery_attempts()
    {
        var store = new InMemoryMissionStore();
        var mission = store.Create(new CreateMissionRequest("Inspect the workspace and report what project this is"));
        store.ClaimNext(); // the worker claims (Created → Running) before the agent runs
        var ollama = new NeverSatisfiesFakeOllama("test-model");
        var agent = new AgentService(
            store,
            ollama,
            new ToolRegistry(),
            new ToolExecutor(new WorkspacePolicy(Environment.CurrentDirectory), ollama, new ComputerTools()),
            new PermissionEngine(new InMemoryApprovalStore()),
            new InMemoryAgentEventBus(),
            new TestSettings("test-model", Environment.CurrentDirectory),
            new WorkspacePolicy(Environment.CurrentDirectory),
            new GroundedAnswerVerifier());

        var ex = Assert.Throws<OllamaException>(() => agent.RunAsync(mission.Id).GetAwaiter().GetResult());
        Assert.Contains("failed after", ex.Message);
        Assert.Equal(3, ollama.GenerationCalls); // initial + 2 recovery retries, never infinite
    }

    /* ---- Computer agent tools ---- */

    [Fact]
    public void Computer_tools_are_registered_with_correct_policy()
    {
        var registry = new ToolRegistry();

        var open = registry.Get("computer.open_application");
        Assert.Equal(PermissionLevel.Modify, open.Risk);
        Assert.True(open.RequiresApproval);
        Assert.Contains("\"app\"", open.InputSchema);
        Assert.Contains("\"required\":[\"app\"]", open.InputSchema);

        var close = registry.Get("computer.close_application");
        Assert.Equal(PermissionLevel.System, close.Risk);
        Assert.True(close.RequiresApproval);

        var list = registry.Get("computer.list_processes");
        Assert.Equal(PermissionLevel.Read, list.Risk);
        Assert.False(list.RequiresApproval);

        var openUrl = registry.Get("computer.open_url");
        Assert.True(openUrl.RequiresApproval);
        Assert.Contains("url", openUrl.InputSchema);

        var setClip = registry.Get("computer.set_clipboard");
        Assert.True(setClip.RequiresApproval);
        var getClip = registry.Get("computer.get_clipboard");
        Assert.False(getClip.RequiresApproval);
    }

    [Fact]
    public void Permission_engine_gates_computer_actions()
    {
        var approvals = new InMemoryApprovalStore();
        var engine = new PermissionEngine(approvals);
        var registry = new ToolRegistry();

        // Read-only computer tools never ask.
        var list = engine.RequireApproval(Guid.NewGuid(), registry.Get("computer.list_processes"), "{}", out _);
        Assert.Null(list);

        // Launching an app requires an approval bound to the exact operation.
        var missionId = Guid.NewGuid();
        var approval = engine.RequireApproval(missionId, registry.Get("computer.open_application"), "{\"app\":\"chrome\"}", out _);
        Assert.NotNull(approval);
        Assert.Equal(ApprovalStatus.Pending, approval!.Status);

        // A different argument is a different operation → a new approval.
        var other = engine.RequireApproval(missionId, registry.Get("computer.open_application"), "{\"app\":\"notepad\"}", out _);
        Assert.NotNull(other);
        Assert.NotEqual(approval.Id, other!.Id);
    }

    [Fact]
    public void Computer_app_mappings_resolve_common_apps()
    {
        var tools = new ComputerTools();
        Assert.True(tools.Mappings.ContainsKey("chrome"));
        Assert.True(tools.Mappings.ContainsKey("notepad"));
        Assert.False(string.IsNullOrWhiteSpace(tools.ResolveExecutable("chrome")));
        Assert.Equal("notepad", tools.ResolveProcessName("notepad"));
    }

    [Fact]
    public void Computer_user_mappings_override_builtins()
    {
        var dir = TempDataDir();
        File.WriteAllText(Path.Combine(dir, "apps.json"), "{\"chrome\":\"C:/custom/chrome.exe\",\"myapp\":\"C:/tools/myapp.exe\"}");
        Environment.SetEnvironmentVariable("KERAI_APPS", Path.Combine(dir, "apps.json"));
        try
        {
            var tools = new ComputerTools(dir);
            Assert.Equal("C:/custom/chrome.exe", tools.ResolveExecutable("chrome"));
            Assert.Equal("C:/tools/myapp.exe", tools.ResolveExecutable("myapp"));
        }
        finally
        {
            Environment.SetEnvironmentVariable("KERAI_APPS", null);
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void Computer_open_url_rejects_non_http_schemes()
    {
        var tools = new ComputerTools();
        var result = tools.OpenUrl("file:///C:/windows/system32");
        Assert.False(ParseSuccess(result));
        Assert.Contains("http(s)", result, StringComparison.OrdinalIgnoreCase);
    }

    private static bool ParseSuccess(string json)
    {
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        return doc.RootElement.TryGetProperty("success", out var s) && s.GetBoolean();
    }

    /* ---- Fakes ---- */

    private sealed class TestSettings(string model, string root) : IKeraiSettings
    {
        public KeraiSettings Current => new(model, root);
        public void SetDefaultModel(string m) { }
        public void SetWorkspaceRoot(string r) { }
    }

    private sealed class RecoveryFakeOllama(string model) : IOllamaClient
    {
        public int GenerationCalls { get; private set; }

        public Task<OllamaStatus> GetStatusAsync(CancellationToken ct = default) =>
            Task.FromResult(new OllamaStatus(true, "http://test", [model], null));

        public Task<OllamaChatResult> GenerateAsync(string model, IReadOnlyList<ChatMessage> messages, IReadOnlyList<ToolContract> tools, CancellationToken ct = default)
        {
            GenerationCalls++;
            // First attempt: too-short answer → verification fails → recovery nudge.
            // Second attempt: grounded, substantive answer → verification passes.
            if (GenerationCalls == 1)
                return Task.FromResult(new OllamaChatResult("Done.", []));
            return Task.FromResult(new OllamaChatResult(
                "The workspace is the KERAI project, a local-first AI operating environment. " +
                "The solution Kerai.sln contains five projects: Kerai.Contracts, Kerai.Runtime, Kerai.Server, Kerai.Worker, and a React control surface.",
                []));
        }
    }

    /* ---- Specialist lanes ---- */

    [Fact]
    public void Lanes_scope_the_tool_allowlist()
    {
        // Coder lane: coding tools yes, computer tools no.
        Assert.True(AgentLanes.IsToolAllowed(MissionLane.Coder, "filesystem.read"));
        Assert.True(AgentLanes.IsToolAllowed(MissionLane.Coder, "dotnet.test"));
        Assert.True(AgentLanes.IsToolAllowed(MissionLane.Coder, "code.search"));
        Assert.False(AgentLanes.IsToolAllowed(MissionLane.Coder, "computer.open_application"));
        Assert.False(AgentLanes.IsToolAllowed(MissionLane.Coder, "process.run"));

        // Computer lane: computer tools yes, workspace tools no.
        Assert.True(AgentLanes.IsToolAllowed(MissionLane.Computer, "computer.open_application"));
        Assert.True(AgentLanes.IsToolAllowed(MissionLane.Computer, "computer.set_clipboard"));
        Assert.False(AgentLanes.IsToolAllowed(MissionLane.Computer, "filesystem.read"));
        Assert.False(AgentLanes.IsToolAllowed(MissionLane.Computer, "dotnet.build"));

        // Master may call everything.
        Assert.True(AgentLanes.IsToolAllowed(MissionLane.Master, "computer.close_application"));
        Assert.True(AgentLanes.IsToolAllowed(MissionLane.Master, "filesystem.write"));
        Assert.True(AgentLanes.IsToolAllowed(MissionLane.Master, "process.run"));
    }

    [Fact]
    public void Lane_persists_through_the_store_and_claim()
    {
        var dataDir = TempDataDir();
        try
        {
            var db = new SqliteDatabase(dataDir);
            var store = new SqliteMissionStore(db);
            var coder = store.Create(new CreateMissionRequest("Fix the build", Lane: MissionLane.Coder));
            var master = store.Create(new CreateMissionRequest("Open Chrome", Lane: MissionLane.Computer));

            Assert.Equal(MissionLane.Coder, coder.Lane);
            Assert.Equal(MissionLane.Computer, master.Lane);

            var claimed = store.ClaimNext();
            Assert.Equal(MissionLane.Coder, claimed!.Lane); // oldest Created mission keeps its lane

            var reopened = new SqliteMissionStore(new SqliteDatabase(dataDir)).Get(coder.Id);
            Assert.Equal(MissionLane.Coder, reopened!.Lane);
        }
        finally
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            Directory.Delete(dataDir, recursive: true);
        }
    }

    /* ---- Multi-agent: Master dispatches sub-missions to specialist lanes ---- */

    [Fact]
    public void Submission_dispatch_is_master_only_and_requires_approval()
    {
        var registry = new ToolRegistry();
        var dispatch = registry.Get("submission.dispatch");
        Assert.Equal(PermissionLevel.Modify, dispatch.Risk);
        Assert.True(dispatch.RequiresApproval);
        Assert.Contains("\"lane\"", dispatch.InputSchema);

        // Master may call it; specialist lanes never see it in their allowlist.
        Assert.True(AgentLanes.IsToolAllowed(MissionLane.Master, "submission.dispatch"));
        Assert.False(AgentLanes.IsToolAllowed(MissionLane.Coder, "submission.dispatch"));
        Assert.False(AgentLanes.IsToolAllowed(MissionLane.Computer, "submission.dispatch"));
    }

    [Fact]
    public async Task Submission_dispatch_enforces_lane_rules_and_parent_context()
    {
        var store = new InMemoryMissionStore();
        var parent = store.Create(new CreateMissionRequest("Parent mission", Lane: MissionLane.Master));
        var executor = new ToolExecutor(
            new WorkspacePolicy(Environment.CurrentDirectory),
            new RecoveryFakeOllama("m"),
            new ComputerTools(),
            store,
            new InMemoryAgentEventBus(),
            new Lazy<IAgentService>(() => throw new InvalidOperationException("should not be reached")));

        // No parent mission context → refused.
        var noContext = await executor.ExecuteAsync("submission.dispatch", "{\"goal\":\"x\",\"lane\":\"Coder\"}", null, TimeSpan.FromSeconds(5));
        Assert.False(noContext.Ok);
        Assert.Contains("parent mission", noContext.Error, StringComparison.OrdinalIgnoreCase);

        // Master lane is not a valid target.
        var masterLane = await executor.ExecuteAsync("submission.dispatch", "{\"goal\":\"x\",\"lane\":\"Master\"}", null, TimeSpan.FromSeconds(5), missionId: parent.Id);
        Assert.False(masterLane.Ok);
        Assert.Contains("'Coder' or 'Computer'", masterLane.Error, StringComparison.OrdinalIgnoreCase);

        // Missing goal.
        var noGoal = await executor.ExecuteAsync("submission.dispatch", "{\"lane\":\"Coder\"}", null, TimeSpan.FromSeconds(5), missionId: parent.Id);
        Assert.False(noGoal.Ok);
        Assert.Contains("goal", noGoal.Error, StringComparison.OrdinalIgnoreCase);

        // Unknown lane.
        var badLane = await executor.ExecuteAsync("submission.dispatch", "{\"goal\":\"x\",\"lane\":\"Browser\"}", null, TimeSpan.FromSeconds(5), missionId: parent.Id);
        Assert.False(badLane.Ok);
        Assert.Contains("'Coder' or 'Computer'", badLane.Error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Submission_dispatch_runs_a_sub_mission_and_returns_its_result()
    {
        var store = new InMemoryMissionStore();
        var events = new InMemoryAgentEventBus();
        var approvals = new InMemoryApprovalStore();
        var engine = new PermissionEngine(approvals);
        var ollama = new DispatchFakeOllama("test-model");
        var registry = new ToolRegistry();
        var settings = new TestSettings("test-model", Environment.CurrentDirectory);
        var policy = new WorkspacePolicy(Environment.CurrentDirectory);

        var parent = store.Create(new CreateMissionRequest("Find why the build fails and fix it"));
        store.ClaimNext(); // worker claims the Master mission

        // The Master's dispatch call requires approval — pre-grant the exact operation.
        var args = "{\"goal\":\"Find why the build fails\",\"lane\":\"Coder\"}";
        var dispatchApproval = engine.RequireApproval(parent.Id, registry.Get("submission.dispatch"), args, out _);
        approvals.Approve(dispatchApproval!.Id);

        AgentService? agent = null;
        var executor = new ToolExecutor(policy, ollama, new ComputerTools(), store, events, new Lazy<IAgentService>(() => agent!));
        agent = new AgentService(store, ollama, registry, executor, engine, events, settings, policy, new GroundedAnswerVerifier());

        var outcome = await agent.RunAsync(parent.Id);

        Assert.Equal(MissionOutcomeKind.Completed, outcome.Kind);
        var finished = store.Get(parent.Id);
        Assert.Equal(MissionStatus.Completed, finished!.Status);
        Assert.Contains("Coder", outcome.Result, StringComparison.OrdinalIgnoreCase);

        // A real sub-mission exists: Master lane parent, Coder child, completed.
        var sub = store.List().SingleOrDefault(m => m.ParentMissionId == parent.Id);
        Assert.NotNull(sub);
        Assert.Equal(MissionLane.Coder, sub!.Lane);
        Assert.Equal(MissionStatus.Completed, sub.Status);
        Assert.Contains("missing using directive", sub.Result, StringComparison.OrdinalIgnoreCase);

        // The sub-mission's events flowed through the shared bus.
        var trail = events.Recent(50);
        Assert.Contains(trail, e => e.MissionId == sub.Id && e.Type == AgentEventTypes.MissionCompleted);
    }

    [Fact]
    public void Sub_mission_persists_parent_link_through_sqlite()
    {
        var dataDir = TempDataDir();
        try
        {
            var db = new SqliteDatabase(dataDir);
            var store = new SqliteMissionStore(db);

            var parent = store.Create(new CreateMissionRequest("Master plan"));
            var sub = store.Create(new CreateMissionRequest("Coder work", Lane: MissionLane.Coder, ParentMissionId: parent.Id));

            Assert.Equal(parent.Id, sub.ParentMissionId);
            Assert.Equal(MissionLane.Coder, sub.Lane);

            var reopened = new SqliteMissionStore(new SqliteDatabase(dataDir)).Get(sub.Id);
            Assert.Equal(parent.Id, reopened!.ParentMissionId);
        }
        finally
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            Directory.Delete(dataDir, recursive: true);
        }
    }

    /* ---- Coder tools: code.search + project.analyze ---- */

    [Fact]
    public async Task Code_search_finds_matches_and_honors_confinement()
    {
        var root = TempDataDir();
        try
        {
            Directory.CreateDirectory(Path.Combine(root, "src"));
            File.WriteAllText(Path.Combine(root, "src", "Program.cs"), "public class KeraiCore { }\n// marker KeraiIsHere\n");
            Directory.CreateDirectory(Path.Combine(root, "node_modules"));
            File.WriteAllText(Path.Combine(root, "node_modules", "junk.js"), "KeraiIsHere should be skipped\n");

            var policy = new WorkspacePolicy(root);
            var executor = new ToolExecutor(policy, new RecoveryFakeOllama("m"), new ComputerTools(root));

            var found = await executor.ExecuteAsync("code.search", "{\"pattern\":\"KeraiIsHere\"}", root, TimeSpan.FromSeconds(5));
            Assert.True(found.Ok, found.Error);
            Assert.DoesNotContain("node_modules", found.Output);
            Assert.Contains("Program.cs", found.Output);
            Assert.Contains("\"line\":2", found.Output);

            // Regex mode with an invalid pattern is rejected, not thrown.
            var bad = await executor.ExecuteAsync("code.search", "{\"pattern\":\"(\",\"regex\":true}", root, TimeSpan.FromSeconds(5));
            Assert.False(bad.Ok);

            // Escaping the workspace is refused.
            var escape = await executor.ExecuteAsync("code.search", "{\"pattern\":\"x\",\"path\":\"../outside\"}", root, TimeSpan.FromSeconds(5));
            Assert.False(escape.Ok);
            Assert.Contains("escapes", escape.Error, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task Project_analyze_detects_build_system_and_layout()
    {
        var root = TempDataDir();
        try
        {
            Directory.CreateDirectory(Path.Combine(root, "tests"));
            Directory.CreateDirectory(Path.Combine(root, ".git"));
            File.WriteAllText(Path.Combine(root, "Kerai.sln"), "");
            File.WriteAllText(Path.Combine(root, "Kerai.Core.csproj"), "<Project></Project>");
            File.WriteAllText(Path.Combine(root, "Kerai.Core.Tests.csproj"), "<Project></Project>");
            File.WriteAllText(Path.Combine(root, "package.json"), "{}");

            var policy = new WorkspacePolicy(root);
            var executor = new ToolExecutor(policy, new RecoveryFakeOllama("m"), new ComputerTools(root));
            var result = await executor.ExecuteAsync("project.analyze", "{}", root, TimeSpan.FromSeconds(5));

            Assert.True(result.Ok, result.Error);
            Assert.Contains("\"buildSystem\":\"dotnet\"", result.Output);
            Assert.Contains("Kerai.sln", result.Output);
            Assert.Contains("Kerai.Core.csproj", result.Output);
            Assert.Contains("\"hasGit\":true", result.Output);
            Assert.Contains("tests", result.Output);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    /* ---- Automations: scheduled missions still pass through permissions ---- */

    [Fact]
    public void Automation_rules_interval_due()
    {
        var created = DateTimeOffset.UtcNow.AddMinutes(-10);
        var automation = new AutomationDto(Guid.NewGuid(), "Health", "Summarize system status", AutomationFrequency.Interval, 5, null, true, created, null, 0);

        // Never fired: due once interval has passed since creation.
        Assert.False(AutomationRules.IsDue(automation, created.AddMinutes(4)));
        Assert.True(AutomationRules.IsDue(automation, created.AddMinutes(5)));

        // After firing, the interval restarts from LastFiredAt.
        var fired = created.AddMinutes(5);
        var after = automation with { LastFiredAt = fired };
        Assert.False(AutomationRules.IsDue(after, fired.AddMinutes(4)));
        Assert.True(AutomationRules.IsDue(after, fired.AddMinutes(5)));
    }

    [Fact]
    public void Automation_rules_daily_due()
    {
        var now = DateTimeOffset.Now; // local time — daily times are local
        var anchor = now.AddDays(-1);
        var automation = new AutomationDto(Guid.NewGuid(), "Morning", "Morning report", AutomationFrequency.Daily, null, "09:00", true, anchor, null, 0);

        // Due once the next 09:00 after the anchor has passed.
        var due = AutomationRules.IsDue(automation, now);
        Assert.True(due);

        // Disabled automations never fire.
        Assert.False(AutomationRules.IsDue(automation with { Enabled = false }, now));

        // After firing today, the next occurrence is tomorrow 09:00.
        var firedTodayMorning = automation with { LastFiredAt = now.Date.AddHours(9).ToLocalTime() };
        Assert.False(AutomationRules.IsDue(firedTodayMorning, now));
    }

    [Fact]
    public void Automation_rules_validate_schedules()
    {
        Assert.Throws<ArgumentException>(() => AutomationRules.Validate("", "prompt", AutomationFrequency.Interval, 5, null));
        Assert.Throws<ArgumentException>(() => AutomationRules.Validate("label", "prompt", AutomationFrequency.Interval, 0, null));
        Assert.Throws<ArgumentException>(() => AutomationRules.Validate("label", "prompt", AutomationFrequency.Daily, null, "25:99"));
        Assert.Throws<ArgumentException>(() => AutomationRules.Validate("label", "prompt", AutomationFrequency.Interval, 5, "09:00"));
        AutomationRules.Validate("label", "prompt", AutomationFrequency.Daily, null, "09:00");
        AutomationRules.Validate("label", "prompt", AutomationFrequency.Interval, 5, null);
    }

    [Fact]
    public void Automation_store_crud_and_firing_creates_runnable_missions()
    {
        var dataDir = TempDataDir();
        try
        {
            var db = new SqliteDatabase(dataDir);
            var store = new SqliteAutomationStore(db);
            var missions = new SqliteMissionStore(db);

            var automation = store.Create(new CreateAutomationRequest("Every 5 minutes", "Check disk usage", AutomationFrequency.Interval, 5));
            Assert.True(automation.Enabled);
            Assert.Equal(0, automation.MissionCount);

            // Update: rename + disable.
            var updated = store.Update(automation.Id, new UpdateAutomationRequest(Label: "Renamed", Enabled: false));
            Assert.False(updated.Enabled);
            Assert.Equal("Renamed", updated.Label);

            // Re-enable and simulate the scheduler firing: a normal Created mission appears.
            store.Update(automation.Id, new UpdateAutomationRequest(Enabled: true));
            var fired = store.MarkFired(automation.Id, DateTimeOffset.UtcNow);
            Assert.Equal(1, fired.MissionCount);
            Assert.NotNull(fired.LastFiredAt);

            var mission = missions.Create(new CreateMissionRequest(automation.Prompt));
            Assert.Equal(MissionStatus.Created, mission.Status);

            store.Delete(automation.Id);
            Assert.Empty(store.List());
        }
        finally
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            Directory.Delete(dataDir, recursive: true);
        }
    }

    /* ---- Workspace inspection ---- */

    [Fact]
    public void Workspace_inspector_lists_entries_and_detects_project()
    {
        var root = TempDataDir();
        try
        {
            Directory.CreateDirectory(Path.Combine(root, "src"));
            File.WriteAllText(Path.Combine(root, "Kerai.sln"), "");
            File.WriteAllText(Path.Combine(root, "package.json"), "{}");
            Directory.CreateDirectory(Path.Combine(root, ".git"));

            var summary = WorkspaceInspector.Build(root);

            Assert.Equal(4, summary.EntryCount);
            Assert.Equal(2, summary.FileCount);
            Assert.Equal(2, summary.DirectoryCount);
            Assert.True(summary.HasGit);
            Assert.True(summary.HasSolution);
            Assert.Contains("package.json", summary.Manifests);
            Assert.Contains(summary.TopEntries, e => e.IsDirectory && e.Name == "src");
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Workspace_inspector_reports_missing_root_without_throwing()
    {
        var summary = WorkspaceInspector.Build(Path.Combine(Path.GetTempPath(), "kerai-does-not-exist-" + Guid.NewGuid().ToString("N")));
        Assert.NotNull(summary.Error);
        Assert.Equal(0, summary.EntryCount);
    }

    /* ---- Memory: clear only touches terminal history ---- */

    [Fact]
    public void Memory_clear_keeps_active_missions_and_removes_terminal_history()
    {
        var dataDir = TempDataDir();
        try
        {
            var db = new SqliteDatabase(dataDir);
            var missions = new SqliteMissionStore(db);
            var events = new SqliteEventBus(db);
            var approvals = new SqliteApprovalStore(db);

            var active = missions.Create(new CreateMissionRequest("Active mission"));
            var done = missions.Create(new CreateMissionRequest("Completed mission"));
            missions.Transition(done.Id, MissionStatus.Running);
            missions.SetResult(done.Id, "done", null);
            missions.Transition(done.Id, MissionStatus.Completed);
            events.Publish(new MissionEvent(done.Id, AgentEventTypes.MissionCompleted, "done", DateTimeOffset.UtcNow));
            events.Publish(new MissionEvent(active.Id, AgentEventTypes.MissionCreated, "Active mission", DateTimeOffset.UtcNow));

            var missionsCleared = missions.ClearTerminal();
            var approvalsCleared = approvals.ClearForTerminalMissions();
            var eventsCleared = events.ClearAll();

            Assert.Equal(1, missionsCleared);
            Assert.Equal(0, approvalsCleared);
            Assert.Equal(2, eventsCleared);
            Assert.NotNull(missions.Get(active.Id));
            Assert.Null(missions.Get(done.Id));
            Assert.Empty(events.Recent(10));
        }
        finally
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            Directory.Delete(dataDir, recursive: true);
        }
    }

    private sealed class NeverSatisfiesFakeOllama(string model) : IOllamaClient
    {
        public int GenerationCalls { get; private set; }

        public Task<OllamaStatus> GetStatusAsync(CancellationToken ct = default) =>
            Task.FromResult(new OllamaStatus(true, "http://test", [model], null));

        public Task<OllamaChatResult> GenerateAsync(string model, IReadOnlyList<ChatMessage> messages, IReadOnlyList<ToolContract> tools, CancellationToken ct = default)
        {
            GenerationCalls++;
            return Task.FromResult(new OllamaChatResult("Done.", [])); // always fails verification
        }
    }

    /// <summary>
    /// Scripted Master + sub-agent: the Master dispatches one Coder sub-mission;
    /// the Coder sub-agent answers directly; the Master then reports the outcome.
    /// The fake keys off the system prompt to tell the two conversations apart.
    /// </summary>
    private sealed class DispatchFakeOllama(string model) : IOllamaClient
    {
        public Task<OllamaStatus> GetStatusAsync(CancellationToken ct = default) =>
            Task.FromResult(new OllamaStatus(true, "http://test", [model], null));

        public Task<OllamaChatResult> GenerateAsync(string model, IReadOnlyList<ChatMessage> messages, IReadOnlyList<ToolContract> tools, CancellationToken ct = default)
        {
            var system = messages.FirstOrDefault(m => m.Role == "system")?.Content ?? string.Empty;
            var isCoder = system.Contains("Coder agent", StringComparison.OrdinalIgnoreCase);

            if (isCoder)
            {
                return Task.FromResult(new OllamaChatResult(
                    "The Coder agent inspected the project and found the build failure: a missing using directive in Kerai.Runtime.cs. It added the missing import and the build now succeeds.",
                    []));
            }

            var alreadyDispatched = messages.Any(m => m.Role == "tool");
            if (!alreadyDispatched)
            {
                return Task.FromResult(new OllamaChatResult(null,
                    [new ToolCall("submission.dispatch", "{\"goal\":\"Find why the build fails\",\"lane\":\"Coder\"}")]));
            }

            return Task.FromResult(new OllamaChatResult(
                "I dispatched the build fix to the Coder sub-agent. It inspected the project, found a missing using directive in Kerai.Runtime.cs, and fixed it. The build now succeeds.",
                []));
        }
    }
}
